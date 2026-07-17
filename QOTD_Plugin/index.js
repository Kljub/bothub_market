'use strict';

// Question of the Day Plugin — Bot Owner legt im Dashboard einen Fact-Pool an,
// /qotd zeigt jedem User einmal pro (Kalender-)Tag einen zufälligen Fact.

const path = require('path');
const facts = require('./lib/facts');
const vars  = require('./lib/vars');

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
    const bannedChannels      = cfg.banned_channels      ?? [];
    const requiredPermissions = cfg.required_permissions ?? [];
    const bannedRoles         = cfg.banned_roles         ?? [];
    const allowedRoles        = cfg.allowed_roles        ?? [];
    const member      = ctx.interaction?.member;
    const channelName = ctx.channel?.name ?? '';
    const memberRoles = member?.roles?.cache?.map(r => r.name) ?? [];

    if (bannedChannels.length && bannedChannels.includes(channelName)) {
        await ctx.reply({ text: '❌ Dieser Command ist in diesem Channel nicht erlaubt.', ephemeral: true });
        return false;
    }
    for (const perm of requiredPermissions) {
        if (!member?.permissions?.has(perm)) {
            await ctx.reply({ text: `❌ Du benötigst die Berechtigung \`${perm}\`.`, ephemeral: true });
            return false;
        }
    }
    if (bannedRoles.length && bannedRoles.some(r => memberRoles.includes(r))) {
        await ctx.reply({ text: '❌ Eine deiner Rollen verbietet die Nutzung dieses Commands.', ephemeral: true });
        return false;
    }
    if (allowedRoles.length && !allowedRoles.some(r => memberRoles.includes(r))) {
        await ctx.reply({ text: '❌ Du hast keine erlaubte Rolle für diesen Command.', ephemeral: true });
        return false;
    }
    return true;
}

module.exports = async function (bh) {
    bh.logger.info('QOTD Plugin geladen');

    bh.commands.register({
        name: 'qotd', description: 'Zeigt einen zufälligen Fact des Tages (1x pro Tag).',
        options: [],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'qotd-plugin:qotd')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }

            const clientId = ctx.interaction.client.user.id;
            const botId = await facts.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            if (await facts.usedToday(botId, ctx.guild.id, ctx.user.id)) {
                await ctx.reply({ text: '⏱️ Du hast heute schon deinen Fact des Tages bekommen. Komm morgen wieder!', ephemeral: true });
                return;
            }

            const pool = await facts.listFacts(botId, { onlyEnabled: true });
            if (!pool.length) {
                await ctx.reply({ text: 'ℹ️ Für diesen Bot sind noch keine Facts eingerichtet.', ephemeral: true });
                return;
            }

            const fact = facts.pickRandom(pool);
            await facts.markUsedToday(botId, ctx.guild.id, ctx.user.id);

            const text = await vars.applyVars(fact.text, botId);
            await ctx.reply({
                embeds: [{
                    color: 0xf0c040,
                    title: '💡 Fact des Tages',
                    description: text,
                }],
            });
        },
    });

    bh.plugin.onEnable(async () => { bh.logger.info('QOTD Plugin aktiviert'); });
    bh.plugin.onDisable(async () => { bh.logger.info('QOTD Plugin deaktiviert'); });
};
