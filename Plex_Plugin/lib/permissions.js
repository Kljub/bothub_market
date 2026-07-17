'use strict';

const { getDbQuery } = require('./raw-db');

// Command-Toggle + allowed/banned roles/channels + required Discord permissions.
// Same pattern as plugins/aichat-plugin/index.js's checkCmd().
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

    // Top-level Plugin-Karte in /dashboard/modules (module_key = bloßer Plugin-Key, z.B.
    // 'plex', getrennt von den Einzel-Command-Keys wie 'plex:link'). Ohne diesen Check
    // bliebe ein Command ausführbar, selbst wenn der Admin das gesamte Plugin für diesen
    // Bot dort ausgeschaltet hat — passiert unabhängig vom Discord-Command-Sync.
    const pluginKey = moduleKey.split(':')[0];
    if (pluginKey !== moduleKey) {
        try {
            const rows = await dbQuery(
                'SELECT enabled FROM bot_module_states WHERE bot_id = ? AND module_key = ? LIMIT 1',
                [botId, pluginKey]
            );
            if (rows[0] && !rows[0].enabled) {
                await ctx.reply({ text: '❌ Dieses Plugin ist für diesen Bot deaktiviert.', ephemeral: true });
                return false;
            }
        } catch (_) {}
    }

    let row;
    try {
        const rows = await dbQuery(
            'SELECT enabled, settings FROM bot_module_states WHERE bot_id = ? AND module_key = ? LIMIT 1',
            [botId, moduleKey]
        );
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

module.exports = { checkCmd };
