'use strict';

// Plex.tv OAuth-PIN-Flow — PIN creation only. Polling for confirmation and the final
// user-info fetch happen on the PHP web page (/plex/discord-link), which finalizes
// the link and writes the account row directly — no Node round-trip needed for that
// part, since that page already has to make its own outbound HTTP calls anyway.

const PLEX_TV = 'https://plex.tv/api/v2';

async function createPin(bh, clientIdentifier) {
    const resp = await bh.http.fetch(`${PLEX_TV}/pins`, {
        method:  'POST',
        headers: {
            'Accept':                     'application/json',
            'Content-Type':                'application/x-www-form-urlencoded',
            'X-Plex-Client-Identifier':     clientIdentifier,
            'X-Plex-Product':               'BotHub',
        },
        body: 'strong=true',
    });
    if (!resp.ok) throw new Error(`Plex PIN creation failed (HTTP ${resp.status})`);
    const data = await resp.json();
    return { id: data.id, code: data.code };
}

module.exports = { createPin };
