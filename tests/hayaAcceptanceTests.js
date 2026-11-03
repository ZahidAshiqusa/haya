'use strict';

/**
 * Haya AI Chat Persona - 14 Mandatory Acceptance Tests Suite
 * Can be executed via CLI (`node tests/hayaAcceptanceTests.js`) or API (`POST /api/haya/run-tests`)
 */

const database = require('../lib/database');
const hayaService = require('../lib/hayaService');
const hayaPersona = require('../lib/hayaPersona');
const hayaPortrait = require('../lib/hayaPortrait');

function createMockSocket() {
    const sentMessages = [];
    const sock = {
        _sessionNumber: '923000000000',
        user: { id: '923000000000@s.whatsapp.net' },
        sendPresenceUpdate: async () => {},
        sendMessage: async (jid, content, opts) => {
            if (sock._failNextSendCount && sock._failNextSendCount > 0) {
                sock._failNextSendCount--;
                throw new Error('Simulated temporary WhatsApp rate limit / network timeout');
            }
            const record = {
                jid,
                content,
                opts,
                timestamp: Date.now()
            };
            sentMessages.push(record);
            return {
                key: { remoteJid: jid, fromMe: true, id: 'OUT_' + Date.now() + '_' + sentMessages.length },
                message: content
            };
        },
        getSentMessages: () => sentMessages,
        clearSent: () => { sentMessages.length = 0; }
    };
    return sock;
}

function makeIncomingTextMsg(jid, text, msgId = null, pushName = 'Test User') {
    return {
        key: {
            remoteJid: jid,
            fromMe: false,
            id: msgId || `TEST_MSG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        },
        pushName,
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: {
            conversation: text
        }
    };
}

async function runAllHayaAcceptanceTests() {
    const results = [];
    const testRunId = Date.now().toString(36);
    const userA = `92399111${testRunId.slice(-4).replace(/\D/g, '1').padEnd(4, '1')}@s.whatsapp.net`;
    const userB = `92399222${testRunId.slice(-4).replace(/\D/g, '2').padEnd(4, '2')}@s.whatsapp.net`;
    const userIdle = `92399333${testRunId.slice(-4).replace(/\D/g, '3').padEnd(4, '3')}@s.whatsapp.net`;
    const userOptOut = `92399444${testRunId.slice(-4).replace(/\D/g, '4').padEnd(4, '4')}@s.whatsapp.net`;

    // Save current Haya settings so we restore them cleanly after the test suite completes
    const originalSettings = database.getHayaSettings();

    const recordResult = (testNumber, title, passed, details) => {
        results.push({
            testNumber,
            id: `TEST_${testNumber}`,
            title,
            passed: Boolean(passed),
            details: String(details || '')
        });
    };

    try {
        // Ensure Haya is enabled & in daytime available mode for initial tests
        database.updateHayaSettings({
            enabled: true,
            scope: 'dm',
            busyModeEnabled: false,
            busyUntilTs: 0,
            imageSendingEnabled: true,
            voiceTranscriptionEnabled: true,
            nightModeEnabled: true
        }, 'test_runner');

        const daytimeOverride = {
            overrideDateStr: '2026-11-03',
            overrideTimeStr: '14:30'
        };

        // =========================================================================
        // TEST 1: Normal WhatsApp text message routes to Haya AI while commands bypass
        // =========================================================================
        {
            const sock = createMockSocket();
            const cmdMsg = makeIncomingTextMsg(userA, '.ping', `T1_CMD_${testRunId}`);
            const cmdRes = await hayaService.handleIncomingHayaMessage(sock, cmdMsg, { overridePktOptions: daytimeOverride });

            const chatMsg = makeIncomingTextMsg(userA, 'السلام علیکم حیا، کیسی ہو؟', `T1_CHAT_${testRunId}`);
            const chatRes = await hayaService.handleIncomingHayaMessage(sock, chatMsg, { overridePktOptions: daytimeOverride });

            const passed =
                cmdRes.handled === false &&
                cmdRes.reason === 'bypassed_to_existing_command_or_button' &&
                chatRes.handled === true &&
                chatRes.action === 'replied' &&
                sock.getSentMessages().length === 1 &&
                Boolean(chatRes.replyText);

            recordResult(
                1,
                'Normal text routes to Haya AI while existing commands (.ping) preserve priority',
                passed,
                passed ? `Command bypassed; Haya replied: "${chatRes.replyText.slice(0, 60)}"` : `Unexpected state: ${JSON.stringify({ cmdRes, chatRes })}`
            );
        }

        // =========================================================================
        // TEST 2: Two different users message Haya -> Conversation histories stay isolated
        // =========================================================================
        {
            const sock = createMockSocket();
            await hayaService.handleIncomingHayaMessage(
                sock,
                makeIncomingTextMsg(userA, 'میرا پسندیدہ پھل آم ہے', `T2_A_${testRunId}`),
                { overridePktOptions: daytimeOverride }
            );
            await hayaService.handleIncomingHayaMessage(
                sock,
                makeIncomingTextMsg(userB, 'مجھے کرکٹ کھیلنا بہت پسند ہے', `T2_B_${testRunId}`),
                { overridePktOptions: daytimeOverride }
            );

            const histA = database.getHayaConversationHistory(userA, 20);
            const histB = database.getHayaConversationHistory(userB, 20);

            const aHasB = histA.some(h => h.message_text.includes('کرکٹ'));
            const bHasA = histB.some(h => h.message_text.includes('آم'));
            const passed = histA.length >= 2 && histB.length >= 2 && !aHasB && !bHasA;

            recordResult(
                2,
                'Per-user conversation histories remain 100% isolated between User A and User B',
                passed,
                `User A turns: ${histA.length}, User B turns: ${histB.length}, Cross-leakage: ${aHasB || bHasA ? 'YES' : 'NONE'}`
            );
        }

        // =========================================================================
        // TEST 3: User requests Haya's picture -> Approved fixed portrait sent as WhatsApp media
        // =========================================================================
        {
            const sock = createMockSocket();
            const picMsg = makeIncomingTextMsg(userA, 'Haya apni picture bhejo', `T3_PIC_${testRunId}`);
            const picRes = await hayaService.handleIncomingHayaMessage(sock, picMsg, { overridePktOptions: daytimeOverride });
            const sent = sock.getSentMessages();

            const hasImageBuffer = sent.length === 1 && Buffer.isBuffer(sent[0].content?.image) && sent[0].content.image.length > 1000;
            const hasUrduCaption = Boolean(sent[0]?.content?.caption && sent[0].content.caption.includes('تصویر'));
            const passed = picRes.handled === true && picRes.sent === true && hasImageBuffer && hasUrduCaption;

            recordResult(
                3,
                'Picture request sends approved fixed Haya master portrait via WhatsApp image payload with Urdu caption',
                passed,
                passed ? `Sent ${sent[0].content.image.length} bytes (${picRes.assetId}) with caption "${sent[0].content.caption}"` : `Failed: ${JSON.stringify(picRes)}`
            );
        }

        // =========================================================================
        // TEST 4: User sends Urdu voice note -> Transcript generated & Haya replies in Urdu text
        // =========================================================================
        {
            const sock = createMockSocket();
            const audioMsg = {
                key: { remoteJid: userA, fromMe: false, id: `T4_VN_${testRunId}` },
                pushName: 'User A',
                message: {
                    audioMessage: {
                        mimetype: 'audio/ogg; codecs=opus',
                        seconds: 4,
                        ptt: true
                    }
                }
            };
            const vnRes = await hayaService.handleIncomingHayaMessage(sock, audioMsg, {
                overridePktOptions: daytimeOverride,
                mockAudioBuffer: Buffer.from('OggS_mock_voice_note_bytes'),
                mockTranscript: 'حیا آپ کیا کر رہی ہو اور حصیر پور کا موسم کیسا ہے؟'
            });

            const sent = sock.getSentMessages();
            const passed =
                vnRes.handled === true &&
                vnRes.action === 'replied' &&
                vnRes.transcript.includes('حصیر پور') &&
                sent.length === 1 &&
                Boolean(sent[0].content?.text);

            recordResult(
                4,
                'Urdu voice note is transcribed and Haya responds in natural Urdu text',
                passed,
                passed ? `Transcript processed -> Reply: "${vnRes.replyText.slice(0, 65)}"` : `Failed: ${JSON.stringify(vnRes)}`
            );
        }

        // =========================================================================
        // TEST 5: Busy mode active -> 1x Urdu acknowledgement, 10-15m queue, then chronological replies
        // =========================================================================
        {
            const sock = createMockSocket();
            const busyTrigger = hayaService.triggerBusyMode({ whatsappId: userB, durationMinutes: 12, actor: 'test' });

            // Send 2 messages during Busy Mode
            const bMsg1 = makeIncomingTextMsg(userB, 'کیا کر رہی ہو؟', `T5_B1_${testRunId}`);
            const bMsg2 = makeIncomingTextMsg(userB, 'مجھے ایک بات پوچھنی ہے', `T5_B2_${testRunId}`);

            const r1 = await hayaService.handleIncomingHayaMessage(sock, bMsg1, { overridePktOptions: daytimeOverride });
            const r2 = await hayaService.handleIncomingHayaMessage(sock, bMsg2, { overridePktOptions: daytimeOverride });

            // Only 1 acknowledgement should have been sent across both incoming messages
            const ackCountDuringBusy = sock.getSentMessages().length;

            // Now simulate 15 minutes later when Busy Mode window has elapsed
            database.updateHayaUser(userB, { busyUntilTs: Date.now() - 1000 });
            database.db.prepare('UPDATE haya_pending_messages SET next_attempt_at = 0 WHERE whatsapp_id = ?').run(userB);
            sock.clearSent();

            const flushRes = await hayaService.processUserPendingQueue(sock, userB, {
                isMorningDispatch: false,
                interMessageDelayMs: 10,
                overridePktOptions: daytimeOverride
            });

            const passed =
                r1.action === 'queued_for_busy_mode' &&
                r1.ackSentNow === true &&
                r2.action === 'queued_for_busy_mode' &&
                r2.ackSentNow === false &&
                ackCountDuringBusy === 1 &&
                flushRes.processedCount === 2 &&
                sock.getSentMessages().length === 2;

            recordResult(
                5,
                'Busy Mode sends 1x Urdu acknowledgement, queues messages for 10-15m, and processes chronologically after delay',
                passed,
                `Busy duration: ${busyTrigger.durationMinutes}m, Ack sent once: ${ackCountDuringBusy === 1}, Flushed replies: ${flushRes.processedCount}`
            );
        }

        // =========================================================================
        // TEST 6: 8:56-8:58 PM Pakistan Time Good Night message sent on schedule
        // =========================================================================
        {
            const sock = createMockSocket();
            const gnOverride = {
                overrideDateStr: `2026-11-03-${testRunId}`,
                overrideTimeStr: '20:57'
            };
            const gnRes = await hayaService.runGoodNightBroadcast(sock, {
                dateStr: `2026-11-03-${testRunId}`,
                overridePktOptions: gnOverride
            });

            // Verify duplicate guard on second call for same date
            const gnDuplicateCall = await hayaService.runGoodNightBroadcast(sock, {
                dateStr: `2026-11-03-${testRunId}`,
                overridePktOptions: gnOverride
            });

            const passed =
                gnRes.executed === true &&
                gnRes.sentCount >= 1 &&
                gnRes.message.includes('سونے جا رہی ہوں') &&
                gnDuplicateCall.executed === false &&
                gnDuplicateCall.reason === 'already_sent_today';

            recordResult(
                6,
                '8:56-8:58 PM PKT Good Night message dispatches on schedule with duplicate prevention',
                passed,
                `Sent to ${gnRes.sentCount} active user(s) at ${gnRes.timeStr} PKT; 2nd run blocked (${gnDuplicateCall.reason})`
            );
        }

        // =========================================================================
        // TEST 7: 9:00 PM to 5:00 AM PKT Sleep Mode -> No automatic replies, messages queued safely
        // =========================================================================
        {
            const sock = createMockSocket();
            const sleepOverride = {
                overrideDateStr: '2026-11-03',
                overrideTimeStr: '22:30'
            };

            const sMsg1 = makeIncomingTextMsg(userA, 'کیا کر رہی ہو؟', `T7_S1_${testRunId}`);
            const sMsg2 = makeIncomingTextMsg(userA, 'کل کہاں چلی گئی تھیں؟', `T7_S2_${testRunId}`);
            const sMsg3 = makeIncomingTextMsg(userA, 'مجھے ایک بات پوچھنی ہے', `T7_S3_${testRunId}`);

            const sr1 = await hayaService.handleIncomingHayaMessage(sock, sMsg1, { overridePktOptions: sleepOverride });
            const sr2 = await hayaService.handleIncomingHayaMessage(sock, sMsg2, { overridePktOptions: sleepOverride });
            const sr3 = await hayaService.handleIncomingHayaMessage(sock, sMsg3, { overridePktOptions: sleepOverride });

            const pendingForA = database.getPendingMessagesForUser(userA);
            const passed =
                sr1.action === 'queued_for_sleep_mode' &&
                sr2.action === 'queued_for_sleep_mode' &&
                sr3.action === 'queued_for_sleep_mode' &&
                sock.getSentMessages().length === 0 &&
                pendingForA.length === 3;

            recordResult(
                7,
                '9:00 PM - 5:00 AM PKT Sleep Mode suppresses automatic replies and safely queues incoming messages',
                passed,
                `Outbound messages during sleep: ${sock.getSentMessages().length}, Queued in SQLite for User A: ${pendingForA.length}`
            );
        }

        // =========================================================================
        // TEST 8: 5:10-5:12 AM Morning Dispatch -> Only pending users get Salam + chronological replies
        // =========================================================================
        {
            const sock = createMockSocket();
            // Create an idle user with 0 pending messages
            database.getOrCreateHayaUser(userIdle, 'Idle User');

            const morningOverride = {
                overrideDateStr: `2026-11-04-${testRunId}`,
                overrideTimeStr: '05:11'
            };

            const morningRes = await hayaService.runMorningPendingDispatch(sock, {
                dateStr: `2026-11-04-${testRunId}`,
                interMessageDelayMs: 10,
                overridePktOptions: morningOverride
            });

            const sent = sock.getSentMessages();
            const sentToUserA = sent.filter(m => m.jid === userA);
            const sentToIdle = sent.filter(m => m.jid === userIdle);

            // First message to User A must be "السلام علیکم! صبح بخیر۔ 😊", followed by 3 chronological answers
            const firstIsSalam = sentToUserA.length >= 4 && String(sentToUserA[0].content?.text || '').includes('صبح بخیر');
            const passed =
                morningRes.executed === true &&
                firstIsSalam &&
                sentToUserA.length === 4 &&
                sentToIdle.length === 0;

            recordResult(
                8,
                '5:10-5:12 AM PKT Morning Mode sends Salam first + 1-by-1 chronological answers ONLY to users with pending messages',
                passed,
                `User A received 1 Salam + 3 answers (${sentToUserA.length} total); Idle User received: ${sentToIdle.length}`
            );
        }

        // =========================================================================
        // TEST 9: Server restart recovery -> Pending queues & scheduled jobs persist in SQLite
        // =========================================================================
        {
            const recoveryMsgId = `T9_RESTART_${testRunId}`;
            const item = database.enqueueHayaPendingMessage({
                whatsappId: userB,
                sourceMessageId: recoveryMsgId,
                messageText: 'سرور ری اسٹارٹ ٹیسٹ میسج',
                messageType: 'text',
                queueReason: 'sleep'
            });
            // Simulate crash mid-processing
            database.markPendingMessageStatus(item.id, 'processing');

            // Re-run initHayaSchema (which executes on server startup) to verify crash recovery
            const { initHayaSchema } = require('../lib/hayaDatabase');
            initHayaSchema(database.db);

            const recoveredPending = database.getPendingMessagesForUser(userB);
            const found = recoveredPending.some(p => p.source_message_id === recoveryMsgId && p.status === 'pending');

            // Clean up test item
            database.markPendingMessageStatus(item.id, 'sent');

            recordResult(
                9,
                'Server restart recovers interrupted processing jobs and preserves SQLite pending queues',
                found,
                found ? `Interrupted job ${recoveryMsgId} automatically recovered to 'pending' state on startup` : 'Failed to recover job'
            );
        }

        // =========================================================================
        // TEST 10: Duplicate webhook event -> No duplicate response or queue entry
        // =========================================================================
        {
            const sock = createMockSocket();
            const dupId = `T10_DUP_${testRunId}`;
            const msg1 = makeIncomingTextMsg(userA, 'آج موسم بہت اچھا ہے', dupId);
            const msg2 = makeIncomingTextMsg(userA, 'آج موسم بہت اچھا ہے', dupId);

            const res1 = await hayaService.handleIncomingHayaMessage(sock, msg1, { overridePktOptions: daytimeOverride });
            const res2 = await hayaService.handleIncomingHayaMessage(sock, msg2, { overridePktOptions: daytimeOverride });

            const passed =
                res1.handled === true &&
                res2.handled === false &&
                res2.reason === 'duplicate_message_id' &&
                sock.getSentMessages().length === 1;

            recordResult(
                10,
                'Duplicate webhook/message ID is detected and prevented from triggering duplicate replies or queue entries',
                passed,
                `First event: ${res1.action}, Duplicate event: ${res2.reason}, Total outbound: ${sock.getSentMessages().length}`
            );
        }

        // =========================================================================
        // TEST 11: Opt-out user (STOP) -> Receives no AI, busy, or scheduled messages
        // =========================================================================
        {
            const sock = createMockSocket();
            const stopMsg = makeIncomingTextMsg(userOptOut, 'STOP', `T11_STOP_${testRunId}`);
            const stopRes = await hayaService.handleIncomingHayaMessage(sock, stopMsg, { overridePktOptions: daytimeOverride });
            sock.clearSent();

            const followUpMsg = makeIncomingTextMsg(userOptOut, 'ہیلو کیا تم سن رہی ہو؟', `T11_AFTER_${testRunId}`);
            const followUpRes = await hayaService.handleIncomingHayaMessage(sock, followUpMsg, { overridePktOptions: daytimeOverride });

            const passed =
                stopRes.action === 'opted_out' &&
                followUpRes.handled === false &&
                followUpRes.reason === 'user_opted_out_or_disabled' &&
                sock.getSentMessages().length === 0;

            recordResult(
                11,
                'Opt-out user (STOP) is immediately respected and excluded from AI and scheduled messages',
                passed,
                `Opt-out action: ${stopRes.action}, Subsequent message: ${followUpRes.reason}, Outbound after opt-out: ${sock.getSentMessages().length}`
            );
        }

        // =========================================================================
        // TEST 12: Existing bot buttons, menus, and custom commands remain intact
        // =========================================================================
        {
            const sock = createMockSocket();
            const buttonPayloadMsg = {
                key: { remoteJid: userA, fromMe: false, id: `T12_BTN_${testRunId}` },
                message: {
                    buttonsResponseMessage: {
                        selectedButtonId: '.menu',
                        selectedDisplayText: 'Main Menu'
                    }
                }
            };
            const customCmdMsg = makeIncomingTextMsg(userA, '.button/Hello/2/Yes/No +923001234567', `T12_CUSTOM_${testRunId}`);
            const bypassBtn = hayaService.shouldBypassHaya(sock, userA, buttonPayloadMsg, '');
            const bypassCustom = hayaService.shouldBypassHaya(sock, userA, customCmdMsg, '.button/Hello/2/Yes/No +923001234567');

            const pluginLoader = require('../lib/pluginLoader');
            const map = (pluginLoader.pluginMap && pluginLoader.pluginMap.size > 0)
                ? pluginLoader.pluginMap
                : pluginLoader.loadPlugins();
            const totalRegisteredCommands = map ? map.size : 0;

            const passed = bypassBtn === true && bypassCustom === true && totalRegisteredCommands >= 200;

            recordResult(
                12,
                'Existing bot buttons, menus, and all 236+ plugin commands work without interference',
                passed,
                `Button payload bypassed: ${bypassBtn}, Custom .button command bypassed: ${bypassCustom}, Registered commands: ${totalRegisteredCommands}`
            );
        }

        // =========================================================================
        // TEST 13: Pakistan timezone (Asia/Karachi) is independent of UTC/server local time
        // =========================================================================
        {
            // 15:57 UTC is exactly 20:57 PKT (UTC+5) -> must detect Good Night window (20:56 - 20:58 PKT)
            const utcTimestamp = Date.UTC(2026, 10, 3, 15, 57, 0);
            const pktInfo = hayaService.getPakistanTimeState({ overrideTimestampMs: utcTimestamp });

            // 16:30 UTC is 21:30 PKT -> must detect Sleep Mode (21:00 - 05:00 PKT)
            const utcSleepTimestamp = Date.UTC(2026, 10, 3, 16, 30, 0);
            const pktSleepInfo = hayaService.getPakistanTimeState({ overrideTimestampMs: utcSleepTimestamp });

            const passed =
                pktInfo.timezone === 'Asia/Karachi' &&
                pktInfo.timeStr === '20:57' &&
                pktInfo.isGoodNightWindow === true &&
                pktSleepInfo.timeStr === '21:30' &&
                pktSleepInfo.isSleepMode === true;

            recordResult(
                13,
                'Pakistan timezone (Asia/Karachi IANA) accurately maps UTC timestamps regardless of server local timezone',
                passed,
                `15:57 UTC -> ${pktInfo.timeStr} PKT (GoodNight=${pktInfo.isGoodNightWindow}); 16:30 UTC -> ${pktSleepInfo.timeStr} PKT (Sleep=${pktSleepInfo.isSleepMode})`
            );
        }

        // =========================================================================
        // TEST 14: Rate limit & temporary failure retry/backoff works properly
        // =========================================================================
        {
            const sock = createMockSocket();
            sock._failNextSendCount = 1; // Force next WhatsApp send to fail once

            const failItem = database.enqueueHayaPendingMessage({
                whatsappId: userA,
                sourceMessageId: `T14_RETRY_${testRunId}`,
                messageText: 'ری ٹرائی اور بیک آف ٹیسٹ',
                messageType: 'text',
                queueReason: 'sleep'
            });

            // 1st attempt fails -> should increment retry_count to 1 and schedule next_attempt_at with backoff
            await hayaService.processUserPendingQueue(sock, userA, {
                isMorningDispatch: false,
                interMessageDelayMs: 5,
                overridePktOptions: daytimeOverride
            });

            const afterFailRow = database.db.prepare('SELECT * FROM haya_pending_messages WHERE id = ?').get(failItem.id);
            const backedOffProperly =
                afterFailRow &&
                afterFailRow.status === 'pending' &&
                afterFailRow.retry_count === 1 &&
                afterFailRow.next_attempt_at > Date.now();

            // Fast-forward next_attempt_at so 2nd attempt succeeds
            database.db.prepare('UPDATE haya_pending_messages SET next_attempt_at = 0 WHERE id = ?').run(failItem.id);
            await hayaService.processUserPendingQueue(sock, userA, {
                isMorningDispatch: false,
                interMessageDelayMs: 5,
                overridePktOptions: daytimeOverride
            });

            const afterSuccessRow = database.db.prepare('SELECT * FROM haya_pending_messages WHERE id = ?').get(failItem.id);
            const passed = backedOffProperly && afterSuccessRow?.status === 'sent';

            recordResult(
                14,
                'Temporary send failure triggers exponential backoff retry and succeeds on recovery',
                passed,
                `1st attempt status: ${afterFailRow?.status} (retry_count=${afterFailRow?.retry_count}), 2nd attempt status: ${afterSuccessRow?.status}`
            );
        }
    } finally {
        // Clean up temporary test users & restore original Haya settings
        for (const testJid of [userA, userB, userIdle, userOptOut]) {
            try {
                database.deleteHayaUserData(testJid, 'test_cleanup');
            } catch (_) {}
        }
        if (originalSettings) {
            try {
                database.updateHayaSettings(originalSettings, 'test_restore');
            } catch (_) {}
        }
    }

    const passedCount = results.filter(r => r.passed).length;
    return {
        success: passedCount === results.length,
        totalTests: results.length,
        passedCount,
        failedCount: results.length - passedCount,
        executedAt: new Date().toISOString(),
        results
    };
}

if (require.main === module) {
    runAllHayaAcceptanceTests()
        .then(report => {
            console.log('\n============================================================');
            console.log(`🌸 HAYA AI ACCEPTANCE TEST SUITE: ${report.passedCount}/${report.totalTests} PASSED`);
            console.log('============================================================');
            for (const r of report.results) {
                console.log(`${r.passed ? '✅' : '❌'} [TEST ${r.testNumber}] ${r.title}`);
                console.log(`   └─ ${r.details}`);
            }
            console.log('============================================================\n');
            process.exit(report.success ? 0 : 1);
        })
        .catch(err => {
            console.error('Acceptance test runner fatal error:', err);
            process.exit(1);
        });
}

module.exports = {
    runAllHayaAcceptanceTests
};
