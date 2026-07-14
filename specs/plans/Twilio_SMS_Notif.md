# Isibot-fon — SMS Notifications via Twilio Alphanumeric Sender ID

## Overview

Isibot-fon can send outbound SMS notifications using Twilio's API with an **alphanumeric sender ID** (`ISIBOT`). This is used for one-way notifications to callers (e.g., appointment reminders, status updates, alerts).

Alphanumeric sender IDs display a brand name instead of a phone number. They support **one-way outbound messaging only** — recipients cannot reply.

## Proven Flow

Successfully tested on **2026-07-12** with the following parameters:

| Parameter       | Value                          |
|----------------|---------------------------------|
| From (Sender)  | `ISIBOT` (alphanumeric, 6 chars) |
| To             | `+491629430482` (Germany)       |
| Body           | `Dies ist eine Test-Nachricht von ISIBOT. 🟢` |
| Result         | `queued` → delivered            |
| Message SID    | `SMf9d76aa0d2ec5f0d7db67ef1aedf8886` |

## Prerequisites

### Twilio Console Setup

1. **Enable Alphanumeric Sender ID** in [SMS Settings](https://console.twilio.com/us1/account/sms/settings/general) — toggle on "Alphanumeric Sender ID"
2. **Register "ISIBOT"** in **Trust Hub → Registrations → Alphanumeric Sender IDs** (Germany requires pre-registration — see "International support for Alphanumeric Sender ID")

### Environment Variables

Set these in `.env` (for local scripts) or as Wrangler secrets (for Worker):

| Variable             | Source                       |
|----------------------|------------------------------|
| `TWILIO_ACCOUNT_SID` | Twilio Console → Account SID |
| `TWILIO_AUTH_SECRET` | Twilio Auth Token / API Secret |

## Local Test Script

File: `scripts/send-sms.ts`

```bash
npm run send-sms
```

Uses the `twilio` npm package and `dotenv` for local variable loading.

## API Reference

### Twilio Endpoint

```
POST /2010-04-01/Accounts/{AccountSid}/Messages.json
```

### Key Parameters for Alphanumeric Sender ID

| Parameter | Required | Description |
|-----------|----------|-------------|
| `To`      | ✅       | Recipient phone number in E.164 format, e.g. `+491629430482` |
| `From`    | ✅       | Alphanumeric sender ID (≤ 11 chars, must include at least one letter), e.g. `ISIBOT` |
| `Body`    | ✅       | Message text, up to 1,600 characters |

### Alphanumeric Sender ID Rules

- Max **11 characters**
- Can include ASCII letters (A–Z, a–z), digits (0–9), and spaces
- Must include **at least one alphabetic character** (cannot be all digits)
- Supports GSM-7 and UCS-2 encoding (emoji works)

## Country Support (Germany)

Germany **supports** alphanumeric sender IDs but requires **pre-registration** via Trust Hub. Check [International support for Alphanumeric Sender ID](https://help.twilio.com/hc/en-us/articles/223133767-International-support-for-Alphanumeric-Sender-ID) for other countries.

## Limitations

| Limitation | Detail |
|------------|--------|
| **One-way only** | Recipients cannot reply to the message |
| **No STOP keyword** | Twilio's SMS STOP keyword does not auto-opt-out alphanumeric senders — provide alternative opt-out instructions in the message body |
| **Not available in US/Canada** | Only supported outside North America |
| **Registration required** | Some countries (including Germany) require pre-registration of the sender ID |

## Integration into Worker

To send SMS from the Worker (e.g., for notifications), use the Twilio REST API directly via `fetch`:

```typescript
const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_SECRET}`).toString('base64');

const response = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: '+491629430482',
      From: 'ISIBOT',
      Body: 'Your notification message here.',
    }).toString(),
  }
);
```

## Error Handling

| Error Code | Meaning | Fix |
|-----------|---------|-----|
| `30042`   | Alphanumeric Sender ID not authorized or generic | Register sender ID in Trust Hub; avoid generic names |
| `21612`   | "From" number not owned or SMS-capable | Enable alphanumeric sender ID in SMS Settings |