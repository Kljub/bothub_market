'use strict';

const path = require('path');

// bh.database.table() only reaches plugin-owned, prefixed tables. Command-permission
// checks and client_id→bot_id resolution need the shared BotHub tables (bots,
// bot_module_states) — same pattern as plugins/aichat-plugin/index.js.
let _dbQuery = null;
function getDbQuery() {
    if (_dbQuery) return _dbQuery;
    const candidates = [
        path.resolve(__dirname, '../../../core/src/plugin-runtime/db'),
        path.resolve(__dirname, '../../../src/plugin-runtime/db'),
    ];
    for (const c of candidates) {
        try { _dbQuery = require(c).query; break; } catch (_) {}
    }
    return _dbQuery;
}

module.exports = { getDbQuery };
