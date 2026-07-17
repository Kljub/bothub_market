'use strict';

// Criminal Plugin — /steal: klaut Guthaben von einem anderen User. Erfolgschance,
// Beute-Prozentsatz (vom Opfer-Guthaben) und Straf-Prozentsatz (vom eigenen
// Guthaben bei Fehlschlag) sind pro Bot im Dashboard einstellbar. Guthaben läuft
// ausschließlich über das native Economy-Core-Modul (Service-Bridge, kein
// direkter DB-Zugriff auf Guthaben-Tabellen).

const path = require('path');
const settings = require('./lib/settings');

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

// ── Permission Check (identisch zum Muster in economy-plugin/casino-plugin) ──
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

function fmt(amount, currency) {
    return `${Number(amount).toLocaleString('de-DE')} ${currency.symbol} ${currency.name}`;
}

module.exports = async function (bh) {
    bh.logger.info('Criminal Plugin geladen');

    const economyRead     = await bh.services.get('economy', 'economy.balance.read');
    const economyWrite    = await bh.services.get('economy', 'economy.balance.write');
    const economyCurrency = await bh.services.get('economy', 'economy.currency.info');

    if (!economyRead || !economyWrite || !economyCurrency) {
        bh.logger.error('Criminal Plugin: Economy-Services nicht verfügbar — /steal kann nicht abgewickelt werden.');
    }

    async function resolveCurrency(botId, currencyOption) {
        const currencies = await economyCurrency.listCurrencies(botId);
        if (!currencyOption) return currencies.find(c => c.is_default) ?? currencies[0] ?? null;
        return currencies.find(c => c.currency_key.toLowerCase() === currencyOption.toLowerCase()) ?? null;
    }

    bh.commands.register({
        name: 'steal', description: 'Versuche, Guthaben von einem anderen User zu klauen.',
        options: [
            { name: 'user',     description: 'Ziel des Diebstahls',              type: 'user',   required: true },
            { name: 'currency', description: 'Currency (Standard: Default)',     type: 'string', required: false },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'criminal-plugin:steal')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }
            if (!economyRead || !economyWrite || !economyCurrency) {
                await ctx.reply({ text: '❌ Economy-Modul nicht verfügbar. Bitte Admin kontaktieren.', ephemeral: true });
                return;
            }

            const target = ctx.options.getUser('user', true);
            if (target.id === ctx.user.id) { await ctx.reply({ text: '❌ Du kannst nicht von dir selbst klauen.', ephemeral: true }); return; }
            if (target.bot) { await ctx.reply({ text: '❌ Du kannst nicht von Bots klauen.', ephemeral: true }); return; }

            const clientId = ctx.interaction.client.user.id;
            const botId = await settings.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const cfg = await settings.getSettings(botId);

            const currency = await resolveCurrency(botId, ctx.options.getString('currency'));
            if (!currency) {
                await ctx.reply({ text: '⚙️ Für diesen Bot ist noch keine Currency eingerichtet.', ephemeral: true });
                return;
            }
            if (!settings.currencyAllowed(cfg, currency.currency_key)) {
                await ctx.reply({ text: `❌ /steal erlaubt die Currency **${currency.name}** nicht.`, ephemeral: true });
                return;
            }

            const victimBal = await economyRead.getBalance(botId, ctx.guild.id, target.id, currency.currency_key);
            if (!victimBal || victimBal.balance <= 0) {
                await ctx.reply({ text: `❌ **${target.username}** hat nichts, was man klauen könnte.`, ephemeral: true });
                return;
            }

            const success = Math.random() * 100 < cfg.success_chance;

            if (success) {
                const stealAmount = Math.max(1, Math.floor(victimBal.balance * (cfg.steal_percent / 100)));
                const removeResult = await economyWrite.removeBalance(botId, ctx.guild.id, target.id, stealAmount, currency.currency_key, `steal by ${ctx.user.id}`);
                if (!removeResult.success) {
                    await ctx.reply({ text: `❌ Diebstahl fehlgeschlagen (${removeResult.reason}).`, ephemeral: true });
                    return;
                }
                await economyWrite.addBalance(botId, ctx.guild.id, ctx.user.id, stealAmount, currency.currency_key, `steal from ${target.id}`);
                const myBal = await economyRead.getBalance(botId, ctx.guild.id, ctx.user.id, currency.currency_key);

                await ctx.reply({
                    embeds: [{
                        color: 0x4ade80,
                        title: '🕵️ Diebstahl erfolgreich!',
                        description: `Du hast **${fmt(stealAmount, currency)}** von **${target.username}** gestohlen.\n`
                            + `Dein neuer Kontostand: ${fmt(myBal.balance, currency)}`,
                    }],
                });
            } else {
                const myBal0 = await economyRead.getBalance(botId, ctx.guild.id, ctx.user.id, currency.currency_key);
                const penalty = Math.floor(myBal0.balance * (cfg.fail_penalty_percent / 100));

                let myBal = myBal0;
                if (penalty > 0) {
                    const removeResult = await economyWrite.removeBalance(botId, ctx.guild.id, ctx.user.id, penalty, currency.currency_key, 'steal fail penalty');
                    if (removeResult.success) myBal = { balance: removeResult.balance };
                }

                await ctx.reply({
                    embeds: [{
                        color: 0xef4444,
                        title: '🚨 Erwischt!',
                        description: `Dein Diebstahlversuch bei **${target.username}** ist fehlgeschlagen.\n`
                            + (penalty > 0 ? `Strafe: **${fmt(penalty, currency)}**\n` : '')
                            + `Dein neuer Kontostand: ${fmt(myBal.balance, currency)}`,
                    }],
                });
            }
        },
    });

    bh.plugin.onEnable(async () => {
        bh.logger.info('Criminal Plugin aktiviert');
    });

    bh.plugin.onDisable(async () => {
        bh.logger.info('Criminal Plugin deaktiviert');
    });
};
