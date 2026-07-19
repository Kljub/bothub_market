'use strict';

const path = require('path');

let _db = null;
function getDb() {
    if (_db) return _db;
    const candidates = [
        path.resolve(__dirname, '../../../core/src/plugin-runtime/db'),
        path.resolve(__dirname, '../../../src/plugin-runtime/db'),
    ];
    for (const c of candidates) { try { _db = require(c); break; } catch (_) {} }
    if (!_db) throw new Error('[soundboard-plugin] Could not resolve core db module');
    return _db;
}

async function resolveBotId(clientId) {
    const rows = await getDb().query('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
    return rows[0]?.id ?? null;
}

async function listSounds(botId) {
    return getDb().query(
        'SELECT id, name, filename, play_count FROM plugin_soundboard_plugin_sounds WHERE bot_id = ? ORDER BY name ASC',
        [botId]
    );
}

async function getSoundByName(botId, name) {
    const rows = await getDb().query(
        'SELECT id, name, filename FROM plugin_soundboard_plugin_sounds WHERE bot_id = ? AND name = ? LIMIT 1',
        [botId, name]
    );
    return rows[0] ?? null;
}

async function incrementPlayCount(id) {
    await getDb().query('UPDATE plugin_soundboard_plugin_sounds SET play_count = play_count + 1 WHERE id = ?', [id]);
}

module.exports = { resolveBotId, listSounds, getSoundByName, incrementPlayCount };
