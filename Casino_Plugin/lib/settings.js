'use strict';

const path = require('path');

const PREFIX = 'plugin_casino_plugin_';
const T_SETTINGS = `\`${PREFIX}game_settings\``;

const GAMES = ['coinflip', 'dice', 'slots', 'roulette', 'blackjack'];

const DEFAULTS = {
    coinflip:  { rtp: 97.00, min_bet: 10, max_bet: 1000 },
    dice:      { rtp: 95.00, min_bet: 10, max_bet: 1000 },
    slots:     { rtp: 94.00, min_bet: 10, max_bet: 500 },
    roulette:  { rtp: 95.00, min_bet: 10, max_bet: 500 },
    blackjack: { rtp: 98.00, min_bet: 10, max_bet: 1000 },
};

// ── Runtime DB access (works both bare-metal and inside the core container) ───
let _db = null;
function getDb() {
    if (_db) return _db;
    const candidates = [
        path.resolve(__dirname, '../../../core/src/plugin-runtime/db'),
        path.resolve(__dirname, '../../../src/plugin-runtime/db'),
    ];
    for (const c of candidates) {
        try { _db = require(c); break; } catch (_) {}
    }
    if (!_db) throw new Error('[casino-plugin] Could not resolve core db module');
    return _db;
}

async function resolveBotId(clientId) {
    const { query } = getDb();
    const rows = await query('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
    return rows[0]?.id ?? null;
}

async function getGameSettings(botId, gameKey) {
    const { query } = getDb();
    const rows = await query(`SELECT * FROM ${T_SETTINGS} WHERE bot_id = ? AND game_key = ? LIMIT 1`, [botId, gameKey]);
    if (rows[0]) {
        // mysql2 deserialisiert JSON-Spalten je nach Treiber-Konfiguration bereits
        // automatisch zu Objekten/Arrays — nur parsen, wenn es wirklich noch ein
        // String ist (sonst wirft JSON.parse([]) "Unexpected end of JSON input").
        const raw = rows[0].allowed_currencies;
        return {
            ...rows[0],
            rtp: Number(rows[0].rtp),
            allowed_currencies: typeof raw === 'string' ? JSON.parse(raw) : (raw ?? null),
        };
    }
    const def = DEFAULTS[gameKey] ?? { rtp: 95.00, min_bet: 10, max_bet: 1000 };
    return { bot_id: botId, game_key: gameKey, enabled: 1, ...def, allowed_currencies: null };
}

async function getAllGameSettings(botId) {
    const out = {};
    for (const key of GAMES) out[key] = await getGameSettings(botId, key);
    return out;
}

async function saveGameSettings(botId, gameKey, data) {
    const { query } = getDb();
    await query(
        `INSERT INTO ${T_SETTINGS} (bot_id, game_key, enabled, rtp, min_bet, max_bet, allowed_currencies)
         VALUES (?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), rtp = VALUES(rtp), min_bet = VALUES(min_bet),
            max_bet = VALUES(max_bet), allowed_currencies = VALUES(allowed_currencies)`,
        [
            botId, gameKey, data.enabled ? 1 : 0,
            Math.max(10, Math.min(100, Number(data.rtp) || 95)),
            Math.max(1, parseInt(data.min_bet, 10) || 10),
            Math.max(1, parseInt(data.max_bet, 10) || 1000),
            data.allowed_currencies ? JSON.stringify(data.allowed_currencies) : null,
        ]
    );
}

/** Ist eine bestimmte Currency für dieses Spiel erlaubt? null/leer = alle erlaubt (kein Filter gesetzt). */
function currencyAllowed(settings, currencyKey) {
    if (!settings.allowed_currencies || !settings.allowed_currencies.length) return true;
    return settings.allowed_currencies.includes(currencyKey);
}

module.exports = {
    GAMES, DEFAULTS,
    resolveBotId, getGameSettings, getAllGameSettings, saveGameSettings, currencyAllowed,
};
