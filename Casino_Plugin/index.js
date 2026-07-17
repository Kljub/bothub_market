'use strict';

// Casino Plugin — BlackJack, Slots, Dice, Roulette, Coinflip.
// Guthaben läuft ausschließlich über das Economy-Plugin (economy.balance.*
// Services) — Casino führt nie selbst Buchungen auf bot_economy_balances aus.

const path = require('path');
const games    = require('./lib/games');
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

// ── Permission Check (identisch zum Muster in economy-plugin) ───────────────
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
    bh.logger.info('Casino Plugin geladen');

    // ── Economy-Service konsumieren (natives Core-Modul, kein Plugin mehr — die
    // Brücke wird von bot-manager.js unter Provider-Key 'economy' registriert) ──
    const economyRead     = await bh.services.get('economy', 'economy.balance.read');
    const economyWrite    = await bh.services.get('economy', 'economy.balance.write');
    const economyCurrency = await bh.services.get('economy', 'economy.currency.info');

    if (!economyRead || !economyWrite || !economyCurrency) {
        bh.logger.error('Casino Plugin: Economy-Services nicht verfügbar — Casino kann keine Wetten abwickeln.');
    }

    async function resolveCurrency(botId, currencyOption) {
        const currencies = await economyCurrency.listCurrencies(botId);
        if (!currencyOption) return currencies.find(c => c.is_default) ?? currencies[0] ?? null;
        return currencies.find(c => c.currency_key.toLowerCase() === currencyOption.toLowerCase()) ?? null;
    }

    /**
     * Gemeinsamer Preflight für alle Spiele: lädt Game-Settings + Currency, prüft
     * enabled/min_bet/max_bet/allowed_currencies, zieht bei Erfolg den Einsatz ab.
     * Bei Ablehnung wird direkt über actor.reply() geantwortet und null zurückgegeben.
     * actor = { clientId, guildId, userId, reply(payload) } — funktioniert sowohl für
     * einen Slash-Command-ctx als auch für einen rohen Button-Interaction-Wrapper
     * (siehe buttonActor() unten), damit der "🔄 Nochmal"-Button dieselbe Logik nutzt.
     */
    async function betPreflight(actor, gameKey, betAmount, currencyOpt) {
        if (!actor.guildId) { await actor.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return null; }
        if (!(betAmount > 0)) { await actor.reply({ text: '❌ Einsatz muss positiv sein.', ephemeral: true }); return null; }
        if (!economyRead || !economyWrite || !economyCurrency) {
            await actor.reply({ text: '❌ Economy-Plugin nicht verfügbar. Bitte Admin kontaktieren.', ephemeral: true });
            return null;
        }

        const botId = await settings.resolveBotId(actor.clientId);
        if (!botId) { await actor.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return null; }

        const gs = await settings.getGameSettings(botId, gameKey);
        if (!gs.enabled) {
            await actor.reply({ text: `❌ ${gameKey} ist für diesen Bot deaktiviert.`, ephemeral: true });
            return null;
        }
        if (betAmount < gs.min_bet || betAmount > gs.max_bet) {
            await actor.reply({ text: `❌ Einsatz muss zwischen **${gs.min_bet}** und **${gs.max_bet}** liegen.`, ephemeral: true });
            return null;
        }

        const currency = await resolveCurrency(botId, currencyOpt);
        if (!currency) {
            await actor.reply({ text: currencyOpt ? `❌ Unbekannte Currency \`${currencyOpt}\`.` : '⚙️ Für diesen Bot ist noch keine Currency eingerichtet.', ephemeral: true });
            return null;
        }
        if (!settings.currencyAllowed(gs, currency.currency_key)) {
            await actor.reply({ text: `❌ ${gameKey} erlaubt die Currency **${currency.name}** nicht.`, ephemeral: true });
            return null;
        }

        const removeResult = await economyWrite.removeBalance(botId, actor.guildId, actor.userId, betAmount, currency.currency_key, `${gameKey} bet`);
        if (!removeResult.success) {
            await actor.reply({
                text: removeResult.reason === 'insufficient_funds'
                    ? `❌ Nicht genug Guthaben. Aktuell: ${removeResult.currentBalance} ${currency.symbol}`
                    : `❌ Einsatz fehlgeschlagen (${removeResult.reason}).`,
                ephemeral: true,
            });
            return null;
        }

        return { botId, currency, rtp: gs.rtp };
    }

    async function payout(botId, guildId, userId, amount, currencyKey, gameKey) {
        if (amount <= 0) return null;
        return economyWrite.addBalance(botId, guildId, userId, amount, currencyKey, `${gameKey} payout`);
    }

    /** ctx (Slash-Command) als actor-Adapter für betPreflight(). */
    function ctxActor(ctx) {
        return {
            clientId: ctx.interaction.client.user.id,
            guildId: ctx.guild?.id ?? null,
            userId: ctx.user.id,
            reply: (p) => ctx.reply(p),
        };
    }

    /** Rohe Button-Interaction als actor-Adapter für betPreflight() — für den "🔄 Nochmal"-Button. */
    function buttonActor(interaction, guildId, userId) {
        return {
            clientId: interaction.client.user.id,
            guildId, userId,
            reply: (p) => interaction.reply({ content: p.text, embeds: p.embeds, components: p.components, ephemeral: p.ephemeral }),
        };
    }

    /** "🔄 Nochmal"-Button — codiert Spiel+Einsatz+Currency+Extra kompakt im custom_id.
     * Wird nur angehängt, wenn die resultierende custom_id sicher unter Discords
     * 100-Zeichen-Limit bleibt (Sicherheitsnetz für sehr lange Currency-Keys). */
    function againRow(game, userId, bet, currencyKey, extra = '') {
        const id = `casino_again:${game}:${userId}:${bet}:${currencyKey}:${extra}`;
        if (id.length > 100) return [];
        return [{ type: 1, components: [{ type: 2, style: 2, label: '🔄 Nochmal', custom_id: id }] }];
    }

    // ── Coinflip ─────────────────────────────────────────────────────────────
    async function runCoinflip(actor, bet, side, currencyOpt) {
        const pre = await betPreflight(actor, 'coinflip', bet, currencyOpt);
        if (!pre) return;

        const res = games.playCoinflip(bet, side, pre.rtp);
        if (res.payout > 0) await payout(pre.botId, actor.guildId, actor.userId, res.payout, pre.currency.currency_key, 'coinflip');
        const bal = await economyRead.getBalance(pre.botId, actor.guildId, actor.userId, pre.currency.currency_key);

        await actor.reply({
            embeds: [{
                color: res.win ? 0x4ade80 : 0xef4444,
                title: res.win ? '🪙 Gewonnen!' : '🪙 Verloren',
                description: `Ergebnis: **${res.result === 'heads' ? 'Kopf' : 'Zahl'}**\n`
                    + `Einsatz: ${fmt(bet, pre.currency)}\n`
                    + (res.win ? `Auszahlung: **${fmt(res.payout, pre.currency)}**\n` : '')
                    + `Neuer Kontostand: ${fmt(bal.balance, pre.currency)}`,
            }],
            components: againRow('coinflip', actor.userId, bet, pre.currency.currency_key, side),
        });
    }

    bh.commands.register({
        name: 'coinflip', description: 'Kopf oder Zahl — setze und gewinne.',
        options: [
            { name: 'einsatz',  description: 'Wetteinsatz',                    type: 'integer', required: true },
            { name: 'seite',    description: 'Deine Wahl',                     type: 'string',  required: true, choices: [{ name: 'Kopf', value: 'heads' }, { name: 'Zahl', value: 'tails' }] },
            { name: 'currency', description: 'Currency (Standard: Default)',   type: 'string',  required: false },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'casino-plugin:coinflip')) return;
            await runCoinflip(ctxActor(ctx), ctx.options.getInteger('einsatz', true), ctx.options.getString('seite', true), ctx.options.getString('currency'));
        },
    });

    // ── Dice ─────────────────────────────────────────────────────────────────
    async function runDice(actor, bet, guess, currencyOpt) {
        const pre = await betPreflight(actor, 'dice', bet, currencyOpt);
        if (!pre) return;

        const res = games.playDice(bet, guess, pre.rtp);
        if (res.payout > 0) await payout(pre.botId, actor.guildId, actor.userId, res.payout, pre.currency.currency_key, 'dice');
        const bal = await economyRead.getBalance(pre.botId, actor.guildId, actor.userId, pre.currency.currency_key);

        await actor.reply({
            embeds: [{
                color: res.win ? 0x4ade80 : 0xef4444,
                title: res.win ? '🎲 Gewonnen!' : '🎲 Verloren',
                description: `Gewürfelt: **${res.roll}** (geraten: ${guess})\n`
                    + `Einsatz: ${fmt(bet, pre.currency)}\n`
                    + (res.win ? `Auszahlung: **${fmt(res.payout, pre.currency)}** (6x)\n` : '')
                    + `Neuer Kontostand: ${fmt(bal.balance, pre.currency)}`,
            }],
            components: againRow('dice', actor.userId, bet, pre.currency.currency_key, String(guess)),
        });
    }

    bh.commands.register({
        name: 'dice', description: 'Würfel-Wette — rate die Zahl (1-6).',
        options: [
            { name: 'einsatz',  description: 'Wetteinsatz',                  type: 'integer', required: true },
            { name: 'zahl',     description: 'Deine Zahl (1-6)',             type: 'integer', required: true, min_value: 1, max_value: 6 },
            { name: 'currency', description: 'Currency (Standard: Default)', type: 'string',  required: false },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'casino-plugin:dice')) return;
            await runDice(ctxActor(ctx), ctx.options.getInteger('einsatz', true), ctx.options.getInteger('zahl', true), ctx.options.getString('currency'));
        },
    });

    // ── Slots ────────────────────────────────────────────────────────────────
    async function runSlots(actor, bet, currencyOpt) {
        const pre = await betPreflight(actor, 'slots', bet, currencyOpt);
        if (!pre) return;

        const res = games.playSlots(bet, pre.rtp);
        if (res.payout > 0) await payout(pre.botId, actor.guildId, actor.userId, res.payout, pre.currency.currency_key, 'slots');
        const bal = await economyRead.getBalance(pre.botId, actor.guildId, actor.userId, pre.currency.currency_key);

        await actor.reply({
            embeds: [{
                color: res.win ? 0x4ade80 : 0xef4444,
                title: '🎰 ' + res.reels.join(' | '),
                description: (res.win ? `Treffer! Auszahlung: **${fmt(res.payout, pre.currency)}**\n` : 'Kein Treffer.\n')
                    + `Einsatz: ${fmt(bet, pre.currency)}\n`
                    + `Neuer Kontostand: ${fmt(bal.balance, pre.currency)}`,
            }],
            components: againRow('slots', actor.userId, bet, pre.currency.currency_key),
        });
    }

    bh.commands.register({
        name: 'slots', description: 'Einarmiger Bandit — 3 Walzen, 3 gleiche gewinnen groß.',
        options: [
            { name: 'einsatz',  description: 'Wetteinsatz',                  type: 'integer', required: true },
            { name: 'currency', description: 'Currency (Standard: Default)', type: 'string',  required: false },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'casino-plugin:slots')) return;
            await runSlots(ctxActor(ctx), ctx.options.getInteger('einsatz', true), ctx.options.getString('currency'));
        },
    });

    // ── Roulette ─────────────────────────────────────────────────────────────
    function validRouletteField(f) {
        return /^\d+$/.test(f) ? (parseInt(f, 10) >= 0 && parseInt(f, 10) <= 36)
            : ['red', 'black', 'even', 'odd', 'low', 'high'].includes(f);
    }

    async function runRoulette(actor, bet, field, currencyOpt) {
        const pre = await betPreflight(actor, 'roulette', bet, currencyOpt);
        if (!pre) return;

        const res = games.playRoulette(bet, field, pre.rtp);
        if (res.payout > 0) await payout(pre.botId, actor.guildId, actor.userId, res.payout, pre.currency.currency_key, 'roulette');
        const bal = await economyRead.getBalance(pre.botId, actor.guildId, actor.userId, pre.currency.currency_key);

        const colorEmoji = { red: '🔴', black: '⚫', green: '🟢' }[res.color];
        await actor.reply({
            embeds: [{
                color: res.win ? 0x4ade80 : 0xef4444,
                title: `🎡 ${res.pocket} ${colorEmoji}`,
                description: `Dein Feld: **${field}**\n`
                    + `Einsatz: ${fmt(bet, pre.currency)}\n`
                    + (res.win ? `Auszahlung: **${fmt(res.payout, pre.currency)}**\n` : 'Kein Treffer.\n')
                    + `Neuer Kontostand: ${fmt(bal.balance, pre.currency)}`,
            }],
            components: againRow('roulette', actor.userId, bet, pre.currency.currency_key, field),
        });
    }

    bh.commands.register({
        name: 'roulette', description: 'Europäisches Roulette (0-36) — Zahl oder Farbe/Bereich setzen.',
        options: [
            { name: 'einsatz',  description: 'Wetteinsatz',                  type: 'integer', required: true },
            { name: 'feld',     description: 'Zahl (0-36) oder red/black/even/odd/low/high', type: 'string', required: true },
            { name: 'currency', description: 'Currency (Standard: Default)', type: 'string',  required: false },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'casino-plugin:roulette')) return;
            const field = ctx.options.getString('feld', true).trim().toLowerCase();
            if (!validRouletteField(field)) {
                await ctx.reply({ text: '❌ Ungültiges Feld. Zahl 0-36 oder red/black/even/odd/low/high.', ephemeral: true });
                return;
            }
            await runRoulette(ctxActor(ctx), ctx.options.getInteger('einsatz', true), field, ctx.options.getString('currency'));
        },
    });

    // ── "🔄 Nochmal"-Button: routet zum passenden runX() mit demselben Einsatz ──
    bh.events.on('button.clicked', async (payload) => {
        if (!payload.customId?.startsWith('casino_again:')) return;
        const interaction = payload._interaction;
        const [, game, userId, betStr, currencyKey, extra] = payload.customId.split(':');

        if (payload.user.id !== userId) {
            await interaction.reply({ content: '❌ Das ist nicht dein Spiel — nutze deinen eigenen Command.', ephemeral: true }).catch(() => {});
            return;
        }
        if (!payload.guild) {
            await interaction.reply({ content: '❌ Nur auf einem Server nutzbar.', ephemeral: true }).catch(() => {});
            return;
        }

        const bet = parseInt(betStr, 10);
        const actor = buttonActor(interaction, payload.guild.id, userId);

        if (game === 'coinflip') await runCoinflip(actor, bet, extra, currencyKey);
        else if (game === 'dice') await runDice(actor, bet, parseInt(extra, 10), currencyKey);
        else if (game === 'slots') await runSlots(actor, bet, currencyKey);
        else if (game === 'roulette') await runRoulette(actor, bet, extra, currencyKey);
    });

    // ── /blackjack (mehrstufig — Hit/Stand/Split Buttons) ────────────────────
    // Session hält 1-2 Hände (Split erzeugt die zweite). Alle Hände teilen sich
    // dasselbe Deck und dieselbe (einmal gezogene) Dealer-Hand.
    const bjSessions = new Map(); // token -> { hands, activeHandIndex, deck, dealer, bet, botId, guildId, userId, currency, rtp, timeout, splitUsed }

    function activeHand(session) { return session.hands[session.activeHandIndex]; }

    function bjButtons(token, session, disabled = false) {
        const hand = activeHand(session);
        const canOfferSplit = !disabled && session.hands.length === 1 && !session.splitUsed && games.canSplit(hand.cards);
        const components = [
            { type: 2, style: 3, label: 'Hit',   custom_id: `casino_bj_hit:${token}`,   disabled },
            { type: 2, style: 4, label: 'Stand', custom_id: `casino_bj_stand:${token}`, disabled },
        ];
        if (canOfferSplit) components.push({ type: 2, style: 1, label: 'Split', custom_id: `casino_bj_split:${token}`, disabled });
        return [{ type: 1, components }];
    }

    function bjEmbed(session, { done = false, results = null, totalPayout = 0, balance = null } = {}) {
        const dealerCards = done ? games.handStr(session.dealer) : `${games.cardStr(session.dealer[0])} 🂠`;
        const dealerVal   = done ? games.handValue(session.dealer) : '?';
        const lines = [`**Dealer:** ${dealerCards} (${dealerVal})`, ''];

        const outcomeText = {
            blackjack: '🃏 Blackjack!', win: '✅ Gewonnen', lose: '❌ Verloren',
            bust: '💥 Überkauft', push: '➖ Unentschieden',
        };

        session.hands.forEach((hand, i) => {
            const active = !done && i === session.activeHandIndex;
            const label = session.hands.length > 1 ? `**Hand ${i + 1}${active ? ' ◀' : ''}:**` : '**Du:**';
            let line = `${label} ${games.handStr(hand.cards)} (${games.handValue(hand.cards)})`;
            if (done && results) line += ` — ${outcomeText[results[i].outcome] ?? results[i].outcome}`;
            lines.push(line);
        });

        if (done) {
            lines.push('');
            if (totalPayout > 0) lines.push(`Auszahlung gesamt: **${fmt(totalPayout, session.currency)}**`);
            if (balance !== null) lines.push(`Neuer Kontostand: ${fmt(balance, session.currency)}`);
        }

        const anyWin = results?.some(r => r.outcome === 'win' || r.outcome === 'blackjack');
        const allLose = results?.every(r => r.outcome === 'lose' || r.outcome === 'bust');
        return {
            color: done ? (allLose ? 0xef4444 : (anyWin ? 0x4ade80 : 0xf0c040)) : 0xf0c040,
            title: '🃏 Blackjack',
            description: lines.join('\n'),
        };
    }

    async function bjFinish(token, session, ctxInteraction) {
        clearTimeout(session.timeout);
        bjSessions.delete(token);

        games.dealerPlay({ deck: session.deck, dealer: session.dealer });
        const results = session.hands.map(hand => games.resolveHandVsDealer(hand.cards, session.dealer, hand.bet, session.rtp, session.hands.length > 1));
        const totalPayout = results.reduce((s, r) => s + r.payout, 0);
        if (totalPayout > 0) await payout(session.botId, session.guildId, session.userId, totalPayout, session.currency.currency_key, 'blackjack');
        const bal = await economyRead.getBalance(session.botId, session.guildId, session.userId, session.currency.currency_key);

        await ctxInteraction.update({
            embeds: [bjEmbed(session, { done: true, results, totalPayout, balance: bal.balance })],
            components: [...bjButtons(token, session, true), ...againRow('blackjack', session.userId, session.bet, session.currency.currency_key)],
        }).catch(() => {});
    }

    /** Nach Hit(bust)/Stand auf der aktiven Hand: zur nächsten Hand wechseln oder beenden. */
    async function bjAdvanceOrFinish(token, session, interaction) {
        if (session.activeHandIndex < session.hands.length - 1) {
            session.activeHandIndex++;
            await interaction.update({ embeds: [bjEmbed(session)], components: bjButtons(token, session) }).catch(() => {});
            return;
        }
        await bjFinish(token, session, interaction);
    }

    async function dealBlackjack(actor, bet, replyFn) {
        const dealt = games.blackjackDeal(Math.random);
        const token = `${actor.userId}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

        // Natural Blackjack direkt beim Deal (kein Hit/Stand/Split nötig)
        if (games.isBlackjack(dealt.player)) {
            games.dealerPlay(dealt);
            const res = games.resolveHandVsDealer(dealt.player, dealt.dealer, bet, actor.rtp);
            if (res.payout > 0) await payout(actor.botId, actor.guildId, actor.userId, res.payout, actor.currency.currency_key, 'blackjack');
            const bal = await economyRead.getBalance(actor.botId, actor.guildId, actor.userId, actor.currency.currency_key);
            const soloSession = { hands: [{ cards: dealt.player, bet }], activeHandIndex: 0, dealer: dealt.dealer, currency: actor.currency, userId: actor.userId };
            await replyFn({
                embeds: [bjEmbed(soloSession, { done: true, results: [res], totalPayout: res.payout, balance: bal.balance })],
                components: againRow('blackjack', actor.userId, bet, actor.currency.currency_key),
            });
            return;
        }

        const session = {
            hands: [{ cards: dealt.player, bet }], activeHandIndex: 0, splitUsed: false,
            deck: dealt.deck, dealer: dealt.dealer,
            bet, botId: actor.botId, guildId: actor.guildId, userId: actor.userId,
            currency: actor.currency, rtp: actor.rtp, timeout: null,
        };
        session.timeout = setTimeout(async () => {
            const s = bjSessions.get(token);
            if (!s) return;
            await bjFinish(token, s, { update: (p) => replyFn(p, true) });
        }, 120_000);
        bjSessions.set(token, session);

        await replyFn({ embeds: [bjEmbed(session)], components: bjButtons(token, session) });
    }

    bh.commands.register({
        name: 'blackjack', description: 'Blackjack gegen den Dealer — Hit, Stand oder Split bei einem Paar.',
        options: [
            { name: 'einsatz',  description: 'Wetteinsatz',                  type: 'integer', required: true },
            { name: 'currency', description: 'Currency (Standard: Default)', type: 'string',  required: false },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'casino-plugin:blackjack')) return;
            const bet = ctx.options.getInteger('einsatz', true);
            const pre = await betPreflight(ctxActor(ctx), 'blackjack', bet, ctx.options.getString('currency'));
            if (!pre) return;

            await dealBlackjack(
                { botId: pre.botId, guildId: ctx.guild.id, userId: ctx.user.id, currency: pre.currency, rtp: pre.rtp },
                bet,
                async (payload, isEdit) => (isEdit ? ctx.interaction.editReply(payload) : ctx.reply(payload)),
            );
        },
    });

    bh.events.on('button.clicked', async (payload) => {
        if (payload.customId?.startsWith('casino_again:blackjack:')) {
            const interaction = payload._interaction;
            const [, , userId, betStr, currencyKey] = payload.customId.split(':');
            if (payload.user.id !== userId) {
                await interaction.reply({ content: '❌ Das ist nicht dein Spiel — nutze deinen eigenen Command.', ephemeral: true }).catch(() => {});
                return;
            }
            if (!payload.guild) {
                await interaction.reply({ content: '❌ Nur auf einem Server nutzbar.', ephemeral: true }).catch(() => {});
                return;
            }
            const bet = parseInt(betStr, 10);
            const actor = buttonActor(interaction, payload.guild.id, userId);
            const pre = await betPreflight(actor, 'blackjack', bet, currencyKey);
            if (!pre) return;

            await dealBlackjack(
                { botId: pre.botId, guildId: payload.guild.id, userId, currency: pre.currency, rtp: pre.rtp },
                bet,
                async (p) => interaction.reply(p),
            );
        }
    });

    bh.plugin.onEnable(async () => {
        bh.logger.info('Casino Plugin aktiviert');
    });

    bh.plugin.onDisable(async () => {
        for (const s of bjSessions.values()) clearTimeout(s.timeout);
        bjSessions.clear();
        bh.logger.info('Casino Plugin deaktiviert');
    });
};
