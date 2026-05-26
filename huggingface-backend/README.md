---
title: WWAS WhatsApp Engine
emoji: 💬
colorFrom: green
colorTo: white
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# WWAS — WhatsApp Engine for Hugging Face Spaces

> **Node.js + Express + Socket.io + whatsapp-web.js**  
> Backend engine for the WWAS WhatsApp CRM & Cold Outreach Operating System.

---

## What This Does

This Space runs the **WhatsApp automation engine** that powers the WWAS CRM dashboard hosted on Hostinger.

It handles:
- WhatsApp session management via `whatsapp-web.js` + Puppeteer
- QR code generation for WhatsApp Web linking
- Outbound message queue with anti-ban delays
- Inbound message reception and webhook delivery
- Phone number validation (WhatsApp registration check)
- Real-time communication via Socket.io

---

## Architecture

```
Hostinger PHP Dashboard
        │
        │  REST API (send-message, check-number, health)
        ▼
 HF Spaces (this Space)
        │
        ├── Express HTTP Server  (port 7860)
        ├── Socket.io Server     (real-time events)
        ├── WhatsApp Client      (whatsapp-web.js)
        └── Webhook Delivery     (→ back to Hostinger)
```

---

## Environment Variables

Set these in **Settings → Variables and secrets** in your HF Space:

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port. HF assigns `7860` automatically |
| `API_KEY` | **Yes** | Strong random string — must match `HF_API_KEY` in Hostinger config |
| `WEBHOOK_URL` | **Yes** | Your Hostinger URL: `https://yourdomain.com/webhook.php` |
| `WEBHOOK_SECRET` | **Yes** | HMAC secret — must match `WEBHOOK_SECRET` in Hostinger config |
| `WA_SESSION_DIR` | No | Session path. Defaults to `/app/wa_session` |
| `WA_CLIENT_ID` | No | WhatsApp client ID. Defaults to `wwas-client` |
| `WEBHOOK_RETRY_ATTEMPTS` | No | Webhook retry count. Default: `3` |
| `WEBHOOK_RETRY_DELAY_MS` | No | Delay between retries (ms). Default: `2000` |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins. Default: `*` |
| `LOG_LEVEL` | No | Winston log level. Default: `info` |
| `RATE_LIMIT_WINDOW_MS` | No | Rate limit window (ms). Default: `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | No | Max requests per window. Default: `60` |

---

## API Endpoints

All endpoints except `/health` require the `X-API-Key` header.

### `GET /health`
Returns server health status — no auth required.

```json
{
  "status": "ok",
  "whatsapp": { "ready": true },
  "queue": { "size": 0 },
  "uptime_human": "2h 15m 30s"
}
```

### `GET /health/qr`
Returns current QR code (base64 PNG) if WhatsApp is awaiting scan.

```json
{
  "success": true,
  "qr_available": true,
  "qr": "data:image/png;base64,..."
}
```

### `POST /send-message`
Send a WhatsApp message (queued or direct).

```json
{
  "phone_number": "919876543210",
  "message": "Hello from WWAS!",
  "lead_id": "42",
  "job_id": "campaign_42_1716000000",
  "use_queue": true,
  "delay_ms": 120000
}
```

### `POST /check-number`
Validate if a phone number is registered on WhatsApp.

**Single:** `{ "phone_number": "919876543210" }`  
**Batch:** `{ "phone_numbers": ["919876543210", "918765432109"] }`

### `POST /queue/pause` · `POST /queue/resume` · `POST /queue/clear`
Control the outbound message queue.

### `GET /queue/state`
Returns current queue size, processing state, and stats.

### `GET /wa/status`
Returns WhatsApp client connection status.

---

## Socket.io Events

Connect from frontend:
```javascript
const socket = io('https://your-space.hf.space');
```

### Events emitted by server → client:

| Event | Description |
|---|---|
| `connection_ack` | Sent on connect with current state |
| `heartbeat` | Every 30s — WA status + queue size |
| `qr_code` | QR code (base64) when WA awaiting scan |
| `whatsapp_ready` | WhatsApp connected and ready |
| `whatsapp_disconnected` | WhatsApp dropped |
| `whatsapp_authenticated` | Session authenticated |
| `whatsapp_auth_failure` | Auth failed — rescan needed |
| `whatsapp_reconnecting` | Reconnect attempt in progress |
| `whatsapp_reconnect_failed` | Max reconnect attempts reached |
| `message_received` | Inbound WhatsApp message |
| `message_sent` | Outbound message confirmed sent |
| `message_ack` | Delivery/read acknowledgement |
| `outreach_started` | Campaign/queue processing started |
| `outreach_stopped` | Campaign/queue stopped or completed |
| `campaign_progress` | Queue stats update |
| `number_validated` | Single number validation result |
| `validation_complete` | Batch validation finished |

### Events client → server:

| Event | Description |
|---|---|
| `queue_pause` | Pause the outbound queue |
| `queue_resume` | Resume the outbound queue |
| `queue_clear` | Clear all pending jobs |
| `ping_server` | Heartbeat ping (server responds with `pong_server`) |

---

## Session Persistence

WhatsApp session is stored at `/app/wa_session` using `LocalAuth`.

> ⚠️ **Important:** Hugging Face Spaces use an **ephemeral filesystem**. Session data is lost on container restart. To persist the session, you have two options:
>
> 1. **Re-scan QR** after each restart (simplest for personal use)
> 2. **Use HF Persistent Storage** (upgrade to paid tier) and mount to `/app/wa_session`

The system automatically handles reconnection and QR regeneration on restarts.

---

## Deployment Steps

1. **Create a new HF Space**
   - Go to [huggingface.co/new-space](https://huggingface.co/new-space)
   - SDK: **Docker**
   - Space name: e.g. `wwas-engine`

2. **Upload these files** to the Space repository:
   - `server.js`
   - `package.json`
   - `Dockerfile`
   - `README.md` (this file)
   - `middleware/` folder
   - `routes/` folder
   - `services/` folder
   - `wa_session/.gitkeep`

3. **Set environment variables** in Space Settings → Variables and secrets:
   ```
   API_KEY=your_strong_api_key_min_32_chars
   WEBHOOK_URL=https://yourdomain.com/webhook.php
   WEBHOOK_SECRET=your_hmac_secret_min_32_chars
   ```

4. **Wait for build** — Docker build takes 2–5 minutes on first deploy.

5. **Check health** — Visit `https://your-space.hf.space/health`

6. **Scan QR** — Open your WWAS dashboard → click the QR icon → scan with WhatsApp.

---

## Tech Stack

| Component | Version |
|---|---|
| Node.js | ≥ 18.0.0 |
| Express | ^4.19.2 |
| Socket.io | ^4.7.5 |
| whatsapp-web.js | ^1.23.0 |
| Chromium (Puppeteer) | System (via apt) |
| Winston | ^3.13.0 |
| Helmet | ^7.1.0 |
| express-rate-limit | ^7.3.1 |

---

## Anti-Ban Notes

This engine is designed with WhatsApp's terms of service in mind:

- **No bulk blasting** — messages are queued with 120–300s randomized delays
- **One first message only** — automation stops when a lead replies
- **Human continuation** — all follow-ups are manual via the dashboard
- **Personalized messages** — Groq AI generates unique messages per lead
- **Daily limits** — configurable max sends per day (default: 50)

---

## Support

This Space is part of the **WWAS WhatsApp CRM** system.  
Hostinger dashboard repo: [github.com/DevsRohan/wwas](https://github.com/DevsRohan/wwas)
