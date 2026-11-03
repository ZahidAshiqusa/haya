'use strict';

/**
 * Haya AI Conversation Engine, Voice Note Transcriber, Busy Queue & Asia/Karachi Scheduler
 * Preserves 100% of existing bot commands, buttons, and features.
 */

const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const { GoogleGenAI } = require('@google/genai');

const database = require('./database');
const { DATA_DIR, CONFIG_PATH } = require('./storagePaths');
const hayaPersona = require('./hayaPersona');
const hayaPortrait = require('./hayaPortrait');

const TMP_AUDIO_DIR = path.join(DATA_DIR, 'tmp_haya_audio');
try {
    if (!fs.existsSync(TMP_AUDIO_DIR)) fs.mkdirSync(TMP_AUDIO_DIR, { recursive: true });
} catch (_) {}

// Shared server-side Gemini client initialized per @google/genai skill guidelines
let _genaiClient = null;
let _lastApiKey = null;

function getGeminiClient() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || !String(apiKey).trim()) {
        return null;
    }
    if (!_genaiClient || _lastApiKey !== apiKey) {
        _genaiClient = new GoogleGenAI({
            apiKey: String(apiKey).trim(),
            httpOptions: {
                headers: {
                    'User-Agent': 'aistudio-build',
                },
            },
        });
        _lastApiKey = apiKey;
    }
    return _genaiClient;
}

// In-memory runtime deduplication cache (backed by SQLite UNIQUE indexes)
const recentMessageIds = new Set();
function rememberMessageId(msgId) {
    if (!msgId) return false;
    const key = String(msgId);
    if (recentMessageIds.has(key)) return true;
    recentMessageIds.add(key);
    if (recentMessageIds.size > 1000) {
        const oldest = recentMessageIds.values().next().value;
        recentMessageIds.delete(oldest);
    }
    return false;
}

// Parse "HH:mm" into minutes since midnight (0 - 1439)
function parseTimeMinutes(hhmm, fallback = 0) {
    if (!hhmm || typeof hhmm !== 'string') return fallback;
    const parts = hhmm.trim().split(':');
    if (parts.length < 2) return fallback;
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (isNaN(h) || isNaN(m)) return fallback;
    return Math.max(0, Math.min(1439, h * 60 + m));
}

function isMinutesWithinWindow(currentMin, startMin, endMin) {
    if (startMin <= endMin) {
        return currentMin >= startMin && currentMin <= endMin;
    }
    // Crosses midnight (e.g., 21:00 [1260] -> 05:00 [300])
    return currentMin >= startMin || currentMin < endMin;
}

/**
 * Calculate Pakistan Time (Asia/Karachi) state and schedule windows
 * Supports optional overrideTimestampMs or overridePktHHMM for deterministic testing
 */
function getPakistanTimeState(options = {}) {
    const settings = database.getHayaSettings();
    const tz = settings?.timezone || 'Asia/Karachi';
    const nowMoment = options.overrideTimestampMs
        ? moment(Number(options.overrideTimestampMs)).tz(tz)
        : moment().tz(tz);

    const dateStr = options.overrideDateStr || nowMoment.format('YYYY-MM-DD');
    const timeStr = options.overrideTimeStr || nowMoment.format('HH:mm');
    const timeWithSec = options.overrideTimeStr ? `${options.overrideTimeStr}:00` : nowMoment.format('HH:mm:ss');

    const currentMin = parseTimeMinutes(timeStr, nowMoment.hours() * 60 + nowMoment.minutes());
    const gnStartMin = parseTimeMinutes(settings.goodNightWindowStart || '20:56', 20 * 60 + 56);
    const gnEndMin = parseTimeMinutes(settings.goodNightWindowEnd || '20:58', 20 * 60 + 58);
    const sleepStartMin = parseTimeMinutes(settings.sleepStartTime || '21:00', 21 * 60);
    const sleepEndMin = parseTimeMinutes(settings.sleepEndTime || '05:00', 5 * 60);
    const morningStartMin = parseTimeMinutes(settings.morningDispatchStart || '05:10', 5 * 60 + 10);
    const morningEndMin = parseTimeMinutes(settings.morningDispatchEnd || '05:12', 5 * 60 + 12);

    const isGoodNightWindow = Boolean(
        settings.nightModeEnabled && isMinutesWithinWindow(currentMin, gnStartMin, gnEndMin)
    );

    // Sleep mode is strictly active from sleepStartTime (21:00) until sleepEndTime (05:00)
    const isSleepMode = Boolean(
        settings.nightModeEnabled && isMinutesWithinWindow(currentMin, sleepStartMin, sleepEndMin)
    );

    // Morning dispatch eligible window (starts at 05:10-05:12, and recovers up to 09:00 if missed)
    const isMorningDispatchWindow = Boolean(
        settings.nightModeEnabled &&
        !isSleepMode &&
        currentMin >= morningStartMin &&
        currentMin <= Math.max(morningEndMin, 9 * 60)
    );

    const nowMs = options.overrideTimestampMs ? Number(options.overrideTimestampMs) : Date.now();
    const isGlobalBusy = Boolean(
        settings.busyModeEnabled && (!settings.busyUntilTs || settings.busyUntilTs > nowMs)
    );

    let currentState = 'available';
    if (!settings.enabled) {
        currentState = 'disabled';
    } else if (isSleepMode) {
        currentState = 'sleeping';
    } else if (isGlobalBusy) {
        currentState = 'busy';
    } else if (isMorningDispatchWindow && settings.lastMorningDispatchDate !== dateStr) {
        currentState = 'morning_dispatch';
    }

    return {
        timezone: tz,
        dateStr,
        timeStr,
        timeWithSec,
        currentMin,
        isGoodNightWindow,
        isSleepMode,
        isMorningDispatchWindow,
        isGlobalBusy,
        currentState,
        startOfDayMs: nowMoment.clone().startOf('day').valueOf()
    };
}

/**
 * Helper: Call Gemini with exponential backoff retry on transient errors / 429
 */
async function callGeminiWithRetry(fn, maxRetries = 2, baseDelayMs = 800) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn(attempt);
        } catch (err) {
            lastError = err;
            const status = err?.status || err?.statusCode || (String(err?.message || '').includes('429') ? 429 : 500);
            const isRetryable = status === 429 || status >= 500 || /timeout|network|exhausted|unavailable/i.test(String(err?.message || ''));
            if (!isRetryable || attempt >= maxRetries) {
                break;
            }
            const waitMs = baseDelayMs * Math.pow(2, attempt);
            await new Promise(r => setTimeout(r, waitMs));
        }
    }
    throw lastError;
}

/**
 * Transcribe a WhatsApp audio buffer using Gemini ('gemini-3.5-transcribe')
 */
async function transcribeAudioBuffer(audioBuffer, mimeType = 'audio/ogg', durationSec = 0) {
    if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
        return { ok: false, reason: 'empty_audio', userMessageUrdu: 'معذرت، آپ کا وائس نوٹ ڈاؤن لوڈ نہیں ہو سکا۔ پلیز دوبارہ بھیج دیں۔ 🙏' };
    }

    // Validate file size (max 15 MB)
    const maxAudioBytes = 15 * 1024 * 1024;
    if (audioBuffer.length > maxAudioBytes) {
        return { ok: false, reason: 'file_too_large', userMessageUrdu: 'معذرت، یہ آڈیو فائل بہت بڑی ہے۔ پلیز چھوٹا وائس نوٹ بھیجیں۔' };
    }

    // Validate duration if provided (max 5 minutes)
    if (durationSec && Number(durationSec) > 300) {
        return { ok: false, reason: 'duration_too_long', userMessageUrdu: 'معذرت، وائس نوٹ بہت طویل ہے۔ پلیز مختصر وائس نوٹ بھیجیں۔' };
    }

    // Normalize MIME type
    const cleanMime = String(mimeType || 'audio/ogg').split(';')[0].trim().toLowerCase();
    const supportedMimes = new Set([
        'audio/ogg',
        'audio/opus',
        'audio/mpeg',
        'audio/mp3',
        'audio/mp4',
        'audio/wav',
        'audio/x-wav',
        'audio/webm',
        'audio/aac'
    ]);

    if (!supportedMimes.has(cleanMime)) {
        return { ok: false, reason: 'unsupported_format', userMessageUrdu: 'معذرت، یہ آڈیو فارمیٹ سپورٹڈ نہیں ہے۔ پلیز نارمل واٹس ایپ وائس نوٹ بھیجیں۔' };
    }

    // Write to temporary file during processing and ensure cleanup in finally block
    const tmpFile = path.join(TMP_AUDIO_DIR, `vn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.ogg`);
    try {
        fs.writeFileSync(tmpFile, audioBuffer);

        const ai = getGeminiClient();
        if (!ai) {
            return {
                ok: false,
                reason: 'api_unavailable',
                userMessageUrdu: 'معذرت، اس وقت آواز سمجھنے والا سسٹم مصروف ہے۔ پلیز اپنی بات ٹیکسٹ میں لکھ کر بھیج دیں۔ 😊'
            };
        }

        const base64Audio = audioBuffer.toString('base64');
        const transcribeModel = process.env.HAYA_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe';

        const response = await callGeminiWithRetry(async () => {
            return await ai.models.generateContent({
                model: transcribeModel,
                contents: {
                    parts: [
                        {
                            inlineData: {
                                mimeType: cleanMime === 'audio/opus' ? 'audio/ogg' : cleanMime,
                                data: base64Audio,
                            },
                        },
                        {
                            text: 'Transcribe this voice note accurately. If the speaker is speaking Urdu, transcribe in Urdu script. If clear speech is not audible, output ONLY "[UNCLEAR]".',
                        },
                    ],
                },
            });
        }, 2, 700);

        const transcript = String(response?.text || '').trim();
        if (!transcript || transcript === '[UNCLEAR]' || transcript.length < 2) {
            return {
                ok: false,
                reason: 'unclear_audio',
                userMessageUrdu: 'معذرت، آپ کی آواز صاف سنائی نہیں دی۔ کیا آپ پلیز دوبارہ وائس نوٹ بھیج سکتے ہیں؟ 🥺'
            };
        }

        return {
            ok: true,
            transcript,
            mimeType: cleanMime
        };
    } catch (err) {
        console.error('[hayaService] Voice transcription error:', err.message);
        return {
            ok: false,
            reason: 'transcription_failed',
            error: err.message,
            userMessageUrdu: 'معذرت، آپ کا وائس نوٹ سمجھنے میں تھوڑی دشواری ہوئی۔ پلیز دوبارہ وائس نوٹ یا ٹیکسٹ پیغام بھیج دیں۔'
        };
    } finally {
        // Mandatory retention cleanup: delete temporary audio file immediately after processing
        try {
            if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        } catch (_) {}
    }
}

/**
 * Optional Text-to-Speech (TTS) generator using Gemini ('gemini-3.8-flash-lite-tts')
 */
async function synthesizeHayaVoiceReply(urduText) {
    const ai = getGeminiClient();
    if (!ai || !urduText) return null;
    try {
        const ttsModel = process.env.HAYA_TTS_MODEL || 'gemini-3.8-flash-lite-tts';
        const response = await ai.models.generateContent({
            model: ttsModel,
            contents: [
                {
                    role: 'user',
                    parts: [
                        {
                            text: urduText,
                            speechMetadata: {
                                style: 'Warm, polite, friendly young Pakistani Urdu female voice',
                            },
                        },
                    ],
                },
            ],
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: { voiceName: 'Kore' },
                    },
                },
            },
        });
        const base64Audio = response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
            return Buffer.from(base64Audio, 'base64');
        }
    } catch (err) {
        console.warn('[hayaService] Optional TTS generation warning:', err.message);
    }
    return null;
}

/**
 * Generate Haya's conversational Urdu response for a user message
 */
async function generateHayaReply({
    whatsappId,
    userMessage,
    messageType = 'text',
    isMorningBatch = false,
    overridePktOptions = {}
}) {
    const normId = database.normalizeWhatsAppId(whatsappId);
    const settings = database.getHayaSettings();
    const userProfile = database.getOrCreateHayaUser(normId);
    const pktState = getPakistanTimeState(overridePktOptions);

    const detectedEmotion = hayaPersona.detectMessageEmotion(userMessage);
    const detectedLang = hayaPersona.detectLanguageScript(userMessage);

    // Update user's language preference if detected
    if (detectedLang && userProfile && userProfile.language_preference !== detectedLang) {
        database.updateHayaUser(normId, { languagePreference: detectedLang, lastEmotion: detectedEmotion });
    }

    // Retrieve per-user conversation history (strictly isolated by normId)
    const historyRows = database.getHayaConversationHistory(normId, 14);

    const systemInstruction = hayaPersona.buildHayaSystemInstruction({
        settings,
        userProfile,
        pktTimeStr: pktState.timeStr,
        pktDateStr: pktState.dateStr,
        hayaState: pktState.currentState,
        messageType,
        detectedEmotion,
        isMorningBatch
    });

    const ai = getGeminiClient();
    let replyText = null;
    let usedModel = settings.aiModel || 'gemini-3.8-flash';
    let usedFallback = false;

    if (ai) {
        try {
            // Format history contents for Gemini multi-turn context
            const contents = [];
            for (const row of historyRows) {
                contents.push({
                    role: row.role === 'model' ? 'model' : 'user',
                    parts: [{ text: String(row.message_text || '') }]
                });
            }
            contents.push({
                role: 'user',
                parts: [{
                    text: messageType === 'voice_transcript'
                        ? `[صارف نے وائس نوٹ بھیجا جس کا ٹرانسکرپٹ یہ ہے]: ${userMessage}`
                        : String(userMessage)
                }]
            });

            const response = await callGeminiWithRetry(async () => {
                return await ai.models.generateContent({
                    model: usedModel,
                    contents,
                    config: {
                        systemInstruction,
                    }
                });
            }, 2, 700);

            if (response && response.text && String(response.text).trim()) {
                replyText = String(response.text).trim();
            }
        } catch (err) {
            console.warn(`[hayaService] Gemini API error (${err.message}), using context-aware Urdu fallback.`);
            usedFallback = true;
        }
    } else {
        usedFallback = true;
    }

    if (!replyText) {
        replyText = hayaPersona.generateGracefulUrduFallback(
            userMessage,
            detectedEmotion,
            messageType === 'voice_transcript'
        );
    }

    return {
        replyText,
        detectedEmotion,
        detectedLang,
        usedModel: usedFallback ? 'haya-urdu-fallback' : usedModel,
        usedFallback
    };
}

/**
 * Helper: Safely send a WhatsApp message (text, image, or audio) via Baileys socket
 */
async function sendWhatsAppPayload(sock, jid, payload, quotedMsg = null) {
    const targetJid = database.normalizeWhatsAppId(jid);
    if (!targetJid) {
        throw new Error('Invalid WhatsApp JID');
    }

    let activeSock = sock;
    if (!activeSock || typeof activeSock.sendMessage !== 'function') {
        try {
            const sessionManager = require('./sessionManager');
            activeSock = sessionManager.getActiveSocket();
        } catch (_) {}
    }

    if (!activeSock || typeof activeSock.sendMessage !== 'function') {
        const err = new Error('WhatsApp socket not connected');
        err.code = 'SOCKET_DISCONNECTED';
        throw err;
    }

    const opts = quotedMsg ? { quoted: quotedMsg } : undefined;
    const res = await activeSock.sendMessage(targetJid, payload, opts);
    return res;
}

/**
 * Handle an image / portrait request for Haya
 */
async function handleHayaPortraitRequest(sock, whatsappId, quotedMessage = null, sourceMessageId = null) {
    const normId = database.normalizeWhatsAppId(whatsappId);
    const settings = database.getHayaSettings();
    const user = database.getOrCreateHayaUser(normId);

    if (!settings.imageSendingEnabled) {
        const disabledMsg = 'معذرت، اس وقت تصویر بھیجنے کی سہولت بند ہے۔ 😊';
        await sendWhatsAppPayload(sock, normId, { text: disabledMsg }, quotedMessage);
        return { sent: false, reason: 'image_sending_disabled', replyText: disabledMsg };
    }

    // Per-user hourly rate limit check for duplicate image requests
    const now = Date.now();
    const oneHourMs = 60 * 60 * 1000;
    const windowStart = Number(user.image_req_window_start || 0);
    let countInWindow = Number(user.image_req_count_hour || 0);

    if (now - windowStart > oneHourMs) {
        countInWindow = 0;
    }

    const maxPerHour = Math.max(1, Number(settings.imageRateLimitPerHour || 5));
    if (countInWindow >= maxPerHour) {
        const rateLimitMsg = 'میں نے ابھی تھوڑی دیر پہلے ہی اپنی تصویر بھیجی تھی 😊۔ پلیز کچھ دیر بعد دوبارہ مانگ لیجیے گا۔';
        await sendWhatsAppPayload(sock, normId, { text: rateLimitMsg }, quotedMessage);
        return { sent: false, reason: 'rate_limited', replyText: rateLimitMsg };
    }

    // Retrieve & validate fixed master portrait
    const portrait = await hayaPortrait.getApprovedHayaPortrait(settings);
    if (!portrait || !portrait.available || !portrait.buffer) {
        const honestMissingMsg = 'معذرت، اس وقت میری تصویر فائل دستیاب نہیں ہو سکی۔ جیسے ہی اپڈیٹ ہو گی میں ضرور شیئر کروں گی۔ 🙏';
        await sendWhatsAppPayload(sock, normId, { text: honestMissingMsg }, quotedMessage);
        return { sent: false, reason: 'portrait_unavailable', replyText: honestMissingMsg };
    }

    const caption = settings.imageCaption || hayaPersona.DEFAULT_IMAGE_CAPTION;

    await sendWhatsAppPayload(sock, normId, {
        image: portrait.buffer,
        mimetype: portrait.mimeType || 'image/png',
        caption
    }, quotedMessage);

    // Update user rate-limit counters & conversation history
    database.updateHayaUser(normId, {
        lastImageSentAt: now,
        imageReqCountHour: countInWindow + 1,
        imageReqWindowStart: countInWindow === 0 ? now : windowStart,
        lastActiveAt: now
    });

    database.addHayaConversationTurn({
        whatsappId: normId,
        role: 'user',
        messageText: '[تصویر کی درخواست]',
        messageType: 'image_request',
        emotionDetected: 'happy',
        sourceMessageId
    });

    database.addHayaConversationTurn({
        whatsappId: normId,
        role: 'model',
        messageText: caption,
        messageType: 'image',
        emotionDetected: 'happy'
    });

    return {
        sent: true,
        assetId: portrait.assetId,
        caption,
        sizeBytes: portrait.sizeBytes
    };
}

/**
 * Trigger Busy Mode (10 - 15 minutes configurable delay) for a specific user or globally
 */
function triggerBusyMode({ whatsappId = null, durationMinutes = null, actor = 'admin' } = {}) {
    const settings = database.getHayaSettings();
    const minM = Math.max(1, Number(settings.busyMinMinutes || 10));
    const maxM = Math.max(minM, Number(settings.busyMaxMinutes || 15));

    let chosenMinutes = durationMinutes ? Number(durationMinutes) : null;
    if (!chosenMinutes || isNaN(chosenMinutes)) {
        if (settings.busyDelayMode === 'fixed') {
            chosenMinutes = minM;
        } else {
            chosenMinutes = Math.floor(Math.random() * (maxM - minM + 1)) + minM;
        }
    }

    const busyUntilTs = Date.now() + chosenMinutes * 60 * 1000;
    const templates = Array.isArray(settings.busyTemplates) && settings.busyTemplates.length > 0
        ? settings.busyTemplates
        : hayaPersona.DEFAULT_BUSY_TEMPLATES;
    const busyMessage = templates[Math.floor(Math.random() * templates.length)];

    if (whatsappId) {
        const normId = database.normalizeWhatsAppId(whatsappId);
        database.updateHayaUser(normId, {
            busyUntilTs,
            busyAckSent: 0
        }, actor);
        database.logHayaAudit('trigger_user_busy_mode', actor, normId, `${chosenMinutes} mins until ${new Date(busyUntilTs).toISOString()}`);
        return { scope: 'user', whatsappId: normId, durationMinutes: chosenMinutes, busyUntilTs, busyMessage };
    }

    database.updateHayaSettings({
        busyModeEnabled: true,
        busyUntilTs
    }, actor);

    // Reset busy_ack_sent on users so each active user gets at most 1 acknowledgement during this busy window
    try {
        database.db.prepare('UPDATE haya_users SET busy_ack_sent = 0').run();
    } catch (_) {}

    database.logHayaAudit('trigger_global_busy_mode', actor, null, `${chosenMinutes} mins until ${new Date(busyUntilTs).toISOString()}`);
    return { scope: 'global', durationMinutes: chosenMinutes, busyUntilTs, busyMessage };
}

/**
 * Check if a user is currently in Busy Mode (either per-user or global)
 */
function getUserBusyState(userProfile, settings, nowMs = Date.now()) {
    if (userProfile && Number(userProfile.busy_until_ts || 0) > nowMs) {
        return {
            isBusy: true,
            busyUntilTs: Number(userProfile.busy_until_ts),
            ackAlreadySent: Boolean(userProfile.busy_ack_sent)
        };
    }

    if (settings.busyModeEnabled) {
        if (Number(settings.busyUntilTs || 0) > nowMs) {
            return {
                isBusy: true,
                busyUntilTs: Number(settings.busyUntilTs),
                ackAlreadySent: Boolean(userProfile?.busy_ack_sent)
            };
        }
        // If busyUntilTs was 0 (indefinite manual toggle), default to a 12-minute rolling window
        if (!settings.busyUntilTs || Number(settings.busyUntilTs) === 0) {
            const defaultUntil = nowMs + Number(settings.busyMinMinutes || 10) * 60 * 1000;
            return {
                isBusy: true,
                busyUntilTs: defaultUntil,
                ackAlreadySent: Boolean(userProfile?.busy_ack_sent)
            };
        }
    }

    return { isBusy: false, busyUntilTs: 0, ackAlreadySent: false };
}

/**
 * Determine if an incoming message matches an existing command, button, or game so Haya yields priority
 */
function shouldBypassHaya(sock, chatId, message, rawText) {
    if (!message || !message.message) return true;
    if (message.key?.fromMe) return true;
    if (!chatId || chatId === 'status@broadcast' || chatId.endsWith('@newsletter')) return true;

    let m = message.message;
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;

    // 1. Interactive button / list replies belong to existing button handlers
    if (
        m.buttonsResponseMessage ||
        m.templateButtonReplyMessage ||
        m.interactiveResponseMessage ||
        m.listResponseMessage ||
        m.pollUpdateMessage ||
        m.reactionMessage ||
        m.protocolMessage
    ) {
        return true;
    }

    const trimmed = String(rawText || '').trim();
    if (!trimmed) return false; // Could be an audio/voice note without text

    // 2. Check configured prefix & common command prefixes (. ! # /)
    let prefix = '.';
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            if (cfg.PREFIX) prefix = cfg.PREFIX;
        }
    } catch (_) {}

    if (trimmed.startsWith(prefix) || /^[.!#/]/.test(trimmed)) {
        const withoutPrefix = trimmed.replace(/^[.!#/]+/, '').trim();
        const firstWord = (withoutPrefix.split(/[\s/]+/)[0] || '').toLowerCase();

        // Always yield to custom commands (.button, .ptv, .voice, .😍, .qouted, .online, .haya)
        if (['button', 'ptv', 'voice', '😍', 'qouted', 'quoted', 'online', 'haya', 'menu', 'help', 'ping', 'alive'].includes(firstWord)) {
            return true;
        }

        // Check registered plugin commands
        try {
            const pluginLoader = require('./pluginLoader');
            if (pluginLoader.pluginMap && pluginLoader.pluginMap.has(firstWord)) {
                return true;
            }
        } catch (_) {}
    }

    // 3. Emoji View-Once shortcut
    if (trimmed === '😍') return true;

    return false;
}

/**
 * Extract text or audio node from a Baileys message
 */
function inspectIncomingWhatsAppMessage(message) {
    if (!message || !message.message) return { type: 'unknown', text: '', audioNode: null };
    let m = message.message;
    if (m.ephemeralMessage?.message) m = m.ephemeralMessage.message;
    if (m.viewOnceMessage?.message) m = m.viewOnceMessage.message;
    if (m.viewOnceMessageV2?.message) m = m.viewOnceMessageV2.message;

    if (m.audioMessage) {
        return {
            type: 'audio',
            text: '',
            audioNode: m.audioMessage,
            mimeType: m.audioMessage.mimetype || 'audio/ogg',
            durationSec: Number(m.audioMessage.seconds || 0),
            isPtt: Boolean(m.audioMessage.ptt)
        };
    }

    const text = (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        ''
    ).trim();

    return {
        type: text ? 'text' : 'other',
        text,
        audioNode: null
    };
}

/**
 * Core Entry Point: Handle an incoming WhatsApp message for Haya AI
 */
async function handleIncomingHayaMessage(sock, message, options = {}) {
    if (!message || !message.key || !message.message) {
        return { handled: false, reason: 'invalid_message' };
    }

    const chatId = message.key.remoteJid;
    const sourceMessageId = message.key.id;
    const pushName = message.pushName || null;

    const inspected = inspectIncomingWhatsAppMessage(message);

    // 1. Preserve priority for all existing commands, buttons, and system messages
    if (shouldBypassHaya(sock, chatId, message, inspected.text)) {
        return { handled: false, reason: 'bypassed_to_existing_command_or_button' };
    }

    // Ignore unsupported non-text/non-audio messages (e.g. stickers, contacts)
    if (inspected.type !== 'text' && inspected.type !== 'audio') {
        return { handled: false, reason: 'unsupported_message_type' };
    }

    const settings = database.getHayaSettings();
    if (!settings || !settings.enabled) {
        return { handled: false, reason: 'haya_disabled_globally' };
    }

    // 2. Check Scope (Direct Messages only by default per user's Phase 1 confirmation)
    const isGroup = String(chatId).endsWith('@g.us');
    if (isGroup) {
        if (settings.scope === 'dm') {
            return { handled: false, reason: 'dm_only_scope' };
        }
        if (settings.scope === 'dm_and_mentions') {
            const mentioned = /\bhaya\b|حیا/i.test(inspected.text);
            if (!mentioned) {
                return { handled: false, reason: 'group_not_mentioned' };
            }
        }
    }

    const senderRaw = isGroup
        ? (message.key.participant || chatId)
        : chatId;
    const whatsappId = database.normalizeWhatsAppId(senderRaw);
    if (!whatsappId) {
        return { handled: false, reason: 'invalid_whatsapp_id' };
    }

    // 3. Duplicate Webhook / Message Event Protection
    if (sourceMessageId) {
        if (rememberMessageId(sourceMessageId) || database.isMessageAlreadyProcessed(sourceMessageId)) {
            return { handled: false, reason: 'duplicate_message_id', sourceMessageId };
        }
    }

    // 4. Retrieve or initialize per-user profile
    const userProfile = database.getOrCreateHayaUser(whatsappId, pushName);

    // 5. Check STOP / UNSUBSCRIBE Opt-Out or START Opt-In commands
    if (inspected.type === 'text' && hayaPersona.isOptOutRequest(inspected.text)) {
        database.updateHayaUser(whatsappId, { optedOut: true }, 'user');
        const optOutReply = 'آپ کی درخواست پر حیا اے آئی کے خودکار پیغامات آپ کے نمبر کے لیے بند کر دیے گئے ہیں۔ اگر مستقبل میں دوبارہ بات کرنی ہو تو START لکھ کر بھیجیں۔ اللہ حافظ! 🙏';
        await sendWhatsAppPayload(sock, chatId, { text: optOutReply }, message).catch(() => {});
        return { handled: true, action: 'opted_out', whatsappId };
    }

    if (inspected.type === 'text' && hayaPersona.isOptInRequest(inspected.text)) {
        database.updateHayaUser(whatsappId, { optedOut: false }, 'user');
        const optInReply = 'خوش آمدید! حیا اے آئی دوبارہ فعال ہو گئی ہے۔ بتائیں کیسے ہیں آپ؟ 😊';
        await sendWhatsAppPayload(sock, chatId, { text: optInReply }, message).catch(() => {});
        return { handled: true, action: 'opted_in', whatsappId };
    }

    // 6. Enforce Opt-Out, Block, and Per-User AI Enable rules
    if (userProfile.opted_out || userProfile.blocked || !userProfile.ai_enabled) {
        return { handled: false, reason: 'user_opted_out_or_disabled', whatsappId };
    }

    // 7. If incoming message is a Voice Note / Audio, download & transcribe first
    let effectiveText = inspected.text;
    let effectiveMessageType = 'text';

    if (inspected.type === 'audio') {
        if (!settings.voiceTranscriptionEnabled) {
            return { handled: false, reason: 'voice_transcription_disabled' };
        }

        let audioBuffer = options.mockAudioBuffer || null;
        if (!audioBuffer) {
            try {
                const stream = await downloadContentFromMessage(inspected.audioNode, 'audio');
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                audioBuffer = Buffer.concat(chunks);
            } catch (dlErr) {
                console.error('[hayaService] Audio download failed:', dlErr.message);
                const errMsg = 'معذرت، آپ کا وائس نوٹ ڈاؤن لوڈ نہیں ہو سکا۔ پلیز دوبارہ بھیج دیں۔ 🙏';
                await sendWhatsAppPayload(sock, chatId, { text: errMsg }, message).catch(() => {});
                return { handled: true, action: 'audio_download_error', error: dlErr.message };
            }
        }

        const transResult = options.mockTranscript
            ? { ok: true, transcript: options.mockTranscript }
            : await transcribeAudioBuffer(audioBuffer, inspected.mimeType, inspected.durationSec);

        if (!transResult.ok) {
            await sendWhatsAppPayload(sock, chatId, { text: transResult.userMessageUrdu }, message).catch(() => {});
            return { handled: true, action: 'audio_transcription_rejected', reason: transResult.reason };
        }

        effectiveText = transResult.transcript;
        effectiveMessageType = 'voice_transcript';
    }

    if (!effectiveText || !effectiveText.trim()) {
        return { handled: false, reason: 'empty_message_content' };
    }

    // 8. Check Pakistan Time Sleep Mode (9:00 PM - 5:00 AM Asia/Karachi)
    const pktState = getPakistanTimeState(options.overridePktOptions || {});
    if (pktState.isSleepMode) {
        const queued = database.enqueueHayaPendingMessage({
            whatsappId,
            sessionNumber: sock?._sessionNumber || null,
            sourceMessageId,
            messageText: effectiveText,
            messageType: effectiveMessageType,
            receivedAt: options.overridePktOptions?.overrideTimestampMs || Date.now(),
            queueReason: 'sleep',
            nextAttemptAt: 0
        });
        return {
            handled: true,
            action: 'queued_for_sleep_mode',
            whatsappId,
            queueItem: queued
        };
    }

    // 9. Check Busy Mode (10 - 15 minutes delayed queue)
    const nowMs = options.overridePktOptions?.overrideTimestampMs || Date.now();
    let busyState = getUserBusyState(userProfile, settings, nowMs);

    // Optional Smart Auto-Trigger (if enabled by admin and user sends a burst of messages)
    if (!busyState.isBusy && settings.busyAutoTrigger && options.allowSmartAutoBusy === true) {
        triggerBusyMode({ whatsappId, actor: 'smart_auto' });
        const refreshedUser = database.getOrCreateHayaUser(whatsappId);
        busyState = getUserBusyState(refreshedUser, database.getHayaSettings(), nowMs);
    }

    if (busyState.isBusy) {
        const queued = database.enqueueHayaPendingMessage({
            whatsappId,
            sessionNumber: sock?._sessionNumber || null,
            sourceMessageId,
            messageText: effectiveText,
            messageType: effectiveMessageType,
            receivedAt: nowMs,
            queueReason: 'busy',
            nextAttemptAt: busyState.busyUntilTs
        });

        let ackSentNow = false;
        let busyAckText = null;

        // Send short Urdu busy acknowledgement ONLY ONCE per busy period for this user
        if (!busyState.ackAlreadySent) {
            const templates = Array.isArray(settings.busyTemplates) && settings.busyTemplates.length > 0
                ? settings.busyTemplates
                : hayaPersona.DEFAULT_BUSY_TEMPLATES;
            busyAckText = templates[Math.floor(Math.random() * templates.length)];

            database.updateHayaUser(whatsappId, { busyAckSent: true, lastActiveAt: nowMs }, 'system');
            await sendWhatsAppPayload(sock, chatId, { text: busyAckText }, message).catch(() => {});
            ackSentNow = true;
        }

        return {
            handled: true,
            action: 'queued_for_busy_mode',
            whatsappId,
            ackSentNow,
            busyAckText,
            busyUntilTs: busyState.busyUntilTs,
            queueItem: queued
        };
    }

    // 10. Check if user is asking for Haya's picture / photo / tasveer
    if (hayaPersona.isImageRequest(effectiveText)) {
        const imgRes = await handleHayaPortraitRequest(sock, chatId, message, sourceMessageId);
        return {
            handled: true,
            action: 'portrait_request',
            whatsappId,
            ...imgRes
        };
    }

    // 11. Normal Available Mode Conversation -> Generate Haya AI Urdu response
    try {
        if (sock && typeof sock.sendPresenceUpdate === 'function') {
            await sock.sendPresenceUpdate('composing', chatId).catch(() => {});
        }

        const aiResult = await generateHayaReply({
            whatsappId,
            userMessage: effectiveText,
            messageType: effectiveMessageType,
            isMorningBatch: false,
            overridePktOptions: options.overridePktOptions || {}
        });

        // Save user message & Haya reply in per-user conversation history
        database.addHayaConversationTurn({
            whatsappId,
            role: 'user',
            messageText: effectiveText,
            messageType: effectiveMessageType,
            emotionDetected: aiResult.detectedEmotion,
            sourceMessageId
        });

        await sendWhatsAppPayload(sock, chatId, { text: aiResult.replyText }, message);

        database.addHayaConversationTurn({
            whatsappId,
            role: 'model',
            messageText: aiResult.replyText,
            messageType: 'text',
            emotionDetected: aiResult.detectedEmotion
        });

        // Optional TTS Voice Reply if enabled in Admin settings
        if (settings.voiceReplyEnabled) {
            const wavBuffer = await synthesizeHayaVoiceReply(aiResult.replyText);
            if (wavBuffer) {
                await sendWhatsAppPayload(sock, chatId, {
                    audio: wavBuffer,
                    mimetype: 'audio/wav',
                    ptt: true
                }).catch(() => {});
            }
        }

        if (sock && typeof sock.sendPresenceUpdate === 'function') {
            await sock.sendPresenceUpdate('paused', chatId).catch(() => {});
        }

        return {
            handled: true,
            action: 'replied',
            whatsappId,
            transcript: effectiveMessageType === 'voice_transcript' ? effectiveText : undefined,
            replyText: aiResult.replyText,
            detectedEmotion: aiResult.detectedEmotion,
            usedModel: aiResult.usedModel
        };
    } catch (err) {
        console.error('[hayaService] Failed to send Haya reply:', err.message);
        // Enqueue for retry so message is not lost on temporary WhatsApp socket glitch
        const queued = database.enqueueHayaPendingMessage({
            whatsappId,
            sessionNumber: sock?._sessionNumber || null,
            sourceMessageId,
            messageText: effectiveText,
            messageType: effectiveMessageType,
            receivedAt: nowMs,
            queueReason: 'retry',
            nextAttemptAt: nowMs + 15000
        });
        return {
            handled: true,
            action: 'queued_after_send_error',
            error: err.message,
            queueItem: queued
        };
    }
}

/**
 * Process a single user's pending message queue (used by Busy Mode flush and Morning Mode dispatch)
 */
async function processUserPendingQueue(sock, whatsappId, {
    isMorningDispatch = false,
    dateStr = null,
    interMessageDelayMs = 600,
    overridePktOptions = {}
} = {}) {
    const normId = database.normalizeWhatsAppId(whatsappId);
    if (!normId) return { processedCount: 0, skipped: true, reason: 'invalid_id' };

    const settings = database.getHayaSettings();
    const user = database.getOrCreateHayaUser(normId);

    // Check if user opted out, blocked, or disabled before processing
    if (!user || user.opted_out || user.blocked || !user.ai_enabled) {
        database.db.prepare(`
            UPDATE haya_pending_messages
            SET status = 'cancelled', last_error = 'User opted out or disabled', processed_at = ?
            WHERE whatsapp_id = ? AND status = 'pending'
        `).run(Date.now(), normId);
        return { processedCount: 0, skipped: true, reason: 'user_opted_out_or_disabled' };
    }

    const pendingItems = database.getPendingMessagesForUser(normId);
    if (!pendingItems || pendingItems.length === 0) {
        return { processedCount: 0, skipped: true, reason: 'no_pending_messages' };
    }

    const results = [];
    let morningSalamSent = false;

    // In Morning Dispatch mode, send "السلام علیکم! صبح بخیر۔ 😊" first (only to users who actually have pending messages!)
    if (isMorningDispatch) {
        const pktDate = dateStr || getPakistanTimeState(overridePktOptions).dateStr;
        const salamKey = `morning_salam_${pktDate}_${normId}`;
        const { job, created } = database.createOrGetHayaJob({
            jobType: 'morning_salam',
            whatsappId: normId,
            idempotencyKey: salamKey
        });

        if (created || job.status !== 'sent') {
            const salamText = settings.morningMessage || hayaPersona.DEFAULT_MORNING_MESSAGE;
            await sendWhatsAppPayload(sock, normId, { text: salamText });
            database.updateHayaJobStatus(job.id, 'sent');
            database.addHayaConversationTurn({
                whatsappId: normId,
                role: 'model',
                messageText: salamText,
                messageType: 'morning_greeting',
                emotionDetected: 'happy'
            });
            morningSalamSent = true;
            if (interMessageDelayMs > 0) {
                await new Promise(r => setTimeout(r, interMessageDelayMs));
            }
        }
    }

    // Deduplicate by source_message_id while preserving chronological order (received_at ASC)
    const seenIds = new Set();

    for (const item of pendingItems) {
        if (seenIds.has(item.source_message_id)) {
            database.markPendingMessageStatus(item.id, 'cancelled', 'Duplicate source_message_id');
            continue;
        }
        seenIds.add(item.source_message_id);

        // Re-check user opt-out before each reply
        const freshUser = database.getOrCreateHayaUser(normId);
        if (freshUser.opted_out || freshUser.blocked || !freshUser.ai_enabled) {
            database.markPendingMessageStatus(item.id, 'cancelled', 'User opted out mid-queue');
            continue;
        }

        database.markPendingMessageStatus(item.id, 'processing');

        try {
            if (hayaPersona.isImageRequest(item.message_text)) {
                const imgRes = await handleHayaPortraitRequest(sock, normId, null, item.source_message_id);
                database.markPendingMessageStatus(item.id, 'sent');
                results.push({ id: item.id, type: 'image', replyText: imgRes.caption || imgRes.replyText });
            } else {
                const aiRes = await generateHayaReply({
                    whatsappId: normId,
                    userMessage: item.message_text,
                    messageType: item.message_type || 'text',
                    isMorningBatch: isMorningDispatch,
                    overridePktOptions
                });

                database.addHayaConversationTurn({
                    whatsappId: normId,
                    role: 'user',
                    messageText: item.message_text,
                    messageType: item.message_type || 'text',
                    emotionDetected: aiRes.detectedEmotion,
                    sourceMessageId: item.source_message_id
                });

                await sendWhatsAppPayload(sock, normId, { text: aiRes.replyText });

                database.addHayaConversationTurn({
                    whatsappId: normId,
                    role: 'model',
                    messageText: aiRes.replyText,
                    messageType: 'text',
                    emotionDetected: aiRes.detectedEmotion
                });

                database.markPendingMessageStatus(item.id, 'sent');
                results.push({ id: item.id, type: 'text', replyText: aiRes.replyText, emotion: aiRes.detectedEmotion });
            }

            if (interMessageDelayMs > 0) {
                await new Promise(r => setTimeout(r, interMessageDelayMs));
            }
        } catch (err) {
            console.error(`[hayaService] Queue dispatch failed for item #${item.id}:`, err.message);
            const retryInfo = database.markPendingMessageStatus(item.id, 'failed', err.message);
            results.push({ id: item.id, status: retryInfo.status, error: err.message });
        }
    }

    // Clear user's busy ack state once their queue is flushed
    database.updateHayaUser(normId, { busyUntilTs: 0, busyAckSent: false }, 'system');

    return {
        whatsappId: normId,
        morningSalamSent,
        processedCount: results.filter(r => !r.error).length,
        results
    };
}

/**
 * Execute 8:56 - 8:58 PM Pakistan Time Good Night Broadcast
 * Only sends to users active with Haya today or with pending messages, never duplicates on the same date
 */
async function runGoodNightBroadcast(sock = null, options = {}) {
    const settings = database.getHayaSettings();
    const pktState = getPakistanTimeState(options.overridePktOptions || {});
    const dateStr = options.dateStr || pktState.dateStr;

    const idempotencyKey = `good_night_broadcast_${dateStr}`;
    const { job, created } = database.createOrGetHayaJob({
        jobType: 'good_night_broadcast',
        idempotencyKey,
        payload: { dateStr, timeStr: pktState.timeStr }
    });

    if (!created && job.status === 'sent' && !options.force) {
        return { executed: false, reason: 'already_sent_today', dateStr, jobId: job.id };
    }

    const recipients = database.getGoodNightRecipients(pktState.startOfDayMs);
    const goodNightText = settings.goodNightMessage || hayaPersona.DEFAULT_GOOD_NIGHT_MESSAGE;
    const sentTo = [];
    const failedTo = [];

    for (const r of recipients) {
        try {
            await sendWhatsAppPayload(sock, r.whatsapp_id, { text: goodNightText });
            database.addHayaConversationTurn({
                whatsappId: r.whatsapp_id,
                role: 'model',
                messageText: goodNightText,
                messageType: 'good_night',
                emotionDetected: 'happy'
            });
            sentTo.push(r.whatsapp_id);
        } catch (err) {
            failedTo.push({ whatsappId: r.whatsapp_id, error: err.message });
        }
    }

    database.updateHayaJobStatus(job.id, 'sent');
    database.updateHayaSettings({ lastGoodNightDate: dateStr }, 'scheduler');
    database.logHayaAudit('good_night_broadcast', 'scheduler', null, `Sent Good Night to ${sentTo.length} active/pending user(s) on ${dateStr}`);

    return {
        executed: true,
        dateStr,
        timeStr: pktState.timeStr,
        message: goodNightText,
        sentCount: sentTo.length,
        sentTo,
        failedCount: failedTo.length
    };
}

/**
 * Execute 5:10 - 5:12 AM Pakistan Time Morning Pending-Message Dispatcher
 * Processes ONLY users who have actual pending messages in fair chronological order
 */
async function runMorningPendingDispatch(sock = null, options = {}) {
    const pktState = getPakistanTimeState(options.overridePktOptions || {});
    const dateStr = options.dateStr || pktState.dateStr;
    const interMessageDelayMs = options.interMessageDelayMs !== undefined ? Number(options.interMessageDelayMs) : 600;

    const eligibleUsers = database.getEligiblePendingUsers();
    if (!eligibleUsers || eligibleUsers.length === 0) {
        database.updateHayaSettings({ lastMorningDispatchDate: dateStr }, 'scheduler');
        return {
            executed: true,
            dateStr,
            usersProcessed: 0,
            totalMessagesSent: 0,
            details: []
        };
    }

    const details = [];
    let totalMessagesSent = 0;

    for (const u of eligibleUsers) {
        const res = await processUserPendingQueue(sock, u.whatsapp_id, {
            isMorningDispatch: true,
            dateStr,
            interMessageDelayMs,
            overridePktOptions: options.overridePktOptions || {}
        });
        totalMessagesSent += res.processedCount || 0;
        details.push(res);
    }

    database.updateHayaSettings({ lastMorningDispatchDate: dateStr }, 'scheduler');
    database.logHayaAudit('morning_pending_dispatch', 'scheduler', null, `Processed ${details.length} user queue(s), ${totalMessagesSent} message(s) on ${dateStr}`);

    return {
        executed: true,
        dateStr,
        usersProcessed: details.length,
        totalMessagesSent,
        details
    };
}

/**
 * Background Scheduler Tick (runs every 15 seconds on the server)
 * Handles:
 * 1. Expiring global Busy Mode window & flushing ready Busy Mode queues
 * 2. 8:56 - 8:58 PM PKT Good Night broadcast
 * 3. 5:10 - 5:12 AM PKT Morning pending-message dispatch
 */
let _schedulerRunning = false;

async function runHayaSchedulerTick(sock = null, options = {}) {
    if (_schedulerRunning && !options.force) return { skipped: true };
    _schedulerRunning = true;

    try {
        const settings = database.getHayaSettings();
        if (!settings || !settings.enabled) {
            return { skipped: true, reason: 'haya_disabled' };
        }

        const nowMs = options.overridePktOptions?.overrideTimestampMs || Date.now();
        const pktState = getPakistanTimeState(options.overridePktOptions || {});

        // 1. Auto-expire global Busy Mode if busyUntilTs has passed
        if (settings.busyModeEnabled && settings.busyUntilTs > 0 && nowMs >= settings.busyUntilTs) {
            database.updateHayaSettings({ busyModeEnabled: false, busyUntilTs: 0 }, 'scheduler');
        }

        // 2. Check Good Night Window (8:56 - 8:58 PM Asia/Karachi)
        if (pktState.isGoodNightWindow && settings.lastGoodNightDate !== pktState.dateStr) {
            await runGoodNightBroadcast(sock, {
                dateStr: pktState.dateStr,
                overridePktOptions: options.overridePktOptions
            });
        }

        // 3. If NOT in Sleep Mode, check Morning Dispatch or Busy Mode queue flushes
        if (!pktState.isSleepMode) {
            if (pktState.isMorningDispatchWindow) {
                const eligible = database.getEligiblePendingUsers();
                if (eligible.length > 0) {
                    await runMorningPendingDispatch(sock, {
                        dateStr: pktState.dateStr,
                        interMessageDelayMs: options.interMessageDelayMs ?? 600,
                        overridePktOptions: options.overridePktOptions
                    });
                }
            } else {
                // Daytime: process any user queues whose busy timer / retry timer has elapsed
                const readyUsers = database.getEligiblePendingUsers();
                for (const u of readyUsers) {
                    const userRow = database.getOrCreateHayaUser(u.whatsapp_id);
                    const busyState = getUserBusyState(userRow, database.getHayaSettings(), nowMs);
                    if (!busyState.isBusy) {
                        await processUserPendingQueue(sock, u.whatsapp_id, {
                            isMorningDispatch: false,
                            dateStr: pktState.dateStr,
                            interMessageDelayMs: options.interMessageDelayMs ?? 400,
                            overridePktOptions: options.overridePktOptions
                        });
                    }
                }
            }
        }

        return { ok: true, pktState };
    } catch (err) {
        console.error('[hayaService] Scheduler tick error:', err.message);
        return { ok: false, error: err.message };
    } finally {
        _schedulerRunning = false;
    }
}

// Start background scheduler interval (every 15 seconds)
const schedulerInterval = setInterval(() => {
    runHayaSchedulerTick().catch(() => {});
}, 15000);
if (schedulerInterval.unref) schedulerInterval.unref();

module.exports = {
    getGeminiClient,
    getPakistanTimeState,
    transcribeAudioBuffer,
    synthesizeHayaVoiceReply,
    generateHayaReply,
    handleHayaPortraitRequest,
    triggerBusyMode,
    getUserBusyState,
    shouldBypassHaya,
    inspectIncomingWhatsAppMessage,
    handleIncomingHayaMessage,
    processUserPendingQueue,
    runGoodNightBroadcast,
    runMorningPendingDispatch,
    runHayaSchedulerTick
};
