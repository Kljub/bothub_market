'use strict';

const CIRCUIT_TTL_SEC  = 30;
const REQUEST_TIMEOUT  = 8000;

function circuitKey(baseUrl) {
    return `plex_down:${baseUrl}`;
}

// Generic Plex API request with typed errors + a short Redis-backed circuit breaker
// so a dead server doesn't make every command wait out a full timeout individually.
async function plexApiRequest(bh, method, urlPath, { token, baseUrl, query } = {}) {
    if (!baseUrl) return { ok: false, error: 'network_error', status: null, data: null };

    const down = await bh.cache.get(circuitKey(baseUrl)).catch(() => null);
    if (down) return { ok: false, error: 'network_error', status: null, data: null, circuitOpen: true };

    const url = new URL(urlPath.replace(/^\//, ''), baseUrl.replace(/\/?$/, '/'));
    for (const [k, v] of Object.entries(query ?? {})) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers = { Accept: 'application/json' };
    if (token) headers['X-Plex-Token'] = token;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    let resp;
    try {
        resp = await bh.http.fetch(url.toString(), { method, headers, signal: controller.signal });
    } catch (e) {
        clearTimeout(timer);
        const isTimeout = e?.name === 'AbortError';
        await bh.cache.set(circuitKey(baseUrl), true, { ttl: CIRCUIT_TTL_SEC }).catch(() => {});
        return { ok: false, error: isTimeout ? 'timeout' : 'network_error', status: null, data: null };
    }
    clearTimeout(timer);

    if (resp.status === 401 || resp.status === 403) return { ok: false, error: 'unauthorized', status: resp.status, data: null };
    if (resp.status === 429)                          return { ok: false, error: 'rate_limited', status: resp.status, data: null };
    if (!resp.ok)                                      return { ok: false, error: `http_${resp.status}`, status: resp.status, data: null };

    try {
        const data = await resp.json();
        return { ok: true, error: null, status: resp.status, data };
    } catch (_) {
        return { ok: false, error: 'invalid_json', status: resp.status, data: null };
    }
}

async function getIdentity(bh, baseUrl) {
    return plexApiRequest(bh, 'GET', '/identity', { baseUrl });
}

async function getLibrarySections(bh, { baseUrl, token }) {
    const res = await plexApiRequest(bh, 'GET', '/library/sections', { baseUrl, token });
    if (!res.ok) return res;
    const sections = res.data?.MediaContainer?.Directory ?? [];
    return { ...res, sections: sections.map(s => ({ id: String(s.key), title: s.title, type: s.type })) };
}

async function searchLibrary(bh, { baseUrl, token }, sectionId, query) {
    // Plex hat keinen /library/sections/{id}/search-Endpoint (liefert HTTP 400) — Titel-Filter
    // läuft über /all mit dem title-Query-Param (contains-Match, kein Exact-Match nötig).
    const res = await plexApiRequest(bh, 'GET', `/library/sections/${sectionId}/all`, {
        baseUrl, token, query: { title: query },
    });
    if (!res.ok) return res;
    const items = res.data?.MediaContainer?.Metadata ?? [];
    return { ...res, items: items.map(mapMetadata) };
}

async function getRandomFromLibrary(bh, { baseUrl, token }, sectionId, { excludeRatingKey, genre, unwatchedOnly } = {}) {
    const query = {
        sort:                       'random',
        'X-Plex-Container-Start':    0,
        'X-Plex-Container-Size':     5, // small batch so we can skip the excluded item without a second round-trip
    };
    if (unwatchedOnly) query.unwatched = 1;
    if (genre)         query.genre    = genre;

    const res = await plexApiRequest(bh, 'GET', `/library/sections/${sectionId}/all`, { baseUrl, token, query });
    if (!res.ok) return res;
    const items = (res.data?.MediaContainer?.Metadata ?? []).map(mapMetadata);
    const pick  = items.find(i => i.ratingKey !== excludeRatingKey) ?? items[0] ?? null;
    return { ...res, item: pick };
}

async function getActiveSessions(bh, { baseUrl, token }) {
    const res = await plexApiRequest(bh, 'GET', '/status/sessions', { baseUrl, token });
    if (!res.ok) return res;
    const sessions = res.data?.MediaContainer?.Metadata ?? [];
    return {
        ...res,
        sessions: sessions.map(s => ({
            title:            s.title,
            year:             s.year,
            librarySectionId: String(s.librarySectionID ?? ''),
            user:             s.User?.title ?? null,
            state:            s.Player?.state ?? null,
        })),
    };
}

async function getWatchHistory(bh, { baseUrl, token }, accountId) {
    const res = await plexApiRequest(bh, 'GET', '/status/sessions/history/all', {
        baseUrl, token, query: { accountID: accountId, sort: 'viewedAt:desc', 'X-Plex-Container-Size': 50 },
    });
    if (!res.ok) return res;
    const items = res.data?.MediaContainer?.Metadata ?? [];
    return { ...res, items: items.map(mapMetadata) };
}

function mapMetadata(m) {
    return {
        ratingKey:        m.ratingKey,
        title:            m.title,
        year:             m.year,
        summary:          m.summary,
        thumb:            m.thumb,
        librarySectionId: String(m.librarySectionID ?? ''),
        genres:           (m.Genre ?? []).map(g => g.tag),
        viewCount:        m.viewCount ?? 0,
    };
}

module.exports = {
    plexApiRequest,
    getIdentity,
    getLibrarySections,
    searchLibrary,
    getRandomFromLibrary,
    getActiveSessions,
    getWatchHistory,
};
