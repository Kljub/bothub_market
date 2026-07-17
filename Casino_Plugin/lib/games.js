'use strict';

// Reine Spiellogik (kein Discord/DB-Zugriff) — deterministisch testbar via
// injizierbaren rng-Parameter. RTP-Skalierung läuft überall über
// "fairMultiplier * (rtp/100)": der fairMultiplier ist so gewählt, dass bei
// rtp=100 der Erwartungswert exakt 1x Einsatz ist (mathematisch faires Spiel,
// EV=1.0) — die Owner-RTP-Einstellung erzeugt den House-Edge, nicht ein
// verfälschter Zufallsgenerator.

function weightedPick(table, rng) {
    const total = table.reduce((s, t) => s + t.weight, 0);
    let r = rng() * total;
    for (const t of table) {
        if (r < t.weight) return t;
        r -= t.weight;
    }
    return table[table.length - 1];
}

// ── Coinflip — P(win)=0.5, fairMultiplier=2 → Baseline-EV exakt 1.0 ──────────
function playCoinflip(bet, guessSide, rtp, rng = Math.random) {
    const result = rng() < 0.5 ? 'heads' : 'tails';
    const win = result === guessSide;
    const payout = win ? Math.floor(bet * 2 * (rtp / 100)) : 0;
    return { win, result, payout };
}

// ── Dice — Zahl 1-6 raten, P(win)=1/6, fairMultiplier=6 → Baseline-EV 1.0 ────
function playDice(bet, guessNumber, rtp, rng = Math.random) {
    const roll = 1 + Math.floor(rng() * 6);
    const win = roll === guessNumber;
    const payout = win ? Math.floor(bet * 6 * (rtp / 100)) : 0;
    return { win, roll, payout };
}

// ── Roulette — europäisch, 37 Felder (0-36, Single Zero) ─────────────────────
const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
function rouletteColor(n) {
    if (n === 0) return 'green';
    return ROULETTE_RED.has(n) ? 'red' : 'black';
}

/** field: Zahl als String ("17") für Straight-Up, oder 'red'/'black'/'even'/'odd'/'low'/'high'. */
function playRoulette(bet, field, rtp, rng = Math.random) {
    const pocket = Math.floor(rng() * 37); // 0-36
    const color  = rouletteColor(pocket);
    const f      = String(field).trim().toLowerCase();

    let win = false;
    let fairMultiplier;

    if (/^\d+$/.test(f)) {
        const num = parseInt(f, 10);
        fairMultiplier = 37;       // P=1/37 → Baseline-EV 1.0
        win = num >= 0 && num <= 36 && num === pocket;
    } else {
        fairMultiplier = 37 / 18;  // P=18/37 → Baseline-EV 1.0
        if (f === 'red')        win = color === 'red';
        else if (f === 'black') win = color === 'black';
        else if (f === 'even')  win = pocket !== 0 && pocket % 2 === 0;
        else if (f === 'odd')   win = pocket % 2 === 1;
        else if (f === 'low')   win = pocket >= 1 && pocket <= 18;
        else if (f === 'high')  win = pocket >= 19 && pocket <= 36;
    }

    const payout = win ? Math.floor(bet * fairMultiplier * (rtp / 100)) : 0;
    return { win, pocket, color, payout };
}

// ── Slots ──────────────────────────────────────────────────────────────────
const SLOT_SYMBOLS = [
    { key: 'cherry',  emoji: '🍒', weight: 40, payout3: 3,   payout2: 1 },
    { key: 'lemon',   emoji: '🍋', weight: 30, payout3: 5,   payout2: 1 },
    { key: 'grape',   emoji: '🍇', weight: 15, payout3: 10,  payout2: 1 },
    { key: 'bell',    emoji: '🔔', weight: 10, payout3: 20,  payout2: 1 },
    { key: 'diamond', emoji: '💎', weight: 4,  payout3: 50,  payout2: 1 },
    { key: 'seven',   emoji: '7️⃣', weight: 1,  payout3: 200, payout2: 1 },
];
const SLOT_TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((s, x) => s + x.weight, 0);

// Baseline-EV der Paytable oben (kommt nicht exakt auf 1.0 raus, weil die
// Symbol-Gewichte/Payouts von Hand gewählt sind) — hier einmalig berechnet und
// als Normalisierungsfaktor benutzt, damit die Owner-RTP-Einstellung trotzdem
// exakt eingehalten wird, unabhängig davon wie die Paytable oben aussieht.
const SLOT_BASE_EV = (() => {
    let ev = 0;
    for (const s of SLOT_SYMBOLS) {
        const p = s.weight / SLOT_TOTAL_WEIGHT;
        ev += Math.pow(p, 3) * s.payout3;               // alle 3 Walzen gleich
        ev += 3 * Math.pow(p, 2) * (1 - p) * s.payout2;  // genau 2 von 3 gleich
    }
    return ev;
})();

function playSlots(bet, rtp, rng = Math.random) {
    const reels = [weightedPick(SLOT_SYMBOLS, rng), weightedPick(SLOT_SYMBOLS, rng), weightedPick(SLOT_SYMBOLS, rng)];
    const keys  = reels.map(r => r.key);

    let rawMultiplier = 0;
    if (keys[0] === keys[1] && keys[1] === keys[2]) {
        rawMultiplier = reels[0].payout3;
    } else if (keys[0] === keys[1] || keys[1] === keys[2] || keys[0] === keys[2]) {
        const matched = keys[0] === keys[1] ? reels[0] : reels[1];
        rawMultiplier = matched.payout2;
    }

    const finalMultiplier = (rawMultiplier / SLOT_BASE_EV) * (rtp / 100);
    const payout = rawMultiplier > 0 ? Math.floor(bet * finalMultiplier) : 0;
    return { win: rawMultiplier > 0, reels: reels.map(r => r.emoji), payout };
}

// ── Blackjack — Kartenwerte/Deck sind IMMER unverfälscht zufällig; die RTP-
// Einstellung wirkt nur auf den Auszahlungs-Multiplikator bei Gewinn, nie auf
// die Kartenwahrscheinlichkeiten. Alles andere wäre verdecktes Zinken des
// Decks statt eines fairen Karten-Spiels mit konfigurierbarem Hausvorteil.
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function freshDeck(rng) {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function cardValue(card) {
    if (card.rank === 'A') return 11;
    if (['J', 'Q', 'K'].includes(card.rank)) return 10;
    return parseInt(card.rank, 10);
}

function handValue(cards) {
    let total = cards.reduce((s, c) => s + cardValue(c), 0);
    let aces  = cards.filter(c => c.rank === 'A').length;
    while (total > 21 && aces > 0) { total -= 10; aces--; }
    return total;
}

function isBlackjack(cards) {
    return cards.length === 2 && handValue(cards) === 21;
}

function cardStr(card) { return `${card.rank}${card.suit}`; }
function handStr(cards) { return cards.map(cardStr).join(' '); }

function blackjackDeal(rng = Math.random) {
    const deck   = freshDeck(rng);
    const player = [deck.pop(), deck.pop()];
    const dealer = [deck.pop(), deck.pop()];
    return { deck, player, dealer };
}

function blackjackHit(state) {
    state.player.push(state.deck.pop());
    return handValue(state.player);
}

/** Dealer zieht bis 17+ (steht auf soft 17). Getrennt von der Auflösung, damit
 * bei Split beide Hände gegen DIESELBE Dealer-Hand aufgelöst werden können,
 * statt der Dealer würde pro Hand neu (und unterschiedlich) ziehen. */
function dealerPlay(state) {
    while (handValue(state.dealer) < 17) state.dealer.push(state.deck.pop());
    return state.dealer;
}

/** Löst EINE Spielerhand gegen eine bereits fertig gezogene Dealer-Hand auf.
 * isSplitHand=true unterdrückt den 2.5x-Blackjack-Bonus (Split-Hände zählen als
 * normaler 21, nicht als "natural" Blackjack — Standard-Casino-Regel). */
function resolveHandVsDealer(playerCards, dealerCards, bet, rtp, isSplitHand = false) {
    const playerTotal = handValue(playerCards);
    if (playerTotal > 21) {
        return { outcome: 'bust', payout: 0, dealerTotal: handValue(dealerCards) };
    }

    const dealerTotal = handValue(dealerCards);
    const playerBJ = !isSplitHand && isBlackjack(playerCards);
    const dealerBJ = isBlackjack(dealerCards);

    let outcome, fairMultiplier;
    if (playerBJ && dealerBJ)      { outcome = 'push';    fairMultiplier = 1; }
    else if (playerBJ)             { outcome = 'blackjack'; fairMultiplier = 2.5; }
    else if (dealerBJ)             { outcome = 'lose';    fairMultiplier = 0; }
    else if (dealerTotal > 21)     { outcome = 'win';     fairMultiplier = 2; }
    else if (playerTotal > dealerTotal) { outcome = 'win';     fairMultiplier = 2; }
    else if (playerTotal < dealerTotal) { outcome = 'lose';    fairMultiplier = 0; }
    else                            { outcome = 'push';    fairMultiplier = 1; }

    const scaled = outcome === 'push' ? 1 : fairMultiplier * (rtp / 100);
    const payout = Math.floor(bet * scaled);
    return { outcome, payout, dealerTotal };
}

/** Dealer zieht bis 17+ (steht auf soft 17), löst dann das Ergebnis auf. rtp skaliert nur den Gewinn-Multiplikator. */
function blackjackResolve(state, bet, rtp) {
    const playerTotal = handValue(state.player);
    if (playerTotal > 21) {
        return { outcome: 'bust', payout: 0, dealer: state.dealer, dealerTotal: handValue(state.dealer) };
    }
    dealerPlay(state);
    const result = resolveHandVsDealer(state.player, state.dealer, bet, rtp);
    return { ...result, dealer: state.dealer };
}

/** True wenn die ersten beiden Karten einer Hand denselben Kartenwert haben (Split-Voraussetzung). */
function canSplit(cards) {
    return cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
}

module.exports = {
    playCoinflip, playDice, playRoulette, playSlots, rouletteColor,
    blackjackDeal, blackjackHit, blackjackResolve, dealerPlay, resolveHandVsDealer, canSplit,
    handValue, isBlackjack, cardStr, handStr,
    SLOT_SYMBOLS,
};
