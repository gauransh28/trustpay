# TrustPay: AI invoicing you can trust

Small businesses want to use AI, but they don't trust it with money. TrustPay shows one answer: **the AI prepares the payment action, a human approves it, and only then does PayPal act.**

Built for the PayPal AI Hackathon.

## What it does

1. The owner types a request in plain English, for example: `Invoice Priya $120 for wedding bouquets, due Friday`.
2. The AI (Google Gemini) turns it into a structured invoice draft.
3. The **Trust Meter** shows the AI's real confidence score and a checklist (customer, amount, item, due date, spending limit).
4. Nothing is sent until the owner reviews the draft and clicks **Approve**.
5. On approval, a real invoice is created and sent through the **PayPal Invoicing API** (sandbox).
6. Every step is written to an **audit log**.
7. **"Who hasn't paid me yet?"** lists unpaid invoices from PayPal.

Guardrails: an amount limit (default $500) that needs an extra confirmation, a low-confidence warning, and a fallback parser if the AI is unavailable (the badge then says "fallback parser" so it is never hidden).

## PayPal APIs used (sandbox)

- OAuth 2.0 token (`/v1/oauth2/token`)
- Generate invoice number (`/v2/invoicing/generate-next-invoice-number`)
- Create invoice (`/v2/invoicing/invoices`)
- Send invoice (`/v2/invoicing/invoices/{id}/send`)
- List invoices (`/v2/invoicing/invoices`)

## Tools and AI

- Google Gemini API: understands the plain-English request and returns the draft and confidence score
- PayPal Invoicing API (sandbox)
- Node.js and Express backend, plain HTML, CSS and JavaScript frontend
- Claude (Anthropic) was used as a coding assistant while building this project

## Run it yourself

You need Node.js 18 or newer.

```powershell
git clone https://github.com/gauransh28/trustpay.git
cd trustpay
npm install
Copy-Item .env.example .env
```

Open `.env` and fill in:

```
PAYPAL_CLIENT_ID=your sandbox client id
PAYPAL_SECRET=your sandbox secret
GEMINI_API_KEY=your Gemini API key (free tier works)
AMOUNT_LIMIT=500
PORT=3000
```

Then start it:

```powershell
npm start
```

Open http://localhost:3000

### PayPal sandbox setup

1. At developer.paypal.com, switch to **Sandbox** and create an app under **Apps & Credentials**.
2. In the app's **Features**, tick **Invoicing** and save.
3. Create a sandbox **Business** account (the seller) and a sandbox **Personal** account (the customer) under **Testing Tools, Sandbox Accounts**.
4. Use the app's Client ID and Secret in `.env`, and the Personal account's email as the customer email in TrustPay.

Note: PayPal blocks sending invoices to customers inside India, so use a US business app and a US personal account for testing.

## Demo video

Add the YouTube link here.

## License

MIT
