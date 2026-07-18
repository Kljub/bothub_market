'use strict';

// Global Chat Plugin — Cross-Server Chat. Jede Guild verlinkt EINEN Channel via
// /globalchat-link; Nachrichten in diesem Channel werden an alle anderen
// verlinkten Channels DESSELBEN Bots weitergeleitet (Relay per Embed, damit
// Autor+Quell-Server klar erkennbar bleiben — kein Identitäts-Spoofing über
// Webhooks).

const path = require('path');
const links = require('./lib/links');

let _dbQuery = null;
function getDbQuery() {
    if (_dbQuery) return _dbQuery;
    const candidates = [
        path.resolve(__dirname, '../../core/src/plugin-runtime/db'),
        path.resolve(__dirname, '../../src/plugin-runtime/db'),
    ];
    for (const c of candidates) {
        try { _dbQuery = require(c).query; break; } catch (_) {}
    }
    return _dbQuery;
}

async function checkCmd(ctx, moduleKey) {
    const dbQuery = getDbQuery();
    if (!dbQuery) return true;
    const clientId = ctx.interaction?.client?.user?.id;
    if (!clientId) return true;

    let botId;
    try {
        const rows = await dbQuery('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
        botId = rows[0]?.id;
    } catch (_) {}
    if (!botId) return true;

    let row;
    try {
        const rows = await dbQuery('SELECT enabled, settings FROM bot_module_states WHERE bot_id = ? AND module_key = ? LIMIT 1', [botId, moduleKey]);
        row = rows[0];
    } catch (_) {}
    if (!row) return true;
    if (!row.enabled) {
        await ctx.reply({ text: '❌ Dieser Command ist deaktiviert.', ephemeral: true });
        return false;
    }

    let cfg = {};
    try { cfg = typeof row.settings === 'string' ? JSON.parse(row.settings) : (row.settings ?? {}); } catch (_) {}
    const requiredPermissions = cfg.required_permissions ?? [];
    const member = ctx.interaction?.member;
    for (const perm of requiredPermissions) {
        if (!member?.permissions?.has(perm)) {
            await ctx.reply({ text: `❌ Du benötigst die Berechtigung \`${perm}\`.`, ephemeral: true });
            return false;
        }
    }
    return true;
}

// Discord-Usernamen: a-z 0-9 _ . , 2-32 Zeichen. Case-insensitive gematcht gegen
// die bekannten Global-Chat-Teilnehmer (lib/links.js upsertUser/findUsersByUsernames).
const MENTION_RE = /@([a-z0-9_.]{2,32})/gi;

module.exports = async function (bh) {
    bh.logger.info('Global Chat Plugin geladen');

    // ── Relay: Nachricht im verlinkten Channel -> an alle anderen verlinkten Channels ──
    // msg.botId ist bereits die interne bots.id (siehe event-bus.js attachDiscordClient),
    // keine client_id-Auflösung nötig.
    bh.events.on('message.created', async (msg) => {
        if (msg.author?.bot) return;
        if (!msg.guild || !msg.channel) return;

        const link = await links.getLinkForChannel(msg.botId, msg.channel.id);
        if (!link || link.guild_id !== msg.guild.id) return; // nicht der verlinkte Channel dieser Guild

        const targets = await links.getOtherLinks(msg.botId, msg.guild.id);
        if (!targets.length) return;

        const content = String(msg.content ?? '').slice(0, 1900);
        if (!content) return; // reine Attachment-/Embed-Nachrichten werden im MVP nicht relayt

        const senderUsername = msg.author?.username ?? 'Unbekannt';
        if (msg.author?.id) {
            await links.upsertUser(msg.botId, msg.author.id, senderUsername).catch(() => {});
        }

        // @username im Text erkennen und an die passenden User per DM weiterreichen —
        // echte Discord-Mentions (<@id>) pingen nur innerhalb derselben Guild, über
        // Server-Grenzen hinweg (der ganze Sinn von Global Chat) bleiben sie stumm.
        // Text-basierte @username-Erkennung + DM ist der einzige Weg, das trotzdem
        // zuverlässig als "Ping" erlebbar zu machen.
        const rawMatches = [...content.matchAll(MENTION_RE)].map(m => m[1].toLowerCase());
        const uniqueMatches = [...new Set(rawMatches)].filter(u => u !== senderUsername.toLowerCase());
        let mentionedIds = new Set();
        if (uniqueMatches.length) {
            const found = await links.findUsersByUsernames(msg.botId, uniqueMatches).catch(() => []);
            for (const u of found) {
                if (u.user_id === msg.author?.id) continue;
                mentionedIds.add(u.user_id);
                bh.messaging.dm(u.user_id, {
                    text: `🌐 **${senderUsername}** hat dich im Global Chat erwähnt (${msg.guild.name}):\n${content}`,
                }).catch(() => {}); // DM kann fehlschlagen (DMs geschlossen) — kein Blocker für den Relay
            }
        }

        // Prüfen, ob diese Nachricht eine Discord-Reply auf eine frühere Relay-Nachricht
        // ist — falls ja, wird die Antwort in JEDEM Ziel-Channel als echte Discord-Reply
        // auf DESSEN eigene Kopie der Ursprungsnachricht gepostet (nicht nur als neue,
        // unverbundene Nachricht), damit der Thread-Zusammenhang serverübergreifend sichtbar bleibt.
        let groupKey = `${msg.channel.id}:${msg.id}`;
        let relayMap = null;
        try {
            const fullMsg = await bh.messaging.get(msg.channel.id, msg.id);
            const referencedId = fullMsg?.reference?.messageId;
            if (referencedId) {
                const foundGroup = await links.findGroupKeyForMessage(msg.botId, msg.channel.id, referencedId);
                if (foundGroup) {
                    groupKey = foundGroup;
                    relayMap = await links.getRelayMapForGroup(msg.botId, foundGroup);
                }
            }
        } catch (_) {} // Reply-Erkennung ist best effort — Relay funktioniert notfalls auch ohne

        await links.recordRelayMapping(msg.botId, groupKey, msg.channel.id, msg.id).catch(() => {});

        const payload = {
            embeds: [{
                color: 0x5865f2,
                author: { name: `${senderUsername} · ${msg.guild.name}` },
                description: content,
                footer: mentionedIds.size ? { text: `📨 ${mentionedIds.size} Erwähnung(en) per DM benachrichtigt` } : undefined,
            }],
        };

        for (const target of targets) {
            try {
                const replyTo = relayMap?.get(target.channel_id);
                const sent = await bh.messaging.send(target.channel_id, replyTo ? { ...payload, replyTo } : payload);
                if (sent?.id) {
                    await links.recordRelayMapping(msg.botId, groupKey, target.channel_id, sent.id).catch(() => {});
                }
            } catch (err) {
                bh.logger.warn(`Global Chat: Relay an Channel ${target.channel_id} fehlgeschlagen: ${err.message}`);
            }
        }
    });

    bh.commands.register({
        name: 'globalchat-link', description: 'Verlinkt diesen Channel mit dem Cross-Server-Chat-Netzwerk.',
        options: [
            { name: 'channel', description: 'Channel für Global Chat (Standard: aktueller Channel)', type: 'channel', required: false },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'globalchat-plugin:globalchat-link')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }
            if (!ctx.interaction.memberPermissions?.has('ManageGuild')) {
                await ctx.reply({ text: '❌ Du brauchst die Berechtigung **Server verwalten**.', ephemeral: true });
                return;
            }

            const clientId = ctx.interaction.client.user.id;
            const botId = await links.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const channel = ctx.options.getChannel('channel') ?? ctx.channel;
            await links.setLink(botId, ctx.guild.id, channel.id);
            await ctx.reply({ text: `✅ <#${channel.id}> ist jetzt mit dem Global Chat verlinkt.` });
        },
    });

    bh.commands.register({
        name: 'globalchat-unlink', description: 'Entfernt die Global-Chat-Verlinkung dieses Servers.',
        options: [],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'globalchat-plugin:globalchat-unlink')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }
            if (!ctx.interaction.memberPermissions?.has('ManageGuild')) {
                await ctx.reply({ text: '❌ Du brauchst die Berechtigung **Server verwalten**.', ephemeral: true });
                return;
            }

            const clientId = ctx.interaction.client.user.id;
            const botId = await links.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const existing = await links.getLinkForGuild(botId, ctx.guild.id);
            if (!existing) { await ctx.reply({ text: 'ℹ️ Dieser Server ist nicht verlinkt.', ephemeral: true }); return; }

            await links.removeLink(botId, ctx.guild.id);
            await ctx.reply({ text: '✅ Global-Chat-Verlinkung entfernt.' });
        },
    });

    bh.plugin.onEnable(async () => { bh.logger.info('Global Chat Plugin aktiviert'); });
    bh.plugin.onDisable(async () => { bh.logger.info('Global Chat Plugin deaktiviert'); });
};
