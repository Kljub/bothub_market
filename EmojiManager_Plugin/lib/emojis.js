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
    if (!_db) throw new Error('[emojimanager-plugin] Could not resolve core db module');
    return _db;
}

async function resolveBotId(clientId) {
    const rows = await getDb().query('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
    return rows[0]?.id ?? null;
}

async function listEmojis(botId) {
    return getDb().query(
        'SELECT id, name, filename, use_count FROM plugin_emojimanager_plugin_emojis WHERE bot_id = ? ORDER BY name ASC',
        [botId]
    );
}

async function getEmojiByName(botId, name) {
    const rows = await getDb().query(
        'SELECT id, name, filename FROM plugin_emojimanager_plugin_emojis WHERE bot_id = ? AND name = ? LIMIT 1',
        [botId, name]
    );
    return rows[0] ?? null;
}

async function incrementUseCount(id) {
    await getDb().query('UPDATE plugin_emojimanager_plugin_emojis SET use_count = use_count + 1 WHERE id = ?', [id]);
}

module.exports = { resolveBotId, listEmojis, getEmojiByName, incrementUseCount };
