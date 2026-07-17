'use strict';

// RPS Plugin — Schere-Stein-Papier, solo gegen den Bot oder als Duell gegen
// einen anderen User. Einsatz über das Economy-Modul ist optional: ohne
// "einsatz"-Option läuft das Spiel komplett ohne jeden Economy-Aufruf.

const path = require('path');
const game = require('./lib/game');

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

function fmt(amount, currency) {
    return `${Number(amount).toLocaleString('de-DE')} ${currency.symbol} ${currency.name}`;
}

module.exports = async function (bh) {
    bh.logger.info('RPS Plugin geladen');

    const economyRead     = await bh.services.get('economy', 'economy.balance.read');
    const economyWrite     = await bh.services.get('economy', 'economy.balance.write');
    const economyCurrency  = await bh.services.get('economy', 'economy.currency.info');
    const economyAvailable = !!(economyRead && economyWrite && economyCurrency);

    async function resolveBotId(clientId) {
        const dbQuery = getDbQuery();
        if (!dbQuery) return null;
        const rows = await dbQuery('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
        return rows[0]?.id ?? null;
    }

    async function resolveCurrency(botId, currencyOption) {
        const currencies = await economyCurrency.listCurrencies(botId);
        if (!currencyOption) return currencies.find(c => c.is_default) ?? currencies[0] ?? null;
        return currencies.find(c => c.currency_key.toLowerCase() === currencyOption.toLowerCase()) ?? null;
    }

    /** Zieht den Einsatz ein, falls bet>0 angegeben wurde. Gibt bei bet=0/undefined
     * sofort {ok:true, currency:null} zurück — kein Economy-Aufruf, spielt "umsonst". */
    async function takeBet(botId, guildId, userId, bet, currencyOpt, reply) {
        if (!bet) return { ok: true, currency: null };
        if (!economyAvailable) {
            await reply({ text: '❌ Economy-Modul nicht verfügbar — spiel ohne Einsatz (Option weglassen).', ephemeral: true });
            return { ok: false };
        }
        if (bet < 0) {
            await reply({ text: '❌ Einsatz muss positiv sein.', ephemeral: true });
            return { ok: false };
        }
        const currency = await resolveCurrency(botId, currencyOpt);
        if (!currency) {
            await reply({ text: '⚙️ Für diesen Bot ist noch keine Currency eingerichtet.', ephemeral: true });
            return { ok: false };
        }
        const removeResult = await economyWrite.removeBalance(botId, guildId, userId, bet, currency.currency_key, 'rps bet');
        if (!removeResult.success) {
            await reply({
                text: removeResult.reason === 'insufficient_funds'
                    ? `❌ Nicht genug Guthaben. Aktuell: ${removeResult.currentBalance} ${currency.symbol}`
                    : `❌ Einsatz fehlgeschlagen (${removeResult.reason}).`,
                ephemeral: true,
            });
            return { ok: false };
        }
        return { ok: true, currency };
    }

    // ── /rps — solo gegen den Bot ────────────────────────────────────────────
    bh.commands.register({
        name: 'rps', description: 'Schere, Stein, Papier gegen den Bot.',
        options: [
            { name: 'wahl',     description: 'Deine Wahl', type: 'string', required: true,
              choices: [
                  { name: '🪨 Stein', value: 'rock' },
                  { name: '📄 Papier', value: 'paper' },
                  { name: '✂️ Schere', value: 'scissors' },
              ] },
            { name: 'einsatz',  description: 'Optionaler Einsatz (leer lassen = ohne Currency spielen)', type: 'integer', required: false },
            { name: 'currency', description: 'Currency (Standard: Default)', type: 'string', required: false },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'rps-plugin:rps')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }

            const botId = await resolveBotId(ctx.interaction.client.user.id);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const playerChoice = ctx.options.getString('wahl', true);
            const bet = ctx.options.getInteger('einsatz') || 0;

            const preflight = await takeBet(botId, ctx.guild.id, ctx.user.id, bet, ctx.options.getString('currency'), (p) => ctx.reply(p));
            if (!preflight.ok) return;
            const currency = preflight.currency;

            const botChoice = game.randomChoice();
            const outcome = game.resolve(playerChoice, botChoice);

            let resultLine;
            let balanceLine = '';
            if (outcome === 'tie') {
                resultLine = '🤝 Unentschieden!';
                if (bet > 0) {
                    const add = await economyWrite.addBalance(botId, ctx.guild.id, ctx.user.id, bet, currency.currency_key, 'rps push');
                    balanceLine = `\nEinsatz zurückerstattet. Kontostand: ${fmt(add.balance, currency)}`;
                }
            } else if (outcome === 'a') {
                resultLine = '🎉 Du gewinnst!';
                if (bet > 0) {
                    const payout = bet * 2;
                    const add = await economyWrite.addBalance(botId, ctx.guild.id, ctx.user.id, payout, currency.currency_key, 'rps win');
                    balanceLine = `\nGewinn: **${fmt(payout, currency)}** · Kontostand: ${fmt(add.balance, currency)}`;
                }
            } else {
                resultLine = '💀 Du verlierst!';
                if (bet > 0) {
                    const bal = await economyRead.getBalance(botId, ctx.guild.id, ctx.user.id, currency.currency_key);
                    balanceLine = `\nEinsatz verloren. Kontostand: ${fmt(bal.balance, currency)}`;
                }
            }

            await ctx.reply({
                embeds: [{
                    color: outcome === 'a' ? 0x22c55e : outcome === 'tie' ? 0xeab308 : 0xef4444,
                    title: '✂️ Schere, Stein, Papier',
                    description: `Du: ${game.EMOJI[playerChoice]} ${game.LABEL[playerChoice]}\nBot: ${game.EMOJI[botChoice]} ${game.LABEL[botChoice]}\n\n${resultLine}${balanceLine}`,
                }],
            });
        },
    });

    // ── /rps-duel — PvP mit versteckten, gleichzeitigen Wahlen ─────────────────
    // Session: beide Spieler klicken dieselben 3 Buttons auf DERSELBEN Nachricht,
    // der Bot ordnet den Click per user.id dem richtigen Spieler zu und bestätigt
    // nur ephemeral — der Gegner sieht die Wahl nicht, bis beide gewählt haben.
    const duels = new Map(); // duelId -> { challengerId, opponentId, bet, currency, botId, guildId, picks:{}, timeout }

    function duelId(guildId, challengerId, opponentId) { return `${guildId}:${challengerId}:${opponentId}:${Date.now()}`; }

    function choiceRow(id) {
        return [{
            type: 1,
            components: [
                { type: 2, style: 2, label: `${game.EMOJI.rock} Stein`,    custom_id: `rps_pick:${id}:rock` },
                { type: 2, style: 2, label: `${game.EMOJI.paper} Papier`,  custom_id: `rps_pick:${id}:paper` },
                { type: 2, style: 2, label: `${game.EMOJI.scissors} Schere`, custom_id: `rps_pick:${id}:scissors` },
            ],
        }];
    }

    bh.commands.register({
        name: 'rps-duel', description: 'Fordert einen anderen User zu Schere-Stein-Papier heraus.',
        options: [
            { name: 'gegner',   description: 'Wen du herausfordern willst', type: 'user',    required: true },
            { name: 'einsatz',  description: 'Optionaler Einsatz (leer lassen = ohne Currency spielen)', type: 'integer', required: false },
            { name: 'currency', description: 'Currency (Standard: Default)', type: 'string',  required: false },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'rps-plugin:rps-duel')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }

            const opponent = ctx.options.getUser('gegner', true);
            if (opponent.id === ctx.user.id) { await ctx.reply({ text: '❌ Du kannst nicht gegen dich selbst antreten.', ephemeral: true }); return; }
            if (opponent.bot) { await ctx.reply({ text: '❌ Bots können nicht herausgefordert werden.', ephemeral: true }); return; }

            const botId = await resolveBotId(ctx.interaction.client.user.id);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const bet = ctx.options.getInteger('einsatz') || 0;
            const preflight = await takeBet(botId, ctx.guild.id, ctx.user.id, bet, ctx.options.getString('currency'), (p) => ctx.reply(p));
            if (!preflight.ok) return;
            const currency = preflight.currency;

            const id = duelId(ctx.guild.id, ctx.user.id, opponent.id);
            const session = {
                challengerId: ctx.user.id, opponentId: opponent.id, bet, currency, botId, guildId: ctx.guild.id,
                picks: {}, timeout: null,
            };
            duels.set(id, session);
            session.timeout = setTimeout(async () => {
                const s = duels.get(id);
                if (!s) return;
                duels.delete(id);
                if (s.bet > 0 && Object.keys(s.picks).length < 2) {
                    // Refund allen, die schon eingezahlt haben (Challenger immer, Opponent nur nach Accept).
                    await economyWrite.addBalance(s.botId, s.guildId, s.challengerId, s.bet, s.currency.currency_key, 'rps timeout refund').catch(() => {});
                }
            }, 120_000);

            const betLine = bet > 0 ? `\nEinsatz: **${fmt(bet, currency)}** pro Person` : '\nOhne Einsatz.';
            await ctx.reply({
                embeds: [{
                    color: 0xf0c040,
                    title: '⚔️ RPS-Duell',
                    description: `<@${ctx.user.id}> fordert <@${opponent.id}> heraus!${betLine}`,
                }],
                components: [{
                    type: 1,
                    components: [
                        { type: 2, style: 3, label: 'Annehmen', custom_id: `rps_accept:${id}` },
                        { type: 2, style: 4, label: 'Ablehnen', custom_id: `rps_decline:${id}` },
                    ],
                }],
            });
        },
    });

    async function resolveDuel(interaction, id, session) {
        clearTimeout(session.timeout);
        duels.delete(id);
        const a = session.picks[session.challengerId];
        const b = session.picks[session.opponentId];
        const outcome = game.resolve(a, b);

        let resultLine, payoutLine = '';
        if (outcome === 'tie') {
            resultLine = '🤝 Unentschieden!';
            if (session.bet > 0) {
                await economyWrite.addBalance(session.botId, session.guildId, session.challengerId, session.bet, session.currency.currency_key, 'rps duel push').catch(() => {});
                await economyWrite.addBalance(session.botId, session.guildId, session.opponentId, session.bet, session.currency.currency_key, 'rps duel push').catch(() => {});
                payoutLine = '\nBeide Einsätze wurden zurückerstattet.';
            }
        } else {
            const winnerId = outcome === 'a' ? session.challengerId : session.opponentId;
            resultLine = `🏆 <@${winnerId}> gewinnt!`;
            if (session.bet > 0) {
                const pot = session.bet * 2;
                await economyWrite.addBalance(session.botId, session.guildId, winnerId, pot, session.currency.currency_key, 'rps duel win').catch(() => {});
                payoutLine = `\nGewinn: **${fmt(pot, session.currency)}**`;
            }
        }

        await interaction.update({
            embeds: [{
                color: outcome === 'tie' ? 0xeab308 : 0x22c55e,
                title: '⚔️ RPS-Duell — Ergebnis',
                description: `<@${session.challengerId}>: ${game.EMOJI[a]} ${game.LABEL[a]}\n<@${session.opponentId}>: ${game.EMOJI[b]} ${game.LABEL[b]}\n\n${resultLine}${payoutLine}`,
            }],
            components: [],
        }).catch(() => {});
    }

    bh.events.on('button.clicked', async (payload) => {
        const interaction = payload._interaction;

        if (payload.customId?.startsWith('rps_decline:')) {
            const id = payload.customId.slice('rps_decline:'.length);
            const session = duels.get(id);
            if (!session) { await interaction.reply({ content: '⏰ Diese Herausforderung ist abgelaufen.', ephemeral: true }).catch(() => {}); return; }
            if (payload.user.id !== session.opponentId) { await interaction.reply({ content: '❌ Nur der Herausgeforderte kann ablehnen.', ephemeral: true }).catch(() => {}); return; }
            clearTimeout(session.timeout);
            duels.delete(id);
            if (session.bet > 0) {
                await economyWrite.addBalance(session.botId, session.guildId, session.challengerId, session.bet, session.currency.currency_key, 'rps duel declined refund').catch(() => {});
            }
            await interaction.update({
                embeds: [{ color: 0x6b7280, title: '⚔️ RPS-Duell', description: `<@${session.opponentId}> hat abgelehnt.` }],
                components: [],
            }).catch(() => {});
            return;
        }

        if (payload.customId?.startsWith('rps_accept:')) {
            const id = payload.customId.slice('rps_accept:'.length);
            const session = duels.get(id);
            if (!session) { await interaction.reply({ content: '⏰ Diese Herausforderung ist abgelaufen.', ephemeral: true }).catch(() => {}); return; }
            if (payload.user.id !== session.opponentId) { await interaction.reply({ content: '❌ Nur der Herausgeforderte kann annehmen.', ephemeral: true }).catch(() => {}); return; }

            if (session.bet > 0) {
                const removeResult = await economyWrite.removeBalance(session.botId, session.guildId, session.opponentId, session.bet, session.currency.currency_key, 'rps duel bet');
                if (!removeResult.success) {
                    await interaction.reply({
                        content: removeResult.reason === 'insufficient_funds'
                            ? `❌ Nicht genug Guthaben. Aktuell: ${removeResult.currentBalance} ${session.currency.symbol}`
                            : `❌ Einsatz fehlgeschlagen (${removeResult.reason}).`,
                        ephemeral: true,
                    }).catch(() => {});
                    return;
                }
            }

            await interaction.update({
                embeds: [{
                    color: 0x3b82f6,
                    title: '⚔️ RPS-Duell — angenommen!',
                    description: `<@${session.challengerId}> vs. <@${session.opponentId}>\nBeide wählen jetzt privat (Klick unten, nur du siehst die Bestätigung).`,
                }],
                components: choiceRow(id),
            }).catch(() => {});
            return;
        }

        if (payload.customId?.startsWith('rps_pick:')) {
            const [, id, choice] = payload.customId.split(':');
            const session = duels.get(id);
            if (!session) { await interaction.reply({ content: '⏰ Dieses Duell ist abgelaufen.', ephemeral: true }).catch(() => {}); return; }
            if (payload.user.id !== session.challengerId && payload.user.id !== session.opponentId) {
                await interaction.reply({ content: '❌ Das ist nicht dein Duell.', ephemeral: true }).catch(() => {});
                return;
            }
            if (session.picks[payload.user.id]) {
                await interaction.reply({ content: 'ℹ️ Du hast bereits gewählt.', ephemeral: true }).catch(() => {});
                return;
            }
            session.picks[payload.user.id] = choice;
            const bothPicked = session.picks[session.challengerId] && session.picks[session.opponentId];

            if (!bothPicked) {
                // Einzige Response für diese Interaction: ephemerale Bestätigung.
                await interaction.reply({ content: `✅ Du hast ${game.EMOJI[choice]} ${game.LABEL[choice]} gewählt. Warte auf deinen Gegner…`, ephemeral: true }).catch(() => {});
                return;
            }
            // Beide haben gewählt — die einzige Response für DIESE Interaction ist das
            // öffentliche update() in resolveDuel() (kann nicht zusätzlich noch reply()
            // aufrufen, eine Interaction akzeptiert nur eine Erst-Antwort).
            await resolveDuel(interaction, id, session);
        }
    });

    bh.plugin.onEnable(async () => { bh.logger.info('RPS Plugin aktiviert'); });
    bh.plugin.onDisable(async () => {
        for (const s of duels.values()) clearTimeout(s.timeout);
        duels.clear();
        bh.logger.info('RPS Plugin deaktiviert');
    });
};
