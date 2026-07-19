'use strict';

const path = require('path');
const emojis = require('./lib/emojis');

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

module.exports = async function (bh) {
    bh.logger.info('Emoji Manager Plugin geladen');

    const emojisDir = path.resolve(__dirname, 'emojis');

    bh.commands.register({
        name: 'emoji-menu', description: 'Öffnet ein (nur für dich sichtbares) Menü zur Emoji-Auswahl.',
        options: [],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'emojimanager-plugin:emoji-menu')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }

            const clientId = ctx.interaction.client.user.id;
            const botId = await emojis.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const list = await emojis.listEmojis(botId);
            if (!list.length) {
                await ctx.reply({ text: 'ℹ️ Noch keine Emojis hochgeladen (Dashboard → Emoji Manager).', ephemeral: true });
                return;
            }

            const customId = `emojimgr_select:${ctx.guild.id}:${ctx.user.id}`;
            await ctx.reply({
                text: '😀 Wähle ein Emoji aus:',
                components: [{
                    type: 1,
                    components: [{
                        type: 3, // String Select
                        custom_id: customId,
                        placeholder: 'Emoji auswählen…',
                        options: list.slice(0, 25).map(em => ({ label: em.name, value: em.name })),
                    }],
                }],
                ephemeral: true,
            });
        },
    });

    bh.events.on('select.changed', async (payload) => {
        if (!payload.customId?.startsWith('emojimgr_select:')) return;
        const interaction = payload._interaction;
        const [, guildId, userId] = payload.customId.split(':');

        if (payload.user.id !== userId) {
            await interaction.reply({ content: '❌ Das ist nicht dein Menü — nutze /emoji-menu.', ephemeral: true }).catch(() => {});
            return;
        }

        const clientId = interaction.client.user.id;
        const botId = await emojis.resolveBotId(clientId);
        if (!botId) { await interaction.reply({ content: '❌ Bot nicht gefunden.', ephemeral: true }).catch(() => {}); return; }

        const name = payload.values?.[0];
        const emoji = name ? await emojis.getEmojiByName(botId, name) : null;
        if (!emoji) { await interaction.reply({ content: '❌ Emoji nicht gefunden.', ephemeral: true }).catch(() => {}); return; }

        try {
            await bh.messaging.send(interaction.channelId, {
                files: [{ attachment: path.join(emojisDir, emoji.filename), name: emoji.filename }],
            });
            await emojis.incrementUseCount(emoji.id);
            await interaction.update({ content: `✅ **${emoji.name}** gesendet.`, components: [] }).catch(() => {});
        } catch (e) {
            bh.logger.error(`Emoji Manager: Senden fehlgeschlagen: ${e.message}`);
            await interaction.reply({ content: `❌ Senden fehlgeschlagen: ${e.message}`, ephemeral: true }).catch(() => {});
        }
    });

    bh.plugin.onEnable(async () => { bh.logger.info('Emoji Manager Plugin aktiviert'); });
    bh.plugin.onDisable(async () => { bh.logger.info('Emoji Manager Plugin deaktiviert'); });
};
