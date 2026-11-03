# Urooj Choudhary & Haya AI - WhatsApp Bot Upgrade Documentation

This document covers the architecture, design comparison, file manifest, local & Railway deployment setup, troubleshooting, and platform notes for the **Haya AI Persona (حیا)** upgrade to the **Urooj Choudhary - WhatsApp Automation Suite**.

---

## 1. Architecture Review of Existing Codebase (Deliverable 1)

- **Server & Web Dashboard (`server.js` + `public/index.html`)**:
  - Express server listening on `0.0.0.0:3000` with device-bound authentication, Super Admin console (`Urooj`), Native Live Location sender, Fake Quoted Reply builder, Scheduled Message Queue, Button Messenger, View-Once & Anti-Delete Vault, and Railway Cloud Volume hub.
- **WhatsApp Socket & Session Engine (`lib/sessionManager.js`)**:
  - Uses `@whiskeysockets/baileys` (`7.0.0-rc13`) with multi-file auth state stored under `/data/sessions` (or `/app/data/sessions` on Railway).
  - Incoming `messages.upsert` events pass through `vaultInterceptor` (View-Once / Anti-Delete), `urooj_custom_commands.js`, `main.js` (236 commands across 156 plugins), and now the **Haya AI Chat & Queue Engine (`lib/hayaService.js`)**.
- **Database Layer (`lib/database.js` + `lib/hayaDatabase.js`)**:
  - Built on Node 22 native `node:sqlite` (`DatabaseSync`) with WAL mode (`PRAGMA journal_mode = WAL;`) on `/data/urooj_suite.db`.

---

## 2. Comparison of Existing vs. Upgraded Haya System (Deliverable 2)

| Capability | Existing System (`plugins/chatbot.js`) | Upgraded Haya AI System (`lib/haya*.js` + `plugins/haya.js`) |
| :--- | :--- | :--- |
| **Persona & Identity** | Generic English/slang chatbot stored in `data/userGroupData.json` | Fixed 20-year-old Pakistani woman **Haya (حیا)** from fictional town **Haseerpur (حصیر پور)** |
| **Language** | Informal English / Hinglish | Natural Pakistani Urdu script by default; supports Roman Urdu if user writes in Roman Urdu |
| **Emotional Intelligence** | None | Mandatory friendly, caring, polite, playful, and sympathetic rules with 7-emotion detection (`funny`, `happy`, `sad`, `angry`, `serious`, `confused`, `neutral`) and 0–2 natural emojis |
| **Picture Requests** | Not supported | Fixed high-resolution portrait (`/public/assets/haya_master_portrait.png`) depicting Haya with visible jhumka earrings, ring on hand, and crescent locket necklace, sent with `"یہ میری تصویر ہے 😊"` |
| **Voice Messages** | Not supported | Automatic download, transcription via `gemini-3.5-transcribe`, Urdu text reply, and temporary audio file cleanup |
| **Busy Mode (10–15m)** | Not supported | Manual + smart auto-trigger (10–15 min configurable delay), sends 1x Urdu busy acknowledgement, suppresses duplicates, and replies chronologically |
| **Night & Sleep Mode** | Not supported | `Asia/Karachi` scheduler: Good Night message at `20:56–20:58` PKT; Sleep Mode from `21:00–05:00` PKT queuing all incoming messages in SQLite |
| **Morning Pending Dispatch** | Not supported | `Asia/Karachi` scheduler: wakes at `05:00` PKT; at `05:10–05:12` PKT messages **only** users who have pending messages (`"السلام علیکم! صبح بخیر۔ 😊"` + chronological replies) |

---

## 3. List of Files Added & Updated (Deliverables 3–15)

### Added Files
- `/lib/hayaPersona.js`: Haya persona configuration, mandatory friendly/emotional behaviour rules, emotion detector (`detectMessageEmotion`), Urdu/Roman-Urdu/English picture-intent detector (`isImageRequest`), opt-out/opt-in detectors, system instruction builder, and graceful Urdu fallback engine.
- `/lib/hayaDatabase.js`: Persistent SQLite WAL schema and repository (`haya_users`, `haya_conversations`, `haya_pending_messages`, `haya_settings`, `haya_jobs`, `haya_audit_logs`), deduplication by `source_message_id`, crash recovery for interrupted jobs, and GDPR export/delete methods.
- `/lib/hayaPortrait.js`: Fixed master portrait generator & asset manager (`/public/assets/haya_master_portrait.png` and `/data/haya_portrait/haya_master_portrait.png`) with file validation, custom upload, and reset support.
- `/lib/hayaService.js`: Core Haya AI conversation engine (`gemini-3.8-flash`), voice transcription (`gemini-3.5-transcribe`), optional TTS (`gemini-3.8-flash-lite-tts`), Busy Mode controller, and `Asia/Karachi` Night/Sleep/Morning scheduler.
- `/plugins/haya.js`: WhatsApp command plugin (`.haya on|off|status|busy|available|photo|flush`).
- `/tests/hayaAcceptanceTests.js`: 14 automated acceptance tests verifying all Haya requirements.

### Updated Files (Zero Regressions to Existing Features)
- `/lib/database.js`: Initializes Haya SQLite tables and exports Haya repository helpers.
- `/lib/sessionManager.js`: Hooks `hayaService.handleIncomingHayaMessage` into `attachMessageHandler`.
- `/lib/vaultInterceptor.js`: Cancels queued Haya pending messages if a sender deletes their message before dispatch.
- `/plugins/chatbot.js`: Yields to Haya AI when enabled.
- `/server.js`: Starts the Haya scheduler and exposes `/api/haya/*` REST endpoints.
- `/public/index.html`: Adds the **🌸 Haya AI Settings (حیا)** dashboard tab, live PKT telemetry, portrait uploader, busy/night/morning controls, interactive Urdu chat simulator, 14-test runner, and per-user GDPR queue manager.
- `/.env.example` & `/package.json`: Environment variable template and `npm test` script.

---

## 4. Local Setup & Verification (Deliverables 16–17)

1. **Install Dependencies**:
   ```bash
   npm install
   ```
2. **Configure Environment**:
   Copy `.env.example` to `.env` and set `GEMINI_API_KEY` (optional locally—if omitted, Haya automatically uses her built-in empathetic Pakistani Urdu fallback engine).
3. **Run the 14 Automated Acceptance Tests**:
   ```bash
   npm test
   ```
4. **Start the Server**:
   ```bash
   npm start
   ```
   Open `http://localhost:3000/#haya` to access the **Haya AI Settings** dashboard.

---

## 5. Railway Deployment Guide (Deliverable 18)

1. **Persistent Volume**:
   In your Railway service, press `⌘K` -> **Add Volume** and mount it at `/app/data`. All SQLite tables (`urooj_suite.db`), WhatsApp multi-file auth sessions, and Haya's custom master portrait persist automatically inside `/app/data`.
2. **Environment Variables**:
   Add `GEMINI_API_KEY`, `TIMEZONE=Asia/Karachi`, and `RAILWAY_VOLUME_MOUNT_PATH=/app/data` in Railway Variables.
3. **Single Scheduler Guarantee**:
   Run a single replica (`numReplicas: 1` in `railway.json`) so the WhatsApp Baileys socket and `Asia/Karachi` scheduler run without duplicate connections.

---

## 6. Troubleshooting & Provider Notes (Deliverables 19–20)

- **Voice Note Transcription Fails**:
  Ensure `ffmpeg` is available (included in `Dockerfile` and `nixpacks.toml`) and `GEMINI_API_KEY` is configured. If transcription fails, Haya replies politely in Urdu: `"مجھے آپ کا وائس میسج صحیح سے سمجھ نہیں آیا، کیا آپ دوبارہ بھیج سکتے ہیں یا لکھ کر بتا سکتے ہیں؟ 😊"`.
- **Morning Messages Not Sending to a User**:
  By design (Section 10.2), Morning Mode (`05:10–05:12` AM PKT) **only** messages users who have `status = 'pending'` messages in `haya_pending_messages`. Users with zero pending messages are never spammed at 5:10 AM.
- **Baileys / Unofficial WhatsApp Multi-Device Notes**:
  To protect account health against WhatsApp anti-spam limits, Haya enforces a 1.2-second pacing delay between sequential morning replies, per-user hourly photo rate limits, and idempotent job locks (`haya_jobs`) so Good Night and Morning greetings are never sent twice on the same date.
