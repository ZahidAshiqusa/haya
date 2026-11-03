'use strict';

/**
 * Haya AI Persona WhatsApp Admin Command (.haya)
 * Allows the bot owner/admin to view Haya status, toggle on/off, trigger busy mode,
 * or test Haya's fixed portrait directly from WhatsApp.
 */

const { bot } = require('../lib/pluginLoader');
const database = require('../lib/database');
const hayaService = require('../lib/hayaService');

bot({
    command: ['haya', 'hayaai'],
    description: 'Manage Haya AI Chat Persona (on, off, status, busy, photo, flush)',
    category: 'owner'
}, async (sock, chatId, message, args) => {
    const sub = (args[0] || 'status').toLowerCase();
    const settings = database.getHayaSettings();
    const pktState = hayaService.getPakistanTimeState();
    const stats = database.getHayaQueueStats();

    if (sub === 'on' || sub === 'enable') {
        database.updateHayaSettings({ enabled: true }, 'whatsapp_cmd');
        await sock.sendMessage(chatId, {
            text: `✅ *Haya AI Persona Enabled!*\n\n• *Mode:* ${pktState.currentState.toUpperCase()}\n• *PKT Time:* ${pktState.dateStr} ${pktState.timeWithSec}\n• *Scope:* ${settings.scope.toUpperCase()}\n\n👑 _Urooj Choudhary_`
        }, { quoted: message });
        return;
    }

    if (sub === 'off' || sub === 'disable') {
        database.updateHayaSettings({ enabled: false }, 'whatsapp_cmd');
        await sock.sendMessage(chatId, {
            text: `🛑 *Haya AI Persona Disabled.*\n\nUse \`.haya on\` anytime to re-enable.\n👑 _Urooj Choudhary_`
        }, { quoted: message });
        return;
    }

    if (sub === 'busy') {
        const mins = parseInt(args[1], 10) || undefined;
        const busyRes = hayaService.triggerBusyMode({ durationMinutes: mins, actor: 'whatsapp_cmd' });
        await sock.sendMessage(chatId, {
            text: `⏳ *Haya Busy Mode Activated (${busyRes.durationMinutes} mins)*\n\n• *Sample Ack:* ${busyRes.busyMessage}\n• *Queues Incoming Messages Until:* ${new Date(busyRes.busyUntilTs).toLocaleTimeString()}\n\n👑 _Urooj Choudhary_`
        }, { quoted: message });
        return;
    }

    if (sub === 'available' || sub === 'unbusy') {
        database.updateHayaSettings({ busyModeEnabled: false, busyUntilTs: 0 }, 'whatsapp_cmd');
        await sock.sendMessage(chatId, {
            text: `🟢 *Haya is now Available!* Flushing any pending queues...`
        }, { quoted: message });
        await hayaService.runHayaSchedulerTick(sock, { force: true });
        return;
    }

    if (sub === 'photo' || sub === 'portrait') {
        await hayaService.handleHayaPortraitRequest(sock, chatId, message);
        return;
    }

    if (sub === 'flush' || sub === 'morning') {
        const res = await hayaService.runMorningPendingDispatch(sock, { force: true });
        await sock.sendMessage(chatId, {
            text: `🌅 *Haya Pending Queue Dispatched*\n\n• *Users Processed:* ${res.usersProcessed}\n• *Messages Sent:* ${res.totalMessagesSent}\n\n👑 _Urooj Choudhary_`
        }, { quoted: message });
        return;
    }

    const report =
        `🌸 *HAYA AI PERSONA STATUS (حیا اے آئی)*\n\n` +
        `• *Status:* ${settings.enabled ? '🟢 ENABLED' : '🔴 DISABLED'}\n` +
        `• *Current State:* ${pktState.currentState.toUpperCase()}\n` +
        `• *Pakistan Time (Asia/Karachi):* ${pktState.dateStr} ${pktState.timeWithSec}\n` +
        `• *Scope:* ${settings.scope === 'dm' ? 'Direct Messages Only' : settings.scope}\n` +
        `• *Busy Mode:* ${settings.busyModeEnabled ? `⏳ Active (${settings.busyMinMinutes}-${settings.busyMaxMinutes}m)` : 'Off'}\n` +
        `• *Night Schedule:* Good Night ${settings.goodNightWindowStart}-${settings.goodNightWindowEnd} | Sleep ${settings.sleepStartTime}-${settings.sleepEndTime} | Morning ${settings.morningDispatchStart}-${settings.morningDispatchEnd}\n` +
        `• *Queue Stats:* ${stats.pending} Pending | ${stats.sent} Sent | ${stats.failed} Failed\n` +
        `• *Active Users:* ${stats.activeUsers} (${stats.optedOutUsers} Opted Out)\n\n` +
        `*Commands:*\n` +
        `• \`.haya on\` / \`.haya off\`\n` +
        `• \`.haya busy 12\` — Trigger 12-min Busy Mode\n` +
        `• \`.haya available\` — End Busy Mode & flush queue\n` +
        `• \`.haya photo\` — Send Haya's fixed portrait\n` +
        `• \`.haya flush\` — Dispatch pending queues\n\n` +
        `👑 _Urooj Choudhary_`;

    await sock.sendMessage(chatId, { text: report }, { quoted: message });
});
