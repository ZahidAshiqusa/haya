'use strict';

/**
 * Haya AI Persistent Database Layer (SQLite WAL)
 * Implements entities:
 *  A. haya_users (HayaUser)
 *  B. haya_conversations (HayaConversation)
 *  C. haya_pending_messages (HayaPendingMessage)
 *  D. haya_settings (HayaSettings)
 *  E. haya_jobs (HayaJob)
 *  F. haya_audit_logs (Audit & Privacy Logs)
 */

const {
    DEFAULT_GOOD_NIGHT_MESSAGE,
    DEFAULT_MORNING_MESSAGE,
    DEFAULT_IMAGE_CAPTION,
    DEFAULT_BUSY_TEMPLATES,
    DEFAULT_PERSONA_PROMPT
} = require('./hayaPersona');

function normalizeWhatsAppId(input) {
    if (!input) return null;
    let raw = String(input).trim();
    if (raw.endsWith('@g.us') || raw.endsWith('@newsletter') || raw === 'status@broadcast') {
        return raw;
    }
    // Strip device suffix like 923001234567:12@s.whatsapp.net -> 923001234567@s.whatsapp.net
    const basePart = raw.split('@')[0].split(':')[0];
    let digits = basePart.replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('0') && digits.length === 11) {
        digits = '92' + digits.slice(1);
    }
    if (!digits || digits.length < 6) return null;
    return `${digits}@s.whatsapp.net`;
}

function initHayaSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS haya_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            whatsapp_id TEXT UNIQUE NOT NULL,
            display_name TEXT,
            language_preference TEXT NOT NULL DEFAULT 'urdu',
            ai_enabled INTEGER NOT NULL DEFAULT 1,
            opted_out INTEGER NOT NULL DEFAULT 0,
            blocked INTEGER NOT NULL DEFAULT 0,
            busy_until_ts INTEGER NOT NULL DEFAULT 0,
            busy_ack_sent INTEGER NOT NULL DEFAULT 0,
            last_image_sent_at INTEGER NOT NULL DEFAULT 0,
            image_req_count_hour INTEGER NOT NULL DEFAULT 0,
            image_req_window_start INTEGER NOT NULL DEFAULT 0,
            last_emotion TEXT NOT NULL DEFAULT 'neutral',
            last_active_at INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_haya_users_whatsapp_id ON haya_users(whatsapp_id);
        CREATE INDEX IF NOT EXISTS idx_haya_users_last_active ON haya_users(last_active_at);

        CREATE TABLE IF NOT EXISTS haya_conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            whatsapp_id TEXT NOT NULL,
            role TEXT NOT NULL,
            message_text TEXT NOT NULL,
            message_type TEXT NOT NULL DEFAULT 'text',
            emotion_detected TEXT DEFAULT 'neutral',
            source_message_id TEXT UNIQUE,
            created_at TEXT NOT NULL,
            timestamp_ms INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_haya_conv_whatsapp_time ON haya_conversations(whatsapp_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_haya_conv_source_id ON haya_conversations(source_message_id);

        CREATE TABLE IF NOT EXISTS haya_pending_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            whatsapp_id TEXT NOT NULL,
            session_number TEXT,
            source_message_id TEXT UNIQUE NOT NULL,
            message_text TEXT NOT NULL,
            message_type TEXT NOT NULL DEFAULT 'text',
            received_at INTEGER NOT NULL,
            queue_reason TEXT NOT NULL DEFAULT 'sleep',
            status TEXT NOT NULL DEFAULT 'pending',
            retry_count INTEGER NOT NULL DEFAULT 0,
            next_attempt_at INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            processed_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_haya_pending_user_status ON haya_pending_messages(whatsapp_id, status, received_at ASC);
        CREATE INDEX IF NOT EXISTS idx_haya_pending_status_attempt ON haya_pending_messages(status, next_attempt_at ASC);

        CREATE TABLE IF NOT EXISTS haya_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            enabled INTEGER NOT NULL DEFAULT 1,
            scope TEXT NOT NULL DEFAULT 'dm',
            timezone TEXT NOT NULL DEFAULT 'Asia/Karachi',
            ai_model TEXT NOT NULL DEFAULT 'gemini-3.8-flash',
            default_language TEXT NOT NULL DEFAULT 'urdu',
            persona_prompt TEXT NOT NULL,
            image_sending_enabled INTEGER NOT NULL DEFAULT 1,
            max_image_size_mb INTEGER NOT NULL DEFAULT 5,
            image_rate_limit_per_hour INTEGER NOT NULL DEFAULT 5,
            master_portrait_asset_id TEXT NOT NULL DEFAULT 'haya_master_v1',
            master_portrait_path TEXT NOT NULL DEFAULT '/assets/haya_master_portrait.png',
            voice_transcription_enabled INTEGER NOT NULL DEFAULT 1,
            voice_reply_enabled INTEGER NOT NULL DEFAULT 0,
            busy_mode_enabled INTEGER NOT NULL DEFAULT 0,
            busy_auto_trigger INTEGER NOT NULL DEFAULT 1,
            busy_until_ts INTEGER NOT NULL DEFAULT 0,
            busy_min_minutes INTEGER NOT NULL DEFAULT 10,
            busy_max_minutes INTEGER NOT NULL DEFAULT 15,
            busy_delay_mode TEXT NOT NULL DEFAULT 'random',
            busy_templates_json TEXT NOT NULL,
            night_mode_enabled INTEGER NOT NULL DEFAULT 1,
            good_night_window_start TEXT NOT NULL DEFAULT '20:56',
            good_night_window_end TEXT NOT NULL DEFAULT '20:58',
            sleep_start_time TEXT NOT NULL DEFAULT '21:00',
            sleep_end_time TEXT NOT NULL DEFAULT '05:00',
            morning_dispatch_start TEXT NOT NULL DEFAULT '05:10',
            morning_dispatch_end TEXT NOT NULL DEFAULT '05:12',
            good_night_message TEXT NOT NULL,
            morning_message TEXT NOT NULL,
            image_caption TEXT NOT NULL,
            retention_days INTEGER NOT NULL DEFAULT 30,
            last_good_night_date TEXT,
            last_morning_dispatch_date TEXT,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS haya_jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_type TEXT NOT NULL,
            whatsapp_id TEXT,
            scheduled_at INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            idempotency_key TEXT UNIQUE NOT NULL,
            retry_count INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            payload_json TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_haya_jobs_status_sched ON haya_jobs(status, scheduled_at ASC);

        CREATE TABLE IF NOT EXISTS haya_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            actor TEXT NOT NULL DEFAULT 'system',
            target_whatsapp_id TEXT,
            details TEXT,
            created_at TEXT NOT NULL
        );
    `);

    // Seed default HayaSettings row if not present
    const existing = db.prepare('SELECT id FROM haya_settings WHERE id = 1').get();
    if (!existing) {
        const now = new Date().toISOString();
        db.prepare(`
            INSERT INTO haya_settings (
                id, enabled, scope, timezone, ai_model, default_language, persona_prompt,
                image_sending_enabled, max_image_size_mb, image_rate_limit_per_hour,
                master_portrait_asset_id, master_portrait_path,
                voice_transcription_enabled, voice_reply_enabled,
                busy_mode_enabled, busy_auto_trigger, busy_until_ts, busy_min_minutes, busy_max_minutes, busy_delay_mode, busy_templates_json,
                night_mode_enabled, good_night_window_start, good_night_window_end,
                sleep_start_time, sleep_end_time, morning_dispatch_start, morning_dispatch_end,
                good_night_message, morning_message, image_caption, retention_days, updated_at
            ) VALUES (
                1, 1, 'dm', 'Asia/Karachi', 'gemini-3.8-flash', 'urdu', ?,
                1, 5, 5,
                'haya_master_v1', '/assets/haya_master_portrait.png',
                1, 0,
                0, 1, 0, 10, 15, 'random', ?,
                1, '20:56', '20:58',
                '21:00', '05:00', '05:10', '05:12',
                ?, ?, ?, 30, ?
            )
        `).run(
            DEFAULT_PERSONA_PROMPT,
            JSON.stringify(DEFAULT_BUSY_TEMPLATES),
            DEFAULT_GOOD_NIGHT_MESSAGE,
            DEFAULT_MORNING_MESSAGE,
            DEFAULT_IMAGE_CAPTION,
            now
        );
    }

    // Recover any 'processing' pending messages that were interrupted by a server restart
    try {
        db.prepare(`
            UPDATE haya_pending_messages
            SET status = 'pending'
            WHERE status = 'processing'
        `).run();
    } catch (_) {}

    return createHayaRepository(db);
}

function createHayaRepository(db) {
    function logHayaAudit(action, actor = 'system', targetWhatsappId = null, details = '') {
        try {
            db.prepare(`
                INSERT INTO haya_audit_logs (action, actor, target_whatsapp_id, details, created_at)
                VALUES (?, ?, ?, ?, ?)
            `).run(
                String(action),
                String(actor || 'system'),
                targetWhatsappId ? String(targetWhatsappId) : null,
                typeof details === 'object' ? JSON.stringify(details) : String(details || ''),
                new Date().toISOString()
            );
        } catch (_) {}
    }

    function getHayaSettings() {
        const row = db.prepare('SELECT * FROM haya_settings WHERE id = 1').get();
        if (!row) return null;
        let busyTemplates = DEFAULT_BUSY_TEMPLATES;
        try {
            const parsed = JSON.parse(row.busy_templates_json || '[]');
            if (Array.isArray(parsed) && parsed.length > 0) busyTemplates = parsed;
        } catch (_) {}

        return {
            enabled: Boolean(row.enabled),
            scope: row.scope || 'dm',
            timezone: row.timezone || 'Asia/Karachi',
            aiModel: row.ai_model || 'gemini-3.8-flash',
            defaultLanguage: row.default_language || 'urdu',
            personaPrompt: row.persona_prompt || DEFAULT_PERSONA_PROMPT,
            imageSendingEnabled: Boolean(row.image_sending_enabled),
            maxImageSizeMb: Number(row.max_image_size_mb || 5),
            imageRateLimitPerHour: Number(row.image_rate_limit_per_hour || 5),
            masterPortraitAssetId: row.master_portrait_asset_id || 'haya_master_v1',
            masterPortraitPath: row.master_portrait_path || '/assets/haya_master_portrait.png',
            voiceTranscriptionEnabled: Boolean(row.voice_transcription_enabled),
            voiceReplyEnabled: Boolean(row.voice_reply_enabled),
            busyModeEnabled: Boolean(row.busy_mode_enabled),
            busyAutoTrigger: Boolean(row.busy_auto_trigger),
            busyUntilTs: Number(row.busy_until_ts || 0),
            busyMinMinutes: Number(row.busy_min_minutes || 10),
            busyMaxMinutes: Number(row.busy_max_minutes || 15),
            busyDelayMode: row.busy_delay_mode || 'random',
            busyTemplates,
            nightModeEnabled: Boolean(row.night_mode_enabled),
            goodNightWindowStart: row.good_night_window_start || '20:56',
            goodNightWindowEnd: row.good_night_window_end || '20:58',
            sleepStartTime: row.sleep_start_time || '21:00',
            sleepEndTime: row.sleep_end_time || '05:00',
            morningDispatchStart: row.morning_dispatch_start || '05:10',
            morningDispatchEnd: row.morning_dispatch_end || '05:12',
            goodNightMessage: row.good_night_message || DEFAULT_GOOD_NIGHT_MESSAGE,
            morningMessage: row.morning_message || DEFAULT_MORNING_MESSAGE,
            imageCaption: row.image_caption || DEFAULT_IMAGE_CAPTION,
            retentionDays: Number(row.retention_days || 30),
            lastGoodNightDate: row.last_good_night_date || null,
            lastMorningDispatchDate: row.last_morning_dispatch_date || null,
            updatedAt: row.updated_at
        };
    }

    function updateHayaSettings(updates = {}, actor = 'admin') {
        const cur = getHayaSettings();
        const next = {
            enabled: updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : (cur.enabled ? 1 : 0),
            scope: updates.scope || cur.scope || 'dm',
            timezone: updates.timezone || cur.timezone || 'Asia/Karachi',
            ai_model: updates.aiModel || updates.ai_model || cur.aiModel || 'gemini-3.8-flash',
            default_language: updates.defaultLanguage || updates.default_language || cur.defaultLanguage || 'urdu',
            persona_prompt: updates.personaPrompt !== undefined ? String(updates.personaPrompt) : cur.personaPrompt,
            image_sending_enabled: updates.imageSendingEnabled !== undefined ? (updates.imageSendingEnabled ? 1 : 0) : (cur.imageSendingEnabled ? 1 : 0),
            max_image_size_mb: Math.max(1, Number(updates.maxImageSizeMb ?? cur.maxImageSizeMb ?? 5)),
            image_rate_limit_per_hour: Math.max(1, Number(updates.imageRateLimitPerHour ?? cur.imageRateLimitPerHour ?? 5)),
            master_portrait_asset_id: updates.masterPortraitAssetId || cur.masterPortraitAssetId,
            master_portrait_path: updates.masterPortraitPath || cur.masterPortraitPath,
            voice_transcription_enabled: updates.voiceTranscriptionEnabled !== undefined ? (updates.voiceTranscriptionEnabled ? 1 : 0) : (cur.voiceTranscriptionEnabled ? 1 : 0),
            voice_reply_enabled: updates.voiceReplyEnabled !== undefined ? (updates.voiceReplyEnabled ? 1 : 0) : (cur.voiceReplyEnabled ? 1 : 0),
            busy_mode_enabled: updates.busyModeEnabled !== undefined ? (updates.busyModeEnabled ? 1 : 0) : (cur.busyModeEnabled ? 1 : 0),
            busy_auto_trigger: updates.busyAutoTrigger !== undefined ? (updates.busyAutoTrigger ? 1 : 0) : (cur.busyAutoTrigger ? 1 : 0),
            busy_until_ts: updates.busyUntilTs !== undefined ? Number(updates.busyUntilTs) : cur.busyUntilTs,
            busy_min_minutes: Math.max(1, Number(updates.busyMinMinutes ?? cur.busyMinMinutes ?? 10)),
            busy_max_minutes: Math.max(1, Number(updates.busyMaxMinutes ?? cur.busyMaxMinutes ?? 15)),
            busy_delay_mode: updates.busyDelayMode || cur.busyDelayMode || 'random',
            busy_templates_json: Array.isArray(updates.busyTemplates)
                ? JSON.stringify(updates.busyTemplates.filter(Boolean))
                : JSON.stringify(cur.busyTemplates),
            night_mode_enabled: updates.nightModeEnabled !== undefined ? (updates.nightModeEnabled ? 1 : 0) : (cur.nightModeEnabled ? 1 : 0),
            good_night_window_start: updates.goodNightWindowStart || cur.goodNightWindowStart || '20:56',
            good_night_window_end: updates.goodNightWindowEnd || cur.goodNightWindowEnd || '20:58',
            sleep_start_time: updates.sleepStartTime || cur.sleepStartTime || '21:00',
            sleep_end_time: updates.sleepEndTime || cur.sleepEndTime || '05:00',
            morning_dispatch_start: updates.morningDispatchStart || cur.morningDispatchStart || '05:10',
            morning_dispatch_end: updates.morningDispatchEnd || cur.morningDispatchEnd || '05:12',
            good_night_message: updates.goodNightMessage !== undefined ? String(updates.goodNightMessage) : cur.goodNightMessage,
            morning_message: updates.morningMessage !== undefined ? String(updates.morningMessage) : cur.morningMessage,
            image_caption: updates.imageCaption !== undefined ? String(updates.imageCaption) : cur.imageCaption,
            retention_days: Math.max(1, Number(updates.retentionDays ?? cur.retentionDays ?? 30)),
            last_good_night_date: updates.lastGoodNightDate !== undefined ? updates.lastGoodNightDate : cur.lastGoodNightDate,
            last_morning_dispatch_date: updates.lastMorningDispatchDate !== undefined ? updates.lastMorningDispatchDate : cur.lastMorningDispatchDate,
            updated_at: new Date().toISOString()
        };

        db.prepare(`
            UPDATE haya_settings SET
                enabled = ?,
                scope = ?,
                timezone = ?,
                ai_model = ?,
                default_language = ?,
                persona_prompt = ?,
                image_sending_enabled = ?,
                max_image_size_mb = ?,
                image_rate_limit_per_hour = ?,
                master_portrait_asset_id = ?,
                master_portrait_path = ?,
                voice_transcription_enabled = ?,
                voice_reply_enabled = ?,
                busy_mode_enabled = ?,
                busy_auto_trigger = ?,
                busy_until_ts = ?,
                busy_min_minutes = ?,
                busy_max_minutes = ?,
                busy_delay_mode = ?,
                busy_templates_json = ?,
                night_mode_enabled = ?,
                good_night_window_start = ?,
                good_night_window_end = ?,
                sleep_start_time = ?,
                sleep_end_time = ?,
                morning_dispatch_start = ?,
                morning_dispatch_end = ?,
                good_night_message = ?,
                morning_message = ?,
                image_caption = ?,
                retention_days = ?,
                last_good_night_date = ?,
                last_morning_dispatch_date = ?,
                updated_at = ?
            WHERE id = 1
        `).run(
            next.enabled,
            next.scope,
            next.timezone,
            next.ai_model,
            next.default_language,
            next.persona_prompt,
            next.image_sending_enabled,
            next.max_image_size_mb,
            next.image_rate_limit_per_hour,
            next.master_portrait_asset_id,
            next.master_portrait_path,
            next.voice_transcription_enabled,
            next.voice_reply_enabled,
            next.busy_mode_enabled,
            next.busy_auto_trigger,
            next.busy_until_ts,
            next.busy_min_minutes,
            next.busy_max_minutes,
            next.busy_delay_mode,
            next.busy_templates_json,
            next.night_mode_enabled,
            next.good_night_window_start,
            next.good_night_window_end,
            next.sleep_start_time,
            next.sleep_end_time,
            next.morning_dispatch_start,
            next.morning_dispatch_end,
            next.good_night_message,
            next.morning_message,
            next.image_caption,
            next.retention_days,
            next.last_good_night_date,
            next.last_morning_dispatch_date,
            next.updated_at
        );

        logHayaAudit('update_settings', actor, null, Object.keys(updates).join(','));
        return getHayaSettings();
    }

    function getOrCreateHayaUser(whatsappId, displayName = null, languagePreference = null) {
        const normId = normalizeWhatsAppId(whatsappId);
        if (!normId) return null;

        let user = db.prepare('SELECT * FROM haya_users WHERE whatsapp_id = ?').get(normId);
        const nowIso = new Date().toISOString();
        const nowMs = Date.now();

        if (!user) {
            db.prepare(`
                INSERT INTO haya_users (
                    whatsapp_id, display_name, language_preference, ai_enabled, opted_out, blocked,
                    busy_until_ts, busy_ack_sent, last_image_sent_at, image_req_count_hour, image_req_window_start,
                    last_emotion, last_active_at, created_at, updated_at
                ) VALUES (?, ?, ?, 1, 0, 0, 0, 0, 0, 0, 0, 'neutral', ?, ?, ?)
            `).run(
                normId,
                displayName || null,
                languagePreference || 'urdu',
                nowMs,
                nowIso,
                nowIso
            );
            user = db.prepare('SELECT * FROM haya_users WHERE whatsapp_id = ?').get(normId);
        } else if (displayName || languagePreference) {
            db.prepare(`
                UPDATE haya_users
                SET display_name = COALESCE(?, display_name),
                    language_preference = COALESCE(?, language_preference),
                    updated_at = ?
                WHERE whatsapp_id = ?
            `).run(displayName || null, languagePreference || null, nowIso, normId);
            user = db.prepare('SELECT * FROM haya_users WHERE whatsapp_id = ?').get(normId);
        }
        return user;
    }

    function updateHayaUser(whatsappId, updates = {}, actor = 'system') {
        const normId = normalizeWhatsAppId(whatsappId);
        if (!normId) return null;
        const user = getOrCreateHayaUser(normId);
        if (!user) return null;

        const next = {
            display_name: updates.displayName !== undefined ? updates.displayName : user.display_name,
            language_preference: updates.languagePreference || user.language_preference,
            ai_enabled: updates.aiEnabled !== undefined ? (updates.aiEnabled ? 1 : 0) : user.ai_enabled,
            opted_out: updates.optedOut !== undefined ? (updates.optedOut ? 1 : 0) : user.opted_out,
            blocked: updates.blocked !== undefined ? (updates.blocked ? 1 : 0) : user.blocked,
            busy_until_ts: updates.busyUntilTs !== undefined ? Number(updates.busyUntilTs) : user.busy_until_ts,
            busy_ack_sent: updates.busyAckSent !== undefined ? (updates.busyAckSent ? 1 : 0) : user.busy_ack_sent,
            last_image_sent_at: updates.lastImageSentAt !== undefined ? Number(updates.lastImageSentAt) : user.last_image_sent_at,
            image_req_count_hour: updates.imageReqCountHour !== undefined ? Number(updates.imageReqCountHour) : user.image_req_count_hour,
            image_req_window_start: updates.imageReqWindowStart !== undefined ? Number(updates.imageReqWindowStart) : user.image_req_window_start,
            last_emotion: updates.lastEmotion || user.last_emotion || 'neutral',
            last_active_at: updates.lastActiveAt !== undefined ? Number(updates.lastActiveAt) : user.last_active_at,
            updated_at: new Date().toISOString()
        };

        db.prepare(`
            UPDATE haya_users SET
                display_name = ?,
                language_preference = ?,
                ai_enabled = ?,
                opted_out = ?,
                blocked = ?,
                busy_until_ts = ?,
                busy_ack_sent = ?,
                last_image_sent_at = ?,
                image_req_count_hour = ?,
                image_req_window_start = ?,
                last_emotion = ?,
                last_active_at = ?,
                updated_at = ?
            WHERE whatsapp_id = ?
        `).run(
            next.display_name,
            next.language_preference,
            next.ai_enabled,
            next.opted_out,
            next.blocked,
            next.busy_until_ts,
            next.busy_ack_sent,
            next.last_image_sent_at,
            next.image_req_count_hour,
            next.image_req_window_start,
            next.last_emotion,
            next.last_active_at,
            next.updated_at,
            normId
        );

        // If user opted out or was blocked, cancel any pending messages for this user
        if (next.opted_out === 1 || next.blocked === 1) {
            db.prepare(`
                UPDATE haya_pending_messages
                SET status = 'cancelled', last_error = 'User opted out or blocked', processed_at = ?
                WHERE whatsapp_id = ? AND status IN ('pending', 'processing')
            `).run(Date.now(), normId);
            logHayaAudit(next.opted_out ? 'user_opt_out' : 'user_blocked', actor, normId, 'Cancelled pending messages');
        }

        return db.prepare('SELECT * FROM haya_users WHERE whatsapp_id = ?').get(normId);
    }

    function listHayaUsers(search = '') {
        let sql = `
            SELECT u.*,
                   (SELECT COUNT(*) FROM haya_pending_messages p WHERE p.whatsapp_id = u.whatsapp_id AND p.status = 'pending') AS pending_count,
                   (SELECT COUNT(*) FROM haya_conversations c WHERE c.whatsapp_id = u.whatsapp_id) AS messages_count
            FROM haya_users u
        `;
        const params = [];
        if (search && String(search).trim()) {
            const q = `%${String(search).trim()}%`;
            sql += ' WHERE u.whatsapp_id LIKE ? OR u.display_name LIKE ?';
            params.push(q, q);
        }
        sql += ' ORDER BY u.last_active_at DESC, u.id DESC LIMIT 250';
        return db.prepare(sql).all(...params);
    }

    function isMessageAlreadyProcessed(sourceMessageId) {
        if (!sourceMessageId) return false;
        const inConv = db.prepare('SELECT id FROM haya_conversations WHERE source_message_id = ?').get(String(sourceMessageId));
        if (inConv) return true;
        const inQueue = db.prepare('SELECT id FROM haya_pending_messages WHERE source_message_id = ?').get(String(sourceMessageId));
        return Boolean(inQueue);
    }

    function addHayaConversationTurn({
        whatsappId,
        role,
        messageText,
        messageType = 'text',
        emotionDetected = 'neutral',
        sourceMessageId = null
    }) {
        const normId = normalizeWhatsAppId(whatsappId);
        if (!normId || !messageText) return null;

        getOrCreateHayaUser(normId);
        const nowIso = new Date().toISOString();
        const nowMs = Date.now();

        try {
            const res = db.prepare(`
                INSERT INTO haya_conversations (
                    whatsapp_id, role, message_text, message_type, emotion_detected, source_message_id, created_at, timestamp_ms
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                normId,
                role === 'assistant' || role === 'model' ? 'model' : 'user',
                String(messageText),
                String(messageType || 'text'),
                String(emotionDetected || 'neutral'),
                sourceMessageId ? String(sourceMessageId) : null,
                nowIso,
                nowMs
            );

            db.prepare('UPDATE haya_users SET last_active_at = ?, last_emotion = ?, updated_at = ? WHERE whatsapp_id = ?')
                .run(nowMs, String(emotionDetected || 'neutral'), nowIso, normId);

            return res.lastInsertRowid;
        } catch (err) {
            if (String(err.message).includes('UNIQUE')) {
                return null;
            }
            throw err;
        }
    }

    function getHayaConversationHistory(whatsappId, limit = 16) {
        const normId = normalizeWhatsAppId(whatsappId);
        if (!normId) return [];
        const rows = db.prepare(`
            SELECT * FROM haya_conversations
            WHERE whatsapp_id = ?
            ORDER BY id DESC
            LIMIT ?
        `).all(normId, Number(limit || 16));
        return rows.reverse();
    }

    function clearHayaUserHistory(whatsappId, actor = 'admin') {
        const normId = normalizeWhatsAppId(whatsappId);
        if (!normId) return 0;
        const res = db.prepare('DELETE FROM haya_conversations WHERE whatsapp_id = ?').run(normId);
        logHayaAudit('clear_user_history', actor, normId, `Deleted ${res.changes} turns`);
        return res.changes;
    }

    function deleteHayaUserData(whatsappId, actor = 'admin') {
        const normId = normalizeWhatsAppId(whatsappId);
        if (!normId) return false;
        db.prepare('DELETE FROM haya_conversations WHERE whatsapp_id = ?').run(normId);
        db.prepare('DELETE FROM haya_pending_messages WHERE whatsapp_id = ?').run(normId);
        db.prepare('DELETE FROM haya_users WHERE whatsapp_id = ?').run(normId);
        logHayaAudit('gdpr_delete_user', actor, normId, 'Complete user data wiped');
        return true;
    }

    function exportHayaUserData(whatsappId) {
        const normId = normalizeWhatsAppId(whatsappId);
        if (!normId) return null;
        const user = db.prepare('SELECT * FROM haya_users WHERE whatsapp_id = ?').get(normId);
        const conversations = db.prepare('SELECT * FROM haya_conversations WHERE whatsapp_id = ? ORDER BY id ASC').all(normId);
        const pending = db.prepare('SELECT * FROM haya_pending_messages WHERE whatsapp_id = ? ORDER BY id ASC').all(normId);
        return {
            exportedAt: new Date().toISOString(),
            whatsappId: normId,
            user: user || null,
            conversations,
            pendingMessages: pending
        };
    }

    function enqueueHayaPendingMessage({
        whatsappId,
        sessionNumber = null,
        sourceMessageId,
        messageText,
        messageType = 'text',
        receivedAt = Date.now(),
        queueReason = 'sleep',
        nextAttemptAt = 0
    }) {
        const normId = normalizeWhatsAppId(whatsappId);
        if (!normId || !messageText) return null;
        const msgId = sourceMessageId ? String(sourceMessageId) : `haya_${normId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        getOrCreateHayaUser(normId);

        try {
            const res = db.prepare(`
                INSERT INTO haya_pending_messages (
                    whatsapp_id, session_number, source_message_id, message_text, message_type,
                    received_at, queue_reason, status, retry_count, next_attempt_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?)
            `).run(
                normId,
                sessionNumber || null,
                msgId,
                String(messageText),
                String(messageType || 'text'),
                Number(receivedAt || Date.now()),
                String(queueReason || 'sleep'),
                Number(nextAttemptAt || 0)
            );
            return db.prepare('SELECT * FROM haya_pending_messages WHERE id = ?').get(res.lastInsertRowid);
        } catch (err) {
            if (String(err.message).includes('UNIQUE')) {
                return db.prepare('SELECT * FROM haya_pending_messages WHERE source_message_id = ?').get(msgId);
            }
            throw err;
        }
    }

    function cancelPendingMessageBySourceId(sourceMessageId, reason = 'Message deleted by sender') {
        if (!sourceMessageId) return 0;
        const res = db.prepare(`
            UPDATE haya_pending_messages
            SET status = 'cancelled', last_error = ?, processed_at = ?
            WHERE source_message_id = ? AND status IN ('pending', 'processing')
        `).run(String(reason), Date.now(), String(sourceMessageId));
        return res.changes;
    }

    function getPendingMessagesForUser(whatsappId, queueReason = null) {
        const normId = normalizeWhatsAppId(whatsappId);
        if (!normId) return [];
        let sql = `
            SELECT * FROM haya_pending_messages
            WHERE whatsapp_id = ? AND status = 'pending' AND next_attempt_at <= ?
        `;
        const params = [normId, Date.now()];
        if (queueReason) {
            sql += ' AND queue_reason = ?';
            params.push(queueReason);
        }
        sql += ' ORDER BY received_at ASC, id ASC';
        return db.prepare(sql).all(...params);
    }

    function getEligiblePendingUsers(queueReason = null) {
        let sql = `
            SELECT p.whatsapp_id, MIN(p.received_at) AS oldest_received_at, COUNT(*) AS pending_count
            FROM haya_pending_messages p
            JOIN haya_users u ON u.whatsapp_id = p.whatsapp_id
            WHERE p.status = 'pending'
              AND p.next_attempt_at <= ?
              AND u.opted_out = 0
              AND u.blocked = 0
              AND u.ai_enabled = 1
        `;
        const params = [Date.now()];
        if (queueReason) {
            sql += ' AND p.queue_reason = ?';
            params.push(queueReason);
        }
        sql += ' GROUP BY p.whatsapp_id ORDER BY oldest_received_at ASC';
        return db.prepare(sql).all(...params);
    }

    function markPendingMessageStatus(id, status, error = null) {
        const now = Date.now();
        if (status === 'failed') {
            const row = db.prepare('SELECT retry_count FROM haya_pending_messages WHERE id = ?').get(Number(id));
            const retries = (row?.retry_count || 0) + 1;
            const maxRetries = 3;
            const finalStatus = retries >= maxRetries ? 'failed' : 'pending';
            // Exponential backoff: 15s, 60s, 240s
            const backoffMs = Math.min(300000, Math.pow(4, retries - 1) * 15000);
            db.prepare(`
                UPDATE haya_pending_messages
                SET status = ?, retry_count = ?, next_attempt_at = ?, last_error = ?, processed_at = ?
                WHERE id = ?
            `).run(finalStatus, retries, now + backoffMs, error ? String(error) : null, now, Number(id));
            return { status: finalStatus, retries };
        }

        db.prepare(`
            UPDATE haya_pending_messages
            SET status = ?, last_error = ?, processed_at = ?
            WHERE id = ?
        `).run(String(status), error ? String(error) : null, now, Number(id));
        return { status };
    }

    function retryFailedPendingMessages(whatsappId = null) {
        const now = Date.now();
        if (whatsappId) {
            const normId = normalizeWhatsAppId(whatsappId);
            const res = db.prepare(`
                UPDATE haya_pending_messages
                SET status = 'pending', retry_count = 0, next_attempt_at = 0, last_error = NULL
                WHERE whatsapp_id = ? AND status = 'failed'
            `).run(normId);
            return res.changes;
        }
        const res = db.prepare(`
            UPDATE haya_pending_messages
            SET status = 'pending', retry_count = 0, next_attempt_at = 0, last_error = NULL
            WHERE status = 'failed'
        `).run();
        return res.changes;
    }

    function listPendingQueue(statusFilter = 'all', limit = 150) {
        let sql = 'SELECT * FROM haya_pending_messages';
        const params = [];
        if (statusFilter && statusFilter !== 'all') {
            sql += ' WHERE status = ?';
            params.push(statusFilter);
        }
        sql += ' ORDER BY received_at DESC, id DESC LIMIT ?';
        params.push(Number(limit || 150));
        return db.prepare(sql).all(...params);
    }

    function getHayaQueueStats() {
        const pending = db.prepare("SELECT COUNT(*) AS cnt FROM haya_pending_messages WHERE status = 'pending'").get()?.cnt || 0;
        const processing = db.prepare("SELECT COUNT(*) AS cnt FROM haya_pending_messages WHERE status = 'processing'").get()?.cnt || 0;
        const sent = db.prepare("SELECT COUNT(*) AS cnt FROM haya_pending_messages WHERE status = 'sent'").get()?.cnt || 0;
        const failed = db.prepare("SELECT COUNT(*) AS cnt FROM haya_pending_messages WHERE status = 'failed'").get()?.cnt || 0;
        const cancelled = db.prepare("SELECT COUNT(*) AS cnt FROM haya_pending_messages WHERE status = 'cancelled'").get()?.cnt || 0;
        const totalUsers = db.prepare("SELECT COUNT(*) AS cnt FROM haya_users").get()?.cnt || 0;
        const activeUsers = db.prepare("SELECT COUNT(*) AS cnt FROM haya_users WHERE opted_out = 0 AND blocked = 0 AND ai_enabled = 1").get()?.cnt || 0;
        const optedOutUsers = db.prepare("SELECT COUNT(*) AS cnt FROM haya_users WHERE opted_out = 1 OR blocked = 1").get()?.cnt || 0;
        const totalTurns = db.prepare("SELECT COUNT(*) AS cnt FROM haya_conversations").get()?.cnt || 0;
        return {
            pending,
            processing,
            sent,
            failed,
            cancelled,
            totalUsers,
            activeUsers,
            optedOutUsers,
            totalTurns
        };
    }

    function createOrGetHayaJob({ jobType, whatsappId = null, scheduledAt = Date.now(), idempotencyKey, payload = null }) {
        if (!idempotencyKey) throw new Error('idempotencyKey is required for HayaJob');
        const existing = db.prepare('SELECT * FROM haya_jobs WHERE idempotency_key = ?').get(String(idempotencyKey));
        if (existing) return { job: existing, created: false };

        const nowIso = new Date().toISOString();
        const res = db.prepare(`
            INSERT INTO haya_jobs (
                job_type, whatsapp_id, scheduled_at, status, idempotency_key, retry_count, payload_json, created_at, updated_at
            ) VALUES (?, ?, ?, 'pending', ?, 0, ?, ?, ?)
        `).run(
            String(jobType),
            whatsappId ? normalizeWhatsAppId(whatsappId) : null,
            Number(scheduledAt || Date.now()),
            String(idempotencyKey),
            payload ? JSON.stringify(payload) : null,
            nowIso,
            nowIso
        );
        const job = db.prepare('SELECT * FROM haya_jobs WHERE id = ?').get(res.lastInsertRowid);
        return { job, created: true };
    }

    function updateHayaJobStatus(jobId, status, error = null) {
        const nowIso = new Date().toISOString();
        db.prepare(`
            UPDATE haya_jobs
            SET status = ?, last_error = ?, updated_at = ?
            WHERE id = ?
        `).run(String(status), error ? String(error) : null, nowIso, Number(jobId));
    }

    function getGoodNightRecipients(sinceTimestampMs) {
        // Users active with Haya today OR who have pending messages, and are enabled & not opted out
        const rows = db.prepare(`
            SELECT DISTINCT u.whatsapp_id, u.display_name
            FROM haya_users u
            LEFT JOIN haya_pending_messages p ON p.whatsapp_id = u.whatsapp_id AND p.status = 'pending'
            WHERE u.ai_enabled = 1
              AND u.opted_out = 0
              AND u.blocked = 0
              AND (u.last_active_at >= ? OR p.id IS NOT NULL)
        `).all(Number(sinceTimestampMs || (Date.now() - 24 * 60 * 60 * 1000)));
        return rows;
    }

    function getHayaAuditLogs(limit = 100) {
        return db.prepare('SELECT * FROM haya_audit_logs ORDER BY id DESC LIMIT ?').all(Number(limit || 100));
    }

    function pruneExpiredHayaConversations() {
        const settings = getHayaSettings();
        const days = Number(settings?.retentionDays || 30);
        const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
        const res = db.prepare('DELETE FROM haya_conversations WHERE timestamp_ms > 0 AND timestamp_ms < ?').run(cutoffMs);
        return res.changes;
    }

    return {
        normalizeWhatsAppId,
        logHayaAudit,
        getHayaSettings,
        updateHayaSettings,
        getOrCreateHayaUser,
        updateHayaUser,
        listHayaUsers,
        isMessageAlreadyProcessed,
        addHayaConversationTurn,
        getHayaConversationHistory,
        clearHayaUserHistory,
        deleteHayaUserData,
        exportHayaUserData,
        enqueueHayaPendingMessage,
        cancelPendingMessageBySourceId,
        getPendingMessagesForUser,
        getEligiblePendingUsers,
        markPendingMessageStatus,
        retryFailedPendingMessages,
        listPendingQueue,
        getHayaQueueStats,
        createOrGetHayaJob,
        updateHayaJobStatus,
        getGoodNightRecipients,
        getHayaAuditLogs,
        pruneExpiredHayaConversations
    };
}

module.exports = {
    normalizeWhatsAppId,
    initHayaSchema
};
