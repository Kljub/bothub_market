'use strict';

const { getAllowlistedGuilds } = require('./guild-settings');

// Registers the two inbound webhook handlers. Both are only reachable via the PHP
// relay (plugins/plex/webhooks/*-receiver.php) — Core itself is not reachable from
// the public internet, and the relay validates the per-bot webhook secret (URL path
// segment) before forwarding here. The media relay wraps the payload as
// `{ clientId, plex: <original Plex payload> }` since a media event's guild
// fan-out needs to know which bot it belongs to (Plex has no such concept itself).
// The Overseerr relay forwards the payload unwrapped: overseerr_requests is looked
// up by the globally-unique request_id, not scoped per bot, so no clientId is needed.
function registerWebhooks(bh, { getBotSettings }) {
    bh.webhooks.register('media', (payload) => handleMediaWebhook(bh, { getBotSettings }, payload), {
        verify: async () => true, // secret already checked by the PHP relay layer
    });

    bh.webhooks.register('overseerr', (payload) => handleOverseerrWebhook(bh, payload), {
        verify: async () => true,
    });
}

async function handleMediaWebhook(bh, { getBotSettings }, payload) {
    const clientId  = payload?.clientId;
    const plexEvent = payload?.plex;
    if (!clientId || !plexEvent?.event) return;

    const guilds = await getAllowlistedGuilds(bh, clientId);
    if (!guilds.length) return;

    if (plexEvent.event === 'library.new') {
        const sectionId = String(plexEvent.Metadata?.librarySectionID ?? '');
        // bh.messaging.send() converts plain embed objects internally (see sdk-factory.js's
        // buildDiscordEmbed) — plugins may not import discord.js directly (forbidden module).
        const embed = {
            title:       `🆕 ${plexEvent.Metadata?.title ?? 'Neuer Inhalt'}`,
            description: plexEvent.Metadata?.summary?.slice(0, 500) ?? '',
        };

        for (const guild of guilds) {
            if (!guild.allowed_library_ids.includes(sectionId)) continue;
            if (!guild.new_content_channel_id) continue;
            try {
                await bh.messaging.send(guild.new_content_channel_id, { embeds: [embed] });
            } catch (e) {
                bh.logger?.error?.(`[plex] library.new post failed (guild ${guild.guild_id}): ${e.message}`);
            }
        }
        return;
    }

    if (plexEvent.event === 'media.play') {
        // Best-effort: Plex's local Account.title (server-scoped username) is matched
        // against the plex_username stored from the plex.tv OAuth flow at /link time.
        // These are usually the same string, but this is a heuristic — confirm against
        // a real Plex webhook payload during testing (see plan Correction 14).
        const sectionId    = String(plexEvent.Metadata?.librarySectionID ?? '');
        const plexUsername = plexEvent.Account?.title;
        if (!plexUsername) return;

        const account = await bh.database.table('accounts').findOne({ plex_username: plexUsername });
        if (!account?.nowplaying_optin) return;

        const embed = {
            title:       `▶️ ${plexEvent.Metadata?.title ?? 'Wiedergabe'}`,
            description: `${plexUsername} schaut gerade${plexEvent.Metadata?.year ? ` (${plexEvent.Metadata.year})` : ''}`,
        };

        for (const guild of guilds) {
            if (!guild.allowed_library_ids.includes(sectionId)) continue;
            if (!guild.live_status_channel_id) continue;
            try {
                await bh.messaging.send(guild.live_status_channel_id, { embeds: [embed] });
            } catch (e) {
                bh.logger?.error?.(`[plex] media.play post failed (guild ${guild.guild_id}): ${e.message}`);
            }
        }
    }
}

async function handleOverseerrWebhook(bh, payload) {
    // Overseerr's webhook agent field names (notification_type, request.request_id) —
    // confirm against a live Overseerr instance during testing (plan Correction 15).
    const notificationType = payload?.notification_type;
    const requestId         = payload?.request?.request_id;
    if (!notificationType || !requestId) return;

    const messages = {
        MEDIA_APPROVED:  '✅ Deine Plex-Anfrage wurde genehmigt.',
        MEDIA_AVAILABLE: '🎬 Deine Plex-Anfrage ist jetzt verfügbar!',
        MEDIA_DECLINED:  '❌ Deine Plex-Anfrage wurde abgelehnt.',
    };
    const text = messages[notificationType];
    if (!text) return;

    const mapping = await bh.database.table('overseerr_requests').findOne({ overseerr_request_id: requestId });
    if (!mapping) return;

    try {
        await bh.messaging.dm(mapping.discord_user_id, { content: text });
    } catch (e) {
        bh.logger?.error?.(`[plex] Overseerr DM failed (user ${mapping.discord_user_id}): ${e.message}`);
    }
}

module.exports = { registerWebhooks };
