'use strict';

// AniList GraphQL API — öffentlich, kein API-Key nötig. Single-Endpoint für alles.
const ENDPOINT = 'https://graphql.anilist.co';

const SEARCH_QUERY = `
query ($search: String, $type: MediaType) {
  Media(search: $search, type: $type, sort: SEARCH_MATCH) {
    id
    title { romaji english native }
    description(asHtml: false)
    coverImage { large }
    averageScore
    status
    episodes
    chapters
    volumes
    genres
    format
    startDate { year month day }
    siteUrl
  }
}`;

const AIRING_QUERY = `
query ($id: Int) {
  Media(id: $id) {
    id
    title { romaji }
    nextAiringEpisode { episode airingAt }
  }
}`;

async function gql(bh, query, variables) {
    const res = await bh.http.fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
        if (res.status === 404) return null; // AniList gibt 404 bei "kein Treffer"
        throw new Error(`AniList-API Fehler (HTTP ${res.status})`);
    }
    const data = await res.json();
    if (data.errors?.length) {
        const notFound = data.errors.some(e => (e.message || '').toLowerCase().includes('not found'));
        if (notFound) return null;
        throw new Error(data.errors[0]?.message || 'AniList-API Fehler');
    }
    return data.data?.Media ?? null;
}

async function searchMedia(bh, query, type) {
    return gql(bh, SEARCH_QUERY, { search: query, type });
}

async function getAiringInfo(bh, anilistId) {
    return gql(bh, AIRING_QUERY, { id: anilistId });
}

const STATUS_LABELS = {
    FINISHED: 'Abgeschlossen', RELEASING: 'Läuft', NOT_YET_RELEASED: 'Noch nicht veröffentlicht',
    CANCELLED: 'Abgebrochen', HIATUS: 'Pausiert',
};

function stripHtml(text) {
    return (text || '').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function buildMediaEmbed(media, type) {
    const title = media.title?.english || media.title?.romaji || media.title?.native || 'Unbekannt';
    const desc  = stripHtml(media.description);
    const descTrimmed = desc.length > 500 ? desc.slice(0, 500) + '…' : desc;

    const fields = [];
    if (media.format) fields.push({ name: 'Format', value: media.format, inline: true });
    fields.push({ name: 'Status', value: STATUS_LABELS[media.status] || media.status || 'Unbekannt', inline: true });
    if (media.averageScore != null) fields.push({ name: 'Bewertung', value: `${media.averageScore}/100`, inline: true });
    if (type === 'ANIME' && media.episodes != null) fields.push({ name: 'Episoden', value: String(media.episodes), inline: true });
    if (type === 'MANGA') {
        if (media.chapters != null) fields.push({ name: 'Kapitel', value: String(media.chapters), inline: true });
        if (media.volumes  != null) fields.push({ name: 'Bände',   value: String(media.volumes),  inline: true });
    }
    if (media.genres?.length) fields.push({ name: 'Genres', value: media.genres.slice(0, 5).join(', '), inline: false });

    return {
        color: type === 'ANIME' ? 0x02a9ff : 0xff6740,
        title,
        url: media.siteUrl,
        description: descTrimmed || 'Keine Beschreibung verfügbar.',
        image: media.coverImage?.large || undefined,
        fields,
        footer: { text: 'AniList' },
    };
}

module.exports = { searchMedia, getAiringInfo, buildMediaEmbed, STATUS_LABELS };
