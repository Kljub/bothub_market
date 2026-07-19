'use strict';

const path = require('path');
const sounds = require('./lib/sounds');

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

// Nach der letzten Wiedergabe eine kurze Weile im Channel bleiben (falls direkt noch
// ein Sound hinterher kommt), dann automatisch verlassen statt dauerhaft zu hängen.
const LEAVE_DELAY_MS = 15_000;
const _leaveTimers = new Map(); // guildId -> Timeout

function scheduleLeave(bh, guildId) {
    clearTimeout(_leaveTimers.get(guildId));
    _leaveTimers.set(guildId, setTimeout(() => {
        try { bh.voice.leave(guildId); } catch (_) {}
        _leaveTimers.delete(guildId);
    }, LEAVE_DELAY_MS));
}

module.exports = async function (bh) {
    bh.logger.info('Soundboard Plugin geladen');

    // Uploads liegen pro Bot in storage/ (nicht im Plugin-Ordner selbst — der landet sonst
    // im öffentlichen Plugin-Template beim GitHub-Push), gleiches Muster wie Custom Nodes
    // (storage/custom-nodes/{botId}/...).
    const soundsDirFor = (botId) => path.join('/app/storage/soundboard', String(botId));

    bh.commands.register({
        name: 'soundboard-play', description: 'Spielt einen Sound in deinem aktuellen Voice-Channel ab.',
        options: [
            { name: 'sound', description: 'Name des Sounds', type: 'string', required: true, autocomplete: true },
        ],
        async autocomplete(ctx) {
            const clientId = ctx.interaction.client.user.id;
            const botId = await sounds.resolveBotId(clientId);
            if (!botId) return [];
            const list = await sounds.listSounds(botId);
            const focused = String(ctx.focused?.value ?? '').toLowerCase();
            return list
                .filter(s => s.name.toLowerCase().includes(focused))
                .slice(0, 25)
                .map(s => ({ name: s.name, value: s.name }));
        },
        async execute(ctx) {
            if (!await checkCmd(ctx, 'soundboard-plugin:soundboard-play')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }

            const member = ctx.interaction.member;
            const voiceChannelId = member?.voice?.channelId;
            if (!voiceChannelId) {
                await ctx.reply({ text: '❌ Du musst dafür in einem Voice-Channel sein.', ephemeral: true });
                return;
            }

            const clientId = ctx.interaction.client.user.id;
            const botId = await sounds.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const name = ctx.options.getString('sound', true);
            const sound = await sounds.getSoundByName(botId, name);
            if (!sound) { await ctx.reply({ text: `❌ Sound \`${name}\` nicht gefunden.`, ephemeral: true }); return; }

            await ctx.defer();
            const filePath = path.join(soundsDirFor(botId), sound.filename);
            try {
                await bh.voice.join(ctx.guild.id, voiceChannelId);
                await bh.voice.play(ctx.guild.id, filePath);
                await sounds.incrementPlayCount(sound.id);
                scheduleLeave(bh, ctx.guild.id);
                await ctx.interaction.editReply(`🔊 Spiele **${sound.name}** ab.`);
            } catch (e) {
                bh.logger.error(`Soundboard: Wiedergabe fehlgeschlagen: ${e.message}`);
                await ctx.interaction.editReply(`❌ Wiedergabe fehlgeschlagen: ${e.message}`);
            }
        },
    });

    bh.commands.register({
        name: 'soundboard-list', description: 'Zeigt alle verfügbaren Sounds.',
        options: [],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'soundboard-plugin:soundboard-list')) return;
            const clientId = ctx.interaction.client.user.id;
            const botId = await sounds.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const list = await sounds.listSounds(botId);
            if (!list.length) {
                await ctx.reply({ text: 'ℹ️ Noch keine Sounds hochgeladen (Dashboard → Soundboard).', ephemeral: true });
                return;
            }
            await ctx.reply({
                embeds: [{
                    color: 0xa855f7,
                    title: '🔊 Verfügbare Sounds',
                    description: list.map(s => `**${s.name}** — ${s.play_count}× abgespielt`).join('\n'),
                }],
                ephemeral: true,
            });
        },
    });

    bh.commands.register({
        name: 'soundboard-stop', description: 'Stoppt die Wiedergabe und lässt den Bot den Voice-Channel verlassen.',
        options: [],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'soundboard-plugin:soundboard-stop')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }
            clearTimeout(_leaveTimers.get(ctx.guild.id));
            _leaveTimers.delete(ctx.guild.id);
            try { bh.voice.stop(ctx.guild.id); } catch (_) {}
            try { bh.voice.leave(ctx.guild.id); } catch (_) {}
            await ctx.reply({ text: '⏹️ Gestoppt.', ephemeral: true });
        },
    });

    bh.plugin.onEnable(async () => { bh.logger.info('Soundboard Plugin aktiviert'); });
    bh.plugin.onDisable(async () => {
        for (const t of _leaveTimers.values()) clearTimeout(t);
        _leaveTimers.clear();
        bh.logger.info('Soundboard Plugin deaktiviert');
    });
};
