'use strict';

// Guild-Allowlist: row presence in {PREFIX}guild_settings = plugin enabled for that
// guild. allowed_library_ids is stored as a JSON column and must be parsed manually
// (bh.database.table() does not auto-serialize/deserialize JSON columns).

async function getGuildSettings(bh, clientId, guildId) {
    const row = await bh.database.table('guild_settings').findOne({ client_id: clientId, guild_id: guildId });
    if (!row) return null;
    return { ...row, allowed_library_ids: parseLibraryIds(row.allowed_library_ids) };
}

async function getAllowedLibraries(bh, clientId, guildId) {
    const settings = await getGuildSettings(bh, clientId, guildId);
    return settings?.allowed_library_ids ?? [];
}

async function getAllowlistedGuilds(bh, clientId) {
    const rows = await bh.database.table('guild_settings').findAll({ client_id: clientId });
    return rows.map(row => ({ ...row, allowed_library_ids: parseLibraryIds(row.allowed_library_ids) }));
}

function parseLibraryIds(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try { return JSON.parse(value); } catch (_) { return []; }
}

module.exports = { getGuildSettings, getAllowedLibraries, getAllowlistedGuilds };
