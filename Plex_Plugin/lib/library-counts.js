'use strict';

const { decrypt } = require('./crypto');
const { getLibrarySections, getSectionItemCount } = require('./plex-api');

const POLL_INTERVAL_MS = 15 * 60_000;

// Section-Typen aus Plex' /library/sections: "movie" = Filme, "show" = Serien
// (Episoden zaehlen wir hier bewusst nicht mit, "Serien" meint Anzahl Shows).
async function refreshCounts(bh) {
    let rows;
    try {
        rows = await bh.database.table('settings').findAll({});
    } catch (_) {
        return;
    }

    for (const row of rows) {
        if (!row.plex_server_url || !row.plex_admin_token_enc) continue;
        const conn = { baseUrl: row.plex_server_url, token: decrypt(row.plex_admin_token_enc) };

        const sectionsRes = await getLibrarySections(bh, conn);
        if (!sectionsRes.ok) continue;

        let movies = 0;
        let series = 0;
        for (const section of sectionsRes.sections) {
            const countRes = await getSectionItemCount(bh, conn, section.id);
            if (!countRes.ok) continue;
            if (section.type === 'movie') movies += countRes.count;
            else if (section.type === 'show') series += countRes.count;
        }

        try {
            await bh.database.table('settings').update(
                { cached_movie_count: movies, cached_series_count: series, counts_updated_at: new Date() },
                { client_id: row.client_id }
            );
        } catch (_) {}
    }
}

function startLibraryCountsPoll(bh) {
    bh.scheduler.interval(POLL_INTERVAL_MS, () => refreshCounts(bh), { key: 'plex_library_counts' });
    // Initial fill so a freshly installed stat channel doesn't show '?' for 15 minutes
    refreshCounts(bh).catch(() => {});
}

module.exports = { startLibraryCountsPoll };
