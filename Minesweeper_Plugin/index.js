'use strict';

// Minesweeper Plugin — 24-Felder-Minenfeld (4 Reihen à 5 Buttons + 1 Reihe mit
// 4 Feldern + 🔥-Cashout-Button — Discords Hard-Limit ist 5 Action-Rows x 5
// Buttons, ein voller 5x5=25-Grid hätte keinen Platz mehr für den Cashout-
// Button gelassen). Minen-Anzahl wählt der Discord-User selbst, der faire
// Multiplikator steigt automatisch mit der Minen-Anzahl (siehe lib/game.js).
// RTP pro Bot im Dashboard einstellbar (Standard: fairer Wert).

const path = require('path');
const game     = require('./lib/game');
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

function fmt(amount, currency) {
    return `${Number(amount).toLocaleString('de-DE')} ${currency.symbol} ${currency.name}`;
}

module.exports = async function (bh) {
    bh.logger.info('Minesweeper Plugin geladen');

    const economyRead     = await bh.services.get('economy', 'economy.balance.read');
    const economyWrite    = await bh.services.get('economy', 'economy.balance.write');
    const economyCurrency = await bh.services.get('economy', 'economy.currency.info');

    if (!economyRead || !economyWrite || !economyCurrency) {
        bh.logger.error('Minesweeper Plugin: Economy-Services nicht verfügbar — /minesweeper kann nicht abgewickelt werden.');
    }

    async function resolveCurrency(botId, currencyOption) {
        const currencies = await economyCurrency.listCurrencies(botId);
        if (!currencyOption) return currencies.find(c => c.is_default) ?? currencies[0] ?? null;
        return currencies.find(c => c.currency_key.toLowerCase() === currencyOption.toLowerCase()) ?? null;
    }

    // sessionKey = `${guildId}:${userId}` — nur eine aktive Runde pro User+Guild.
    const sessions = new Map();

    function sessionKey(guildId, userId) { return `${guildId}:${userId}`; }

    // 4 Reihen à 5 Zellen (Index 0-19) + 1 Reihe mit 4 Zellen (Index 20-23) + 🔥-Cashout.
    function renderGrid(session, { done = false } = {}) {
        const rows = [];
        let idx = 0;
        for (let r = 0; r < 4; r++) {
            const components = [];
            for (let c = 0; c < 5; c++) {
                components.push(cellButton(session, idx, done));
                idx++;
            }
            rows.push({ type: 1, components });
        }

        const lastRow = [];
        for (let c = 0; c < 4; c++) {
            lastRow.push(cellButton(session, idx, done));
            idx++;
        }
        lastRow.push({
            type: 2, style: 4, label: '🔥',
            custom_id: `ms_cashout:${session.key}`,
            disabled: done || session.safeRevealed === 0,
        });
        rows.push({ type: 1, components: lastRow });

        return rows;
    }

    function cellButton(session, i, done) {
        const isMine     = session.mines.has(i);
        const isRevealed = session.revealed.has(i);
        let style = 2, label = '⬛', disabled = done;

        if (isRevealed) { style = 3; label = '💎'; disabled = true; }
        else if (done && isMine) { style = 4; label = '💣'; disabled = true; }

        return { type: 2, style, label, custom_id: `ms_cell:${session.key}:${i}`, disabled };
    }

    const OUTCOME_TITLE = {
        boom: '💥 Mine getroffen!',
        cashout: '💰 Cashout!',
        cleared: '🏆 Feld geräumt!',
    };

    function gameEmbed(session, { outcome = null, payout = null, balance = null, currency = null } = {}) {
        const mult = game.multiplierAt(session.mineCount, session.safeRevealed, session.rtp);
        const lines = [
            `💣 Minen: **${session.mineCount}**/${game.GRID_SIZE} · 💎 Sicher aufgedeckt: **${session.safeRevealed}**/${game.GRID_SIZE - session.mineCount}`,
            `Einsatz: ${fmt(session.bet, session.currency)}`,
            `Aktueller Multiplikator: **${mult.toFixed(2)}x** (≈ ${fmt(Math.floor(session.bet * mult), session.currency)})`,
        ];
        if (outcome) {
            lines.push('');
            if (outcome === 'boom') lines.push('Einsatz verloren.');
            else if (outcome === 'cashout') lines.push(`Ausgezahlt: **${fmt(payout, currency)}**`);
            else if (outcome === 'cleared') lines.push(`Feld komplett geräumt! Auszahlung: **${fmt(payout, currency)}**`);
            if (balance !== null) lines.push(`Neuer Kontostand: ${fmt(balance, currency)}`);
        } else {
            lines.push('', 'Klicke ein Feld an. 🔥 zahlt deinen aktuellen Multiplikator aus, sobald du mindestens ein Feld aufgedeckt hast.');
        }
        return {
            color: outcome === 'boom' ? 0xef4444 : (outcome ? 0x4ade80 : 0xf0c040),
            title: outcome ? OUTCOME_TITLE[outcome] : '💣 Minesweeper',
            description: lines.join('\n'),
        };
    }

    /** "🔄 Nochmal"-Button — codiert Guild+User+Einsatz+Minen+Currency kompakt im
     * custom_id, gleiches 100-Zeichen-Sicherheitsnetz wie im Casino-Plugin. */
    function againRow(guildId, userId, bet, mineCount, currencyKey) {
        const id = `ms_again:${guildId}:${userId}:${bet}:${mineCount}:${currencyKey}`;
        if (id.length > 100) return [];
        return [{ type: 1, components: [{ type: 2, style: 2, label: '🔄 Nochmal', custom_id: id }] }];
    }

    async function endSession(session, outcome, payout, ctxOrInteraction) {
        clearTimeout(session.timeout);
        sessions.delete(session.key);
        let balance = null;
        if (payout > 0) {
            const add = await economyWrite.addBalance(session.botId, session.guildId, session.userId, payout, session.currency.currency_key, `minesweeper ${outcome}`);
            balance = add.balance;
        } else {
            const bal = await economyRead.getBalance(session.botId, session.guildId, session.userId, session.currency.currency_key);
            balance = bal.balance;
        }
        const payload = {
            embeds: [gameEmbed(session, { outcome, payout, balance, currency: session.currency })],
            components: renderGrid(session, { done: true }),
        };
        const editReply = typeof ctxOrInteraction.editReply === 'function'
            ? (p) => ctxOrInteraction.editReply(p)
            : (p) => ctxOrInteraction.update(p);
        await editReply(payload).catch(() => {});

        // Bei einem Mine-Treffer nach 10s das aufgedeckte Minenfeld ausblenden und
        // nur noch den Nochmal-Button anzeigen — verhindert, dass die Bomben-Positionen
        // dauerhaft sichtbar bleiben und gibt einen direkten Replay-Einstieg.
        if (outcome === 'boom') {
            setTimeout(async () => {
                await editReply({
                    embeds: payload.embeds,
                    components: againRow(session.guildId, session.userId, session.bet, session.mineCount, session.currency.currency_key),
                }).catch(() => {});
            }, 10_000);
        }
    }

    bh.events.on('button.clicked', async (payload) => {
        if (!payload.customId?.startsWith('ms_cell:') && !payload.customId?.startsWith('ms_cashout:')) return;
        const interaction = payload._interaction;

        if (payload.customId.startsWith('ms_cashout:')) {
            const key = payload.customId.slice('ms_cashout:'.length);
            const session = sessions.get(key);
            if (!session) { await interaction.reply({ content: '⏰ Diese Runde ist abgelaufen.', ephemeral: true }).catch(() => {}); return; }
            if (payload.user.id !== session.userId) { await interaction.reply({ content: '❌ Das ist nicht deine Runde.', ephemeral: true }).catch(() => {}); return; }
            if (session.safeRevealed === 0) { await interaction.reply({ content: '❌ Erst mindestens ein Feld aufdecken.', ephemeral: true }).catch(() => {}); return; }

            const mult = game.multiplierAt(session.mineCount, session.safeRevealed, session.rtp);
            const payout = Math.floor(session.bet * mult);
            await endSession(session, 'cashout', payout, interaction);
            return;
        }

        const parts = payload.customId.split(':'); // ms_cell:guildId:userId:index
        const key = `${parts[1]}:${parts[2]}`;
        const index = parseInt(parts[3], 10);
        const session = sessions.get(key);

        if (!session) { await interaction.reply({ content: '⏰ Diese Runde ist abgelaufen.', ephemeral: true }).catch(() => {}); return; }
        if (payload.user.id !== session.userId) { await interaction.reply({ content: '❌ Das ist nicht deine Runde.', ephemeral: true }).catch(() => {}); return; }
        if (session.revealed.has(index)) { await interaction.deferUpdate().catch(() => {}); return; }

        if (session.mines.has(index)) {
            await endSession(session, 'boom', 0, interaction);
            return;
        }

        session.revealed.add(index);
        session.safeRevealed++;

        if (session.safeRevealed >= game.GRID_SIZE - session.mineCount) {
            const mult = game.multiplierAt(session.mineCount, session.safeRevealed, session.rtp);
            const payout = Math.floor(session.bet * mult);
            await endSession(session, 'cleared', payout, interaction);
            return;
        }

        await interaction.update({ embeds: [gameEmbed(session)], components: renderGrid(session) }).catch(() => {});
    });

    /** Gemeinsame Rundenstart-Logik für /minesweeper und den Nochmal-Button —
     * `send` bekommt entweder {text, ephemeral} (Fehler) oder {embeds, components}
     * (erfolgreicher Rundenstart) und entscheidet selbst reply vs. update. */
    async function startRound({ clientId, guildId, userId, bet, mineCount, currencyKey }, send, laterEditReply) {
        if (!economyRead || !economyWrite || !economyCurrency) {
            await send({ text: '❌ Economy-Modul nicht verfügbar. Bitte Admin kontaktieren.', ephemeral: true });
            return;
        }

        const key = sessionKey(guildId, userId);
        if (sessions.has(key)) {
            await send({ text: '❌ Du hast bereits eine aktive Minesweeper-Runde. Zahl sie erst mit 🔥 aus.', ephemeral: true });
            return;
        }
        if (!(bet > 0)) { await send({ text: '❌ Einsatz muss positiv sein.', ephemeral: true }); return; }

        const botId = await settings.resolveBotId(clientId);
        if (!botId) { await send({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

        const cfg = await settings.getSettings(botId);
        if (!cfg.enabled) { await send({ text: '❌ Minesweeper ist für diesen Bot deaktiviert.', ephemeral: true }); return; }
        if (bet < cfg.min_bet || bet > cfg.max_bet) {
            await send({ text: `❌ Einsatz muss zwischen **${cfg.min_bet}** und **${cfg.max_bet}** liegen.`, ephemeral: true });
            return;
        }

        const currency = await resolveCurrency(botId, currencyKey);
        if (!currency) { await send({ text: '⚙️ Für diesen Bot ist noch keine Currency eingerichtet.', ephemeral: true }); return; }
        if (!settings.currencyAllowed(cfg, currency.currency_key)) {
            await send({ text: `❌ Minesweeper erlaubt die Currency **${currency.name}** nicht.`, ephemeral: true });
            return;
        }

        const removeResult = await economyWrite.removeBalance(botId, guildId, userId, bet, currency.currency_key, 'minesweeper bet');
        if (!removeResult.success) {
            await send({
                text: removeResult.reason === 'insufficient_funds'
                    ? `❌ Nicht genug Guthaben. Aktuell: ${removeResult.currentBalance} ${currency.symbol}`
                    : `❌ Einsatz fehlgeschlagen (${removeResult.reason}).`,
                ephemeral: true,
            });
            return;
        }

        const { mines, mineCount: mc } = game.generateGrid(mineCount);
        const session = {
            key, mines, mineCount: mc, revealed: new Set(), safeRevealed: 0,
            bet, botId, guildId, userId, currency, rtp: cfg.rtp,
            timeout: null,
        };
        session.timeout = setTimeout(async () => {
            const s = sessions.get(key);
            if (!s) return;
            const mult = game.multiplierAt(s.mineCount, s.safeRevealed, s.rtp);
            const payout = s.safeRevealed > 0 ? Math.floor(s.bet * mult) : 0;
            await endSession(s, s.safeRevealed > 0 ? 'cashout' : 'boom', payout, { editReply: laterEditReply });
        }, 180_000);
        sessions.set(key, session);

        await send({ embeds: [gameEmbed(session)], components: renderGrid(session) });
    }

    bh.commands.register({
        name: 'minesweeper', description: 'Minesweeper-Wette — du wählst die Minen-Anzahl, 🔥 zahlt aus.',
        options: [
            { name: 'einsatz',  description: 'Wetteinsatz',                  type: 'integer', required: true },
            { name: 'minen',    description: `Anzahl Minen (1-${game.GRID_SIZE - 1})`, type: 'integer', required: true, min_value: 1, max_value: game.GRID_SIZE - 1 },
            { name: 'currency', description: 'Currency (Standard: Default)', type: 'string',  required: false },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'minesweeper-plugin:minesweeper')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }

            await startRound({
                clientId:    ctx.interaction.client.user.id,
                guildId:     ctx.guild.id,
                userId:      ctx.user.id,
                bet:         ctx.options.getInteger('einsatz', true),
                mineCount:   ctx.options.getInteger('minen', true),
                currencyKey: ctx.options.getString('currency'),
            }, (p) => ctx.reply(p), (p) => ctx.interaction.editReply(p));
        },
    });

    // ── "🔄 Nochmal"-Button: startet eine neue Runde mit demselben Einsatz/Minen/Currency ──
    bh.events.on('button.clicked', async (payload) => {
        if (!payload.customId?.startsWith('ms_again:')) return;
        const interaction = payload._interaction;
        const [, guildId, userId, betStr, mineCountStr, currencyKey] = payload.customId.split(':');

        if (payload.user.id !== userId) {
            await interaction.reply({ content: '❌ Das ist nicht deine Runde — nutze /minesweeper.', ephemeral: true }).catch(() => {});
            return;
        }

        await startRound({
            clientId:    interaction.client.user.id,
            guildId,
            userId,
            bet:         parseInt(betStr, 10),
            mineCount:   parseInt(mineCountStr, 10),
            currencyKey,
        }, async (p) => {
            if (p.text) await interaction.reply({ content: p.text, ephemeral: p.ephemeral }).catch(() => {});
            else await interaction.update({ embeds: p.embeds, components: p.components }).catch(() => {});
        }, (p) => interaction.editReply(p));
    });

    bh.plugin.onEnable(async () => { bh.logger.info('Minesweeper Plugin aktiviert'); });
    bh.plugin.onDisable(async () => {
        for (const s of sessions.values()) clearTimeout(s.timeout);
        sessions.clear();
        bh.logger.info('Minesweeper Plugin deaktiviert');
    });
};
