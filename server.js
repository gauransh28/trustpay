const _fetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (typeof url !== 'string' || !url.includes('generativelanguage.googleapis.com')) return _fetch(url, opts);
  const models = [process.env.GEMINI_MODEL || 'gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash'];
  let last;
  for (let round = 0; round < 3; round++) {
    for (const m of models) {
      const res = await _fetch(url.replace(/models\/[^:]+:/, 'models/' + m + ':'), opts);
      if (![404, 429, 500, 503].includes(res.status)) return res;
      last = res;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return last;
};
import 'dotenv/config';
import express from 'express';
import fs from 'fs';
const app = express();
app.use(express.json());
app.use(express.static('public'));
const BASE = 'https://api-m.sandbox.paypal.com';
const LIMIT = Number(process.env.AMOUNT_LIMIT || 500);

const log = (e) => {
  const a = fs.existsSync('audit.json') ? JSON.parse(fs.readFileSync('audit.json')) : [];
  a.unshift({ time: new Date().toISOString(), ...e });
  fs.writeFileSync('audit.json', JSON.stringify(a.slice(0, 100), null, 2));
};

async function pp(path, method = 'GET', body) {
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64');
  const t = await fetch(BASE + '/v1/oauth2/token', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials'
  }).then(r => r.json());
  if (!t.access_token) throw new Error('PayPal auth failed: check sandbox keys');
  const r = await fetch(BASE + path, {
    method,
    headers: { Authorization: 'Bearer ' + t.access_token, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: body ? JSON.stringify(body) : (method === 'POST' ? '{}' : undefined)
  });
  const txt = await r.text();
  const d = txt ? JSON.parse(txt) : {};
  if (!r.ok) throw new Error(path + ' [' + r.status + '] ' + (d.message || d.name || '') + ' ' + JSON.stringify(d.details || ''));
  return d;
}

function fallback(text) {
  const amt = text.match(/(\d+(?:\.\d+)?)/);
  const cust = text.match(/invoice\s+([A-Za-z]+)/i);
  const item = text.match(/for\s+(.+?)(?:,|\s+due|$)/i);
  return { customer: cust?.[1] || '', amount: amt ? +amt[1] : 0, item: item?.[1] || 'Services', due_date: '', confidence: 0.5 };
}

app.post('/api/parse', async (req, res) => {
  const text = String(req.body.text || '');
  let p = null, source = 'fallback parser';
  const prompt = `Today is ${new Date().toDateString()}. Extract an invoice request as JSON only, no prose: {"customer":string,"amount":number,"item":string,"due_date":"YYYY-MM-DD or empty","confidence":number 0-1}. Request: ${text}`;
  if (process.env.GEMINI_API_KEY) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${process.env.GEMINI_MODEL || 'gemini-flash-latest'}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json' } })
      }).then(r => r.json());
      if (!r.candidates) throw new Error(r.error?.message || 'No response from Gemini');
      p = JSON.parse(r.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim());
      source = 'AI (Gemini)';
    } catch (e) { p = null; log({ event: 'ai_error', message: e.message }); }
  } else if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: process.env.MODEL || 'claude-sonnet-5-5', max_tokens: 300, messages: [{ role: 'user', content: prompt }] })
      }).then(r => r.json());
      if (!r.content) throw new Error(r.error?.message || 'No response from Claude');
      p = JSON.parse(r.content[0].text.replace(/```json|```/g, '').trim());
      source = 'AI (Claude)';
    } catch (e) { p = null; log({ event: 'ai_error', message: e.message }); }
  }
  p = p || fallback(text);
  const flags = [];
  if (p.amount > LIMIT) flags.push(`Amount is over your $${LIMIT} limit: extra confirmation required`);
  if (p.confidence < 0.7) flags.push('Low confidence: please review every field');
  if (!p.customer) flags.push('Customer name missing');
  log({ event: 'parsed', request: text, source, result: p, flags });
  res.json({ ...p, flags, source, limit: LIMIT });
});

app.post('/api/approve', async (req, res) => {
  try {
    const { customer, email, amount, item, due_date, confirmed } = req.body;
    if (!email || !(amount > 0)) throw new Error('Customer email and a positive amount are required');
    if (amount > LIMIT && !confirmed) throw new Error('Over limit: tick the extra confirmation box');
    const num = (await pp('/v2/invoicing/generate-next-invoice-number', 'POST')).invoice_number;
    const draft = await pp('/v2/invoicing/invoices', 'POST', {
      detail: { invoice_number: num, currency_code: 'USD', note: 'Created by AI assistant, approved by owner',
        payment_term: due_date ? { term_type: 'DUE_ON_DATE_SPECIFIED', due_date } : { term_type: 'NET_10' } },
      primary_recipients: [{ billing_info: { name: { given_name: customer }, email_address: email } }],
      items: [{ name: item, quantity: '1', unit_amount: { currency_code: 'USD', value: Number(amount).toFixed(2) } }]
    });
    const id = draft.href.split('/').pop();
    const sent = await pp('/v2/invoicing/invoices/' + id + '/send', 'POST', { send_to_recipient: true, send_to_invoicer: false });
    log({ event: 'approved_and_sent', invoice: num, id, customer, email, amount, approvedBy: 'owner' });
    res.json({ ok: true, invoice: num, id, link: sent.href || draft.href });
  } catch (e) { log({ event: 'error', message: e.message }); res.status(400).json({ error: e.message }); }
});

app.get('/api/invoices', async (req, res) => {
  try {
    const d = await pp('/v2/invoicing/invoices?page=1&page_size=20&total_required=true');
    res.json((d.items || []).map(i => ({
      number: i.detail?.invoice_number, status: i.status,
      to: i.primary_recipients?.[0]?.billing_info?.email_address, amount: i.amount?.value
    })));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/log', (req, res) => res.json(fs.existsSync('audit.json') ? JSON.parse(fs.readFileSync('audit.json')) : []));
app.listen(process.env.PORT || 3000, () => console.log('TrustPay running'));



