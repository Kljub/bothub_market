'use strict';

const { getIdentity } = require('./plex-api');

const CHECK_INTERVAL_MS = 60_000;
const CIRCUIT_TTL_SEC   = 30;

function circuitKey(baseUrl) {
    return `plex_down:${baseUrl}`;
}

// Proactively probes each configured bot's Plex server on an interval (using the
// unauthenticated /identity endpoint) so the circuit breaker in plex-api.js clears
// itself as soon as a dead server comes back, instead of only being refreshed by
// the next real command that happens to fail.
function startHealthCheck(bh) {
    bh.scheduler.interval(CHECK_INTERVAL_MS, async () => {
        let rows;
        try {
            rows = await bh.database.table('settings').findAll({});
        } catch (_) {
            return;
        }
        for (const row of rows) {
            if (!row.plex_server_url) continue;
            const res = await getIdentity(bh, row.plex_server_url);
            if (res.ok) {
                await bh.cache.delete(circuitKey(row.plex_server_url)).catch(() => {});
            } else if (res.error === 'timeout' || res.error === 'network_error') {
                await bh.cache.set(circuitKey(row.plex_server_url), true, { ttl: CIRCUIT_TTL_SEC }).catch(() => {});
            }
        }
    }, { key: 'plex_health_check' });
}

module.exports = { startHealthCheck };
