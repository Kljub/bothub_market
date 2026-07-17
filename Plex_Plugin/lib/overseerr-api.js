'use strict';

// Same typed-error shape as plex-api.js. Overseerr's exact response field names
// (esp. /user's Plex-account fields) should be re-confirmed against a live instance
// before shipping — this follows Overseerr's documented API shape but hasn't been
// tested against a real server yet.

const CIRCUIT_TTL_SEC = 30;
const REQUEST_TIMEOUT  = 8000;

function circuitKey(baseUrl) {
    return `overseerr_down:${baseUrl}`;
}

async function overseerrApiRequest(bh, method, urlPath, { apiKey, baseUrl, query, body } = {}) {
    if (!baseUrl) return { ok: false, error: 'network_error', status: null, data: null };

    const down = await bh.cache.get(circuitKey(baseUrl)).catch(() => null);
    if (down) return { ok: false, error: 'network_error', status: null, data: null, circuitOpen: true };

    const url = new URL(`api/v1/${urlPath.replace(/^\//, '')}`, baseUrl.replace(/\/?$/, '/'));
    for (const [k, v] of Object.entries(query ?? {})) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers = { Accept: 'application/json' };
    if (apiKey) headers['X-Api-Key'] = apiKey;
    if (body)   headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    let resp;
    try {
        resp = await bh.http.fetch(url.toString(), {
            method,
            headers,
            signal: controller.signal,
            body:   body ? JSON.stringify(body) : undefined,
        });
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
        const data = resp.status === 204 ? {} : await resp.json();
        return { ok: true, error: null, status: resp.status, data };
    } catch (_) {
        return { ok: false, error: 'invalid_json', status: resp.status, data: null };
    }
}

async function search(bh, cfg, query) {
    const res = await overseerrApiRequest(bh, 'GET', '/search', { ...cfg, query: { query } });
    if (!res.ok) return res;
    const results = (res.data?.results ?? []).map(r => ({
        mediaId:   r.id,
        mediaType: r.mediaType,
        title:     r.title ?? r.name,
        overview:  r.overview,
        posterPath: r.posterPath,
        status:    r.mediaInfo?.status ?? null,
    }));
    return { ...res, results };
}

async function getUsers(bh, cfg) {
    const res = await overseerrApiRequest(bh, 'GET', '/user', { ...cfg, query: { take: 100 } });
    if (!res.ok) return res;
    const users = (res.data?.results ?? []).map(u => ({
        id:            u.id,
        plexId:        u.plexId != null ? String(u.plexId) : null,
        email:         u.email,
        plexUsername:  u.plexUsername ?? u.username ?? null,
    }));
    return { ...res, users };
}

async function createRequest(bh, cfg, { mediaType, mediaId, seasons, userId, discordNote }) {
    const body = { mediaType, mediaId };
    if (seasons) body.seasons = seasons;
    if (userId)  body.userId  = userId;
    if (!userId && discordNote) body.note = discordNote;
    return overseerrApiRequest(bh, 'POST', '/request', { ...cfg, body });
}

module.exports = { overseerrApiRequest, search, getUsers, createRequest };
