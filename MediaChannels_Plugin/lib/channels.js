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
    if (!_db) throw new Error('[mediachannel-plugin] Could not resolve core db module');
    return _db;
}

async function getRuleForChannel(botId, channelId) {
    const rows = await getDb().query(
        'SELECT id, mode FROM plugin_mediachannel_plugin_channels WHERE bot_id = ? AND channel_id = ? LIMIT 1',
        [botId, channelId]
    );
    return rows[0] ?? null;
}

module.exports = { getRuleForChannel };
