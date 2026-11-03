# Haya AI Chat Persona & Scheduled WhatsApp Conversation Suite

This upgrade integrates **Haya**, a 20-year-old fictional Pakistani Urdu AI chat persona from Haseerpur, into the existing WhatsApp Automation Suite while preserving 100% of existing commands, interactive buttons, media tools, and multi-tenant sessions. It delivers natural Urdu/Roman Urdu emotional intelligence, voice note transcription, fixed visual identity portraits, persistent per-user message queuing, 10–15 minute Busy Mode delays, and Pakistan Standard Time (`Asia/Karachi`) Night & Morning scheduling with full Admin Dashboard controls.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and product decisions incorporate your confirmed preferences and preserve all existing bot functionality without removing or breaking any current feature.

- **Confirmed Decision 1 (Response Scope)**: Haya AI responds in **Direct Messages (DMs) only by default**, ensuring group chats remain undisturbed unless explicitly toggled by the admin. Existing bot commands (`.menu`, `.button`, `.ptv`, `.voice`, `.online`, etc.) and interactive button replies always execute with top priority before routing normal conversation to Haya.
- **Confirmed Decision 2 (Busy Mode Triggering)**: Supports **both manual admin toggling and a smart auto-trigger option** that can naturally place Haya into a 10–15 minute busy window during daytime hours, sending a polite Urdu acknowledgement once and queuing subsequent incoming messages for chronological reply after the window ends.
- **Confirmed Decision 3 (Night Broadcast Target Scope)**: Between **8:56 PM and 8:58 PM Pakistan Time (`Asia/Karachi`)**, Haya sends her Good Night message exclusively to **users who were active with Haya today or currently have pending messages**, preventing unsolicited broadcasts to inactive contacts before entering Sleep Mode (9:00 PM – 5:00 AM PKT).
- **Mandatory Personality & Transparency**: Haya always communicates with warmth, kindness, emotional awareness (funny, happy, sad, angry, serious, confused), and 0–2 natural emojis when appropriate. If directly asked whether she is real or AI, she truthfully states she is a fictional AI character.

---

### 1. Overview & Core Concept

- **What It Does**: Adds an isolated, stateful AI conversation engine ("Haya") to the connected WhatsApp number(s). When a user sends a normal text message, voice note, or requests Haya's photo, Haya responds in natural Pakistani Urdu (or Roman Urdu when appropriate) using per-user conversation memory, emotional tone detection, and Pakistan-time life-cycle states (Available, Busy, Sleeping, Morning Dispatch).
- **Target Audience / Persona**:
  - **End Users on WhatsApp**: Experience a polite, caring, cheerful, and culturally grounded Pakistani Urdu conversational companion who remembers context, understands voice notes, and respects natural daily routines.
  - **Bot Owner / Administrators**: Manage Haya's persona prompt, master portrait, busy/sleep schedules, per-user queues, opt-outs, and live diagnostics directly from the web dashboard or WhatsApp owner commands.
- **Key Value**: Transforms the bot from a command-only utility into an always-reliable, human-paced conversational system with SQLite-backed crash recovery, idempotent message deduplication, and strict WhatsApp rate-limit compliance.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Normal Chat & Emotion-Aware Replies**: A user messages the connected WhatsApp number. The router verifies it is not a command or button payload, checks opt-out/block status and Haya's current mode (Available vs. Busy vs. Sleep), detects the user's emotional tone (Funny, Happy, Sad, Angry, Serious, Confused), and replies in natural Pakistani Urdu with 0–2 fitting emojis.
  2. **Voice Note Transcription Flow**: When a user sends a WhatsApp voice note/audio message, Haya validates its size/format, transcribes the Urdu/Roman Urdu speech via Gemini (`gemini-3.5-transcribe`), and replies in natural Urdu text addressing what the user said.
  3. **Fixed Visual Identity Portrait Flow**: When a user asks for Haya's photo (*"Apni picture bhejo"*, *"Tasveer dikhao"*), Haya verifies per-user rate limits and sends the approved master portrait of Haya (20-year-old fictional Pakistani woman in decent attire with consistent earrings, ring, and locket/necklace) as a native WhatsApp image attachment with an Urdu caption (`"یہ میری تصویر ہے 😊"`).
  4. **Busy Mode (10–15 Min Delayed Queue)**: When Haya is in Busy Mode, the first incoming message triggers a single polite Urdu busy notice (e.g., *"میں ابھی تھوڑی مصروف ہوں، کچھ دیر میں بات کرتی ہوں۔"*). All messages during the 10–15 minute window are stored in the persistent queue and answered in chronological order once Haya becomes available.
  5. **Pakistan Night & Morning Lifecycle (`Asia/Karachi`)**:
     - **8:56 PM – 8:58 PM PKT**: Sends `"اب میں سونے جا رہی ہوں۔ اپنا خیال رکھیے گا۔ شب بخیر، اللہ حافظ۔ 😊"` to today's active/pending users.
     - **9:00 PM – 5:00 AM PKT (Sleep Mode)**: Silently queues all incoming user messages in SQLite without sending automated AI replies.
     - **5:10 AM – 5:12 AM PKT (Morning Dispatch)**: Iterates fairly through users who have pending messages, sends `"السلام علیکم! صبح بخیر۔ 😊"` first, and then answers their queued messages chronologically with natural rate-limited pacing.
  6. **Admin Dashboard ("Haya AI Persona" Service Hub)**: Accessible from the **All Services** drawer, **Haya AI** quick button, and Super Admin console, enabling real-time control of Haya's state, persona prompt, master portrait upload/preview, schedule windows, per-user queue inspection, and audit logs.

- **Visual Identity & Theme (Admin Dashboard Integration)**:
  - *Aesthetic Direction*: High-craft dark SaaS control console matching the existing Urooj Choudhary Suite, with single-elevation surfaces, crisp 1px structural borders (`border-slate-800`), and zero nested-card clutter.
  - *Color Palette & Mood*: Deep slate canvas (`#030712` / `bg-slate-950`), elevated structural surfaces (`#0F172A` / `bg-slate-900/70`), warm amber primary accents (`#F59E0B`), and semantic state indicators (`#10B981` Emerald for Available, `#F59E0B` Amber for Busy Queue, `#6366F1` Indigo for Night Sleep Mode, `#F43F5E` Rose for Failed/Opt-Out).
  - *Typography & Hierarchy*: `Plus Jakarta Sans` for section headings and Urdu/English prose controls, paired with `JetBrains Mono` (`tabular-nums`) for all Pakistan Standard Time clocks, countdowns, queue counters, and WhatsApp JIDs.
  - *Component Styling & Layout*: 12-column responsive layout featuring a top status bar (Current PKT Clock, Active Haya State, Pending Queue Count, Failed Jobs Count), split configuration panels (Persona & Emotional Rules Editor, Master Portrait Preview/Uploader, Busy & Night/Morning Timezone Schedulers), and a live filterable Per-User Queue & Conversation Manager table.
- **Interactive Feedback & Motion**: Instant toggle state transitions ($\le 150\text{ms}$), live Asia/Karachi digital clock, interactive simulator to test Haya's Urdu responses and emotion detection directly in the dashboard, and one-click retry/flush actions with non-intrusive toast notifications.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Non-Intrusive Hook into Existing Baileys Pipeline**
  - *Chosen Approach*: Attach Haya AI as a dedicated post-command, non-blocking interceptor in the message pipeline after `urooj_custom_commands` and prefix command checks, while also registering a `.haya` owner command plugin for quick WhatsApp-side administration.
  - *Why*: Guarantees zero regressions for the 236 existing commands, interactive buttons, View-Once vault, and presence tracker.
  - *Alternatives Considered*: Replacing `plugins/chatbot.js` directly — passed over so the legacy `.chatbot` command remains intact for users who want generic English bot replies when Haya is disabled.
- **Decision 2: SQLite (`node:sqlite`) Persistent Queue & State Store**
  - *Chosen Approach*: Extend the existing `lib/database.js` SQLite database (`urooj_suite.db` in WAL mode) with dedicated `haya_settings`, `haya_users`, `haya_conversations`, `haya_pending_messages`, and `haya_jobs` tables.
  - *Why*: Survives server restarts, Railway redeployments, and process crashes without requiring external Redis infrastructure, while preserving strict per-user chronological ordering and idempotency keys.
- **Decision 3: Fixed Master Portrait Consistency**
  - *Chosen Approach*: Generate and store a high-resolution, original fictional portrait of Haya (20-year-old Pakistani woman in decent traditional attire with signature earrings, ring, and locket necklace) as a permanent local asset (`/public/assets/haya_master_portrait.jpg`), paired with admin upload/override support and SHA-256 asset verification before WhatsApp media dispatch.
  - *Why*: Eliminates face/identity drift across requests and guarantees 100% visual consistency whenever a user requests Haya's photo.
- **Decision 4: Server-Side `@google/genai` SDK Integration**
  - *Chosen Approach*: Use `@google/genai` on the Node.js server with `gemini-3.8-flash` for low-latency, emotionally nuanced Pakistani Urdu conversation and `gemini-3.5-transcribe` for accurate Urdu/Roman Urdu voice-note transcription, with exponential backoff and safe fallback handling.
  - *Why*: Complies with modern Gemini SDK standards, keeps `process.env.GEMINI_API_KEY` strictly server-side, and natively supports multimodal audio transcription.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     WhatsApp Socket Layer (@whiskeysockets/baileys)          │
└──────────────────────┬────────────────────────────────────────▲──────────────┘
                       │ Incoming messages.upsert               │ Outbound Text / Media
                       ▼                                        │ (Rate-Limited)
┌───────────────────────────────────────────────────────────────┴──────────────┐
│ 1. Existing Priority Router                                                  │
│    ├─ Custom Commands (.button, .ptv, .voice, .😍, .qouted, .online)         │
│    ├─ Prefix Commands & Interactive Button Payloads (236 commands preserved) │
│    └─ Normal DM / Mention Fallthrough ──► Haya AI Ingress Filter             │
└──────────────────────────────────────────────────┬───────────────────────────┘
                                                   │
                                                   ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. Haya AI Service & Lifecycle Controller                                    │
│    ├─ Idempotency & Deduplication Guard (source_message_id check)            │
│    ├─ User Policy Check (STOP/UNSUBSCRIBE opt-out, per-user AI toggle)       │
│    ├─ Mode Gate (Asia/Karachi IANA Timezone Engine):                         │
│    │   ├─ [SLEEP MODE: 21:00–05:00 PKT] ──► Enqueue to haya_pending_messages │
│    │   ├─ [BUSY MODE: 10–15m Window]    ──► Send 1x Busy Notice + Enqueue    │
│    │   └─ [AVAILABLE MODE]              ──► Process Immediately              │
│    ├─ Media & Modality Handlers:                                             │
│    │   ├─ Audio/PTT Voice Note ──► gemini-3.5-transcribe ──► Urdu Transcript │
│    │   ├─ Photo Intent ("tasveer/photo") ──► Fixed Master Portrait Sender    │
│    │   └─ Text Conversation ──► Emotion Detector + gemini-3.8-flash          │
└──────────────────────┬────────────────────────────────────────▲──────────────┘
                       │ Read / Write                           │ Poll & Dispatch
                       ▼                                        │
┌───────────────────────────────────────────────────────────────┴──────────────┐
│ 3. SQLite Persistent Storage (WAL Mode) & Background Scheduler               │
│    ├─ Tables: haya_settings, haya_users, haya_conversations,                 │
│    │          haya_pending_messages, haya_jobs, haya_audit_logs              │
│    ├─ Night Scheduler (20:56–20:58 PKT): Good Night to active/pending users  │
│    ├─ Morning Dispatcher (05:10–05:12 PKT): Salam + chronological replies    │
│    └─ Busy Queue Worker & Exponential Backoff Retry / Dead-Letter Handler    │
└──────────────────────▲───────────────────────────────────────────────────────┘
                       │ REST API (/api/haya/*)
                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 4. Admin Dashboard UI ("Haya AI Settings" Panel)                             │
│    ├─ Live PKT Clock & Mode Switcher (Available / Busy / Sleep Override)     │
│    ├─ Persona Prompt, Emotional Rules & Busy Templates Editor                │
│    ├─ Master Portrait Preview, Upload & Rate-Limit Controls                  │
│    └─ Per-User Queue Inspector, Opt-Out Manager, Chat Tester & Audit Logs    │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State (SQLite Entities)**:
  - **`haya_settings`**: Singleton configuration row storing `enabled`, `scope` (`dm` default), `timezone` (`Asia/Karachi`), `default_language` (`urdu`), `persona_prompt`, `image_sending_enabled`, `image_rate_limit_per_hour`, `master_portrait_path`, `voice_transcription_enabled`, `voice_reply_enabled`, `busy_mode_enabled`, `busy_auto_trigger`, `busy_until_ts`, `busy_min_minutes` (10), `busy_max_minutes` (15), `busy_templates_json`, `night_mode_enabled`, `good_night_window_start` (`20:56`), `good_night_window_end` (`20:58`), `sleep_start_time` (`21:00`), `sleep_end_time` (`05:00`), `morning_dispatch_start` (`05:10`), `morning_dispatch_end` (`05:12`), `good_night_message`, `morning_message`, `last_good_night_date`, `last_morning_dispatch_date`, and `retention_days`.
  - **`haya_users`**: Per-sender profile keyed by normalized `whatsapp_id` (`cleanNumber@s.whatsapp.net`), tracking `display_name`, `language_preference` (`urdu` / `roman_urdu`), `ai_enabled`, `opted_out`, `blocked`, `busy_until_ts`, `busy_ack_sent`, `last_image_sent_at`, `last_active_at`, and `last_emotion`.
  - **`haya_conversations`**: Per-user conversation history (`whatsapp_id`, `role`, `message_text`, `message_type`, `emotion_detected`, `source_message_id` UNIQUE index for deduplication, `created_at`).
  - **`haya_pending_messages`**: Persistent queue for messages arriving during Busy Mode or Sleep Mode (`id`, `whatsapp_id`, `session_number`, `source_message_id` UNIQUE, `message_text`, `message_type`, `received_at`, `queue_reason` [`sleep` | `busy`], `status` [`pending` | `processing` | `sent` | `failed` | `cancelled`], `retry_count`, `next_attempt_at`, `last_error`, `processed_at`).
  - **`haya_jobs` & `haya_audit_logs`**: Tracks background scheduler runs (`night_broadcast`, `morning_dispatch`, `busy_flush`), `idempotency_key` (e.g., `good_night_2026-11-03`), status, error diagnostics, and admin actions.

- **Interactive Component & State Mapping**:
  - **Global & Per-User Toggles**: Flipping Haya Enable, Busy Mode, Night Mode, Picture Sending, or Voice Transcription immediately persists to `haya_settings` via `POST /api/haya/settings` and updates the live status banner.
  - **Busy Mode Trigger / Flush Controls**: Admins can manually trigger a 10–15 minute Busy Mode window (globally or for a specific user) or click "Flush Pending Queue Now" to immediately process queued messages in chronological order.
  - **Master Portrait Manager**: Displays Haya's current fixed portrait with options to upload a replacement image (validated for MIME type and size) or reset to the default master portrait.
  - **User & Queue Management Table**: Supports live search/filtering by user number or queue status, per-user AI enable/disable toggle, opt-out reset, conversation memory clear, and retrying failed jobs.
  - **Interactive Haya Sandbox & Acceptance Test Runner**: Allows the admin to test Haya's emotional tone detection, Urdu/Roman Urdu replies, and run the 14 automated acceptance checks directly from the dashboard.
