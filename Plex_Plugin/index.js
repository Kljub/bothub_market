'use strict';

const crypto = require('crypto');

const { checkCmd }          = require('./lib/permissions');
const { decrypt }           = require('./lib/crypto');
const { getDashboardBaseUrl } = require('./lib/core-config');
const plexApi               = require('./lib/plex-api');
const overseerrApi          = require('./lib/overseerr-api');
const plexOauth              = require('./lib/plex-oauth');
const { getGuildSettings, getAllowedLibraries } = require('./lib/guild-settings');
const { registerWebhooks }  = require('./lib/webhook-handlers');
const { startHealthCheck }  = require('./lib/health-check');

const API_ERROR_MESSAGES = {
    timeout:       '❌ Plex-Server antwortet nicht (Timeout).',
    network_error: '❌ Plex-Server ist aktuell nicht erreichbar.',
    unauthorized:  '❌ Plex ist aktuell nicht korrekt konfiguriert.',
    rate_limited:  '❌ Zu viele Anfragen, bitte kurz warten.',
};

function apiErrorMessage(res) {
    return API_ERROR_MESSAGES[res.error] ?? `❌ Unerwarteter Fehler (${res.error ?? res.status ?? 'unbekannt'}).`;
}

module.exports = async function (bh) {
    // Ohne diesen Wrapper bleibt eine Interaction bei jedem unerwarteten Fehler (z.B. ein
    // DB-Fehler wie ER_DATA_TOO_LONG) nach ctx.defer() für immer im "Bot denkt nach…"-Status
    // hängen, weil nie ein editReply()/reply() folgt. Fängt das für alle Commands einheitlich ab.
    function safeCommand(fn) {
        return async function (ctx) {
            try {
                await fn(ctx);
            } catch (e) {
                bh.logger?.error?.(`[plex] command failed: ${e.message}`);
                const msg = '❌ Ein unerwarteter Fehler ist aufgetreten. Bitte später erneut versuchen.';
                try {
                    if (ctx.interaction.deferred || ctx.interaction.replied) {
                        await ctx.editReply({ content: msg });
                    } else {
                        await ctx.reply({ text: msg, ephemeral: true });
                    }
                } catch (_) {}
            }
        };
    }

    async function getBotSettings(clientId) {
        const row = await bh.database.table('settings').findOne({ client_id: clientId });
        if (!row) return null;
        return {
            baseUrl:         row.plex_server_url || null,
            token:            row.plex_admin_token_enc ? decrypt(row.plex_admin_token_enc) : null,
            overseerrUrl:     row.overseerr_url || null,
            overseerrApiKey:  row.overseerr_api_key_enc ? decrypt(row.overseerr_api_key_enc) : null,
            webhookSecret:    row.webhook_secret,
        };
    }

    async function getLinkedAccount(discordUserId) {
        const row = await bh.database.table('accounts').findOne({ discord_user_id: discordUserId });
        if (!row) return null;
        return { ...row, access_token: row.access_token_enc ? decrypt(row.access_token_enc) : null };
    }

    async function requireBotSettings(ctx) {
        const clientId = ctx.interaction.client.user.id;
        const settings = await getBotSettings(clientId);
        if (!settings?.baseUrl || !settings?.token) {
            await ctx.reply({ text: '❌ Plex ist für diesen Bot noch nicht konfiguriert (Dashboard → Plex).', ephemeral: true });
            return null;
        }
        return { clientId, settings };
    }

    async function requireGuildAllowlisted(ctx, clientId) {
        const guildId = ctx.guild?.id;
        if (!guildId) {
            await ctx.reply({ text: '❌ Dieser Command funktioniert nur auf einem Server.', ephemeral: true });
            return null;
        }
        const guildSettings = await getGuildSettings(bh, clientId, guildId);
        if (!guildSettings) {
            await ctx.reply({ text: '❌ Plex ist für diesen Server nicht freigeschaltet.', ephemeral: true });
            return null;
        }
        const allowedLibraries = guildSettings.allowed_library_ids ?? [];
        if (!allowedLibraries.length) {
            await ctx.reply({ text: '❌ Für diesen Server sind noch keine Plex-Bibliotheken freigegeben (Dashboard → Plex).', ephemeral: true });
            return null;
        }
        return { guildId, guildSettings, allowedLibraries };
    }

    // ctx.reply()/ctx.editReply() and raw interaction.update() forward the payload to
    // discord.js untouched (see command-manager.js's wrapInteraction) — so embeds/components
    // here use Discord's raw REST API JSON shape (image as {url}, not a bare string), not
    // discord.js builder classes. Plugins may not import discord.js directly (forbidden
    // module, sandboxed by the plugin loader) — see plugin-loader.js's FORBIDDEN_MODULES.
    function mediaEmbed(item) {
        return {
            title:       `${item.title ?? 'Unbekannt'}${item.year ? ` (${item.year})` : ''}`,
            description: (item.summary ?? '').slice(0, 500) || 'Keine Beschreibung verfügbar.',
        };
    }

    function withPoster(embed, item, plexCfg) {
        if (item.thumb && plexCfg.baseUrl && plexCfg.token) {
            const posterUrl = `${plexCfg.baseUrl.replace(/\/+$/, '')}${item.thumb}?X-Plex-Token=${encodeURIComponent(plexCfg.token)}`;
            embed.image = { url: posterUrl };
        }
        return embed;
    }

    // ── /link ──────────────────────────────────────────────────────────────
    bh.commands.register({
        name: 'link',
        description: 'Verknüpfe deinen Plex-Account mit Discord',
        execute: safeCommand(async (ctx) => {
            if (!await checkCmd(ctx, 'plex:link')) return;
            const clientId = ctx.interaction.client.user.id;
            const gate = await requireGuildAllowlisted(ctx, clientId);
            if (!gate) return;

            await ctx.defer(true);

            const clientIdentifier = `bothub-plex-${clientId}`;
            let pin;
            try {
                pin = await plexOauth.createPin(bh, clientIdentifier);
            } catch (e) {
                await ctx.editReply({ content: '❌ Plex-Verknüpfung konnte nicht gestartet werden. Bitte später erneut versuchen.' });
                return;
            }

            const token = crypto.randomBytes(24).toString('hex');
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
                .toISOString().slice(0, 19).replace('T', ' ');

            // Ohne try/catch bliebe die Interaction bei jedem Fehler hier für immer im
            // "Bot denkt nach…"-Status hängen (defer(true) ist schon quittiert, aber nie
            // editReply()'t) — z.B. passiert bei einem DB-Fehler wie ER_DATA_TOO_LONG.
            try {
                await bh.database.table('link_tokens').insert({
                    token,
                    discord_user_id:   ctx.user.id,
                    guild_id:          gate.guildId,
                    plex_pin_id:       pin.id,
                    plex_pin_code:     pin.code,
                    client_identifier: clientIdentifier,
                    expires_at:        expiresAt,
                    used:              0,
                });

                const base = await getDashboardBaseUrl();
                await ctx.editReply({
                    content: `🔗 Klicke hier, um deinen Plex-Account zu verknüpfen (15 Minuten gültig):\n${base}/plex/discord-link?token=${token}`,
                });
            } catch (e) {
                bh.logger?.error?.(`[plex] /link failed: ${e.message}`);
                await ctx.editReply({ content: '❌ Plex-Verknüpfung konnte nicht gestartet werden. Bitte später erneut versuchen.' }).catch(() => {});
            }
        }),
    });

    // ── /unlink ────────────────────────────────────────────────────────────
    bh.commands.register({
        name: 'unlink',
        description: 'Entferne die Verknüpfung deines Plex-Accounts',
        execute: safeCommand(async (ctx) => {
            if (!await checkCmd(ctx, 'plex:unlink')) return;
            const guildId = ctx.guild?.id;
            if (!guildId) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }

            const clientId = ctx.interaction.client.user.id;
            const guildSettings = await getGuildSettings(bh, clientId, guildId);

            await bh.database.table('accounts').delete({ discord_user_id: ctx.user.id });

            if (guildSettings?.role_id) {
                try { await bh.roles.remove(guildId, ctx.user.id, guildSettings.role_id); } catch (_) {}
            }
            await ctx.reply({ text: '✅ Dein Plex-Account wurde entknüpft.', ephemeral: true });
        }),
    });

    // ── /plex-status ──────────────────────────────────────────────────────
    bh.commands.register({
        name: 'plex-status',
        description: 'Zeigt den Status des Plex-Servers',
        options: [
            {
                name: 'sichtbarkeit',
                description: 'Wer die Antwort sehen kann (Standard: Hidden)',
                type: 'string',
                required: false,
                choices: [
                    { name: 'Hidden (nur für dich)',  value: 'hidden' },
                    { name: 'Public (für alle sichtbar)', value: 'public' },
                ],
            },
        ],
        execute: safeCommand(async (ctx) => {
            if (!await checkCmd(ctx, 'plex:plex-status')) return;
            const botSettings = await requireBotSettings(ctx);
            if (!botSettings) return;
            const gate = await requireGuildAllowlisted(ctx, botSettings.clientId);
            if (!gate) return;

            const visibility = ctx.options.getString('sichtbarkeit') || 'hidden';
            const ephemeral  = visibility !== 'public';

            await ctx.defer(ephemeral);
            const cfg = { baseUrl: botSettings.settings.baseUrl, token: botSettings.settings.token };

            const idRes = await plexApi.getIdentity(bh, cfg.baseUrl);
            const online = idRes.ok;
            const sessionsRes = online ? await plexApi.getActiveSessions(bh, cfg) : null;
            const visibleSessions = sessionsRes?.ok
                ? sessionsRes.sessions.filter(s => gate.allowedLibraries.includes(s.librarySectionId))
                : [];
            const account = await getLinkedAccount(ctx.user.id);

            const embed = {
                title: '📊 Plex-Status',
                color: online ? 0x2ecc71 : 0xe74c3c,
                fields: [
                    { name: 'Verbindung', value: online ? '✅ Online' : `❌ Offline (${apiErrorMessage(idRes)})`, inline: true },
                    { name: 'Deine Verknüpfung', value: account ? `✅ Verknüpft als ${account.plex_username}` : '❌ Nicht verknüpft (`/link` nutzen)', inline: true },
                ],
            };
            if (online) {
                embed.fields.push(
                    { name: 'Server-Version',            value: idRes.data?.MediaContainer?.version ?? 'Unbekannt', inline: true },
                    { name: 'Aktive Wiedergaben',         value: String(visibleSessions.length), inline: true },
                    { name: 'Freigegebene Bibliotheken',  value: String(gate.allowedLibraries.length), inline: true },
                    { name: 'Overseerr',                  value: botSettings.settings.overseerrUrl ? '✅ Konfiguriert' : '➖ Nicht konfiguriert', inline: true },
                );
            }
            await ctx.editReply({ embeds: [embed] });
        }),
    });

    // ── /plex-nowplaying ───────────────────────────────────────────────────
    bh.commands.register({
        name: 'plex-nowplaying',
        description: 'Zeigt aktive Plex-Wiedergaben',
        execute: safeCommand(async (ctx) => {
            if (!await checkCmd(ctx, 'plex:plex-nowplaying')) return;
            const botSettings = await requireBotSettings(ctx);
            if (!botSettings) return;
            const gate = await requireGuildAllowlisted(ctx, botSettings.clientId);
            if (!gate) return;

            await ctx.defer();
            const cfg = { baseUrl: botSettings.settings.baseUrl, token: botSettings.settings.token };
            const res = await plexApi.getActiveSessions(bh, cfg);
            if (!res.ok) { await ctx.editReply({ content: apiErrorMessage(res) }); return; }

            const visible = res.sessions.filter(s => gate.allowedLibraries.includes(s.librarySectionId));
            if (!visible.length) {
                await ctx.editReply({ content: '📺 Aktuell läuft nichts.' });
                return;
            }
            const lines = visible.map(s => `**${s.title}**${s.year ? ` (${s.year})` : ''} — ${s.user ?? 'Unbekannt'} (${s.state ?? 'unknown'})`);
            await ctx.editReply({ content: lines.join('\n') });
        }),
    });

    // ── /plex-search ───────────────────────────────────────────────────────
    bh.commands.register({
        name: 'plex-search',
        description: 'Durchsuche die Plex-Bibliothek',
        options: [{ name: 'titel', description: 'Titel des Films/der Serie', type: 'string', required: true }],
        execute: safeCommand(async (ctx) => {
            if (!await checkCmd(ctx, 'plex:plex-search')) return;
            const botSettings = await requireBotSettings(ctx);
            if (!botSettings) return;
            const gate = await requireGuildAllowlisted(ctx, botSettings.clientId);
            if (!gate) return;

            await ctx.defer();
            const cfg = { baseUrl: botSettings.settings.baseUrl, token: botSettings.settings.token };
            const query = ctx.options.getString('titel', true);

            const results = [];
            for (const sectionId of gate.allowedLibraries) {
                const res = await plexApi.searchLibrary(bh, cfg, sectionId, query);
                if (res.ok) results.push(...res.items);
            }

            if (!results.length) {
                await ctx.editReply({ content: `🔍 Keine Treffer für "${query}" in den freigegebenen Bibliotheken.` });
                return;
            }
            const top = results[0];
            const embed = withPoster(mediaEmbed(top), top, cfg);
            await ctx.editReply({ embeds: [embed] });
        }),
    });

    // ── /plex-random ───────────────────────────────────────────────────────
    async function pickRandom(cfg, allowedLibraries, { library, genre, unwatchedOnly, excludeRatingKey } = {}) {
        const sectionId = library && allowedLibraries.includes(library)
            ? library
            : allowedLibraries[Math.floor(Math.random() * allowedLibraries.length)];
        const res = await plexApi.getRandomFromLibrary(bh, cfg, sectionId, { excludeRatingKey, genre, unwatchedOnly });
        return { ...res, sectionId };
    }

    function rerollRow(interactionId) {
        return {
            type: 1,
            components: [
                { type: 2, style: 2, label: '🎲 Nochmal', custom_id: `plex_random_reroll:${interactionId}` },
            ],
        };
    }

    bh.commands.register({
        name: 'plex-random',
        description: 'Zufälliger Vorschlag aus der Plex-Bibliothek',
        options: [
            { name: 'library', description: 'Bibliothek (leer = alle freigegebenen)', type: 'string', required: false, autocomplete: true },
            { name: 'genre', description: 'Genre-Filter', type: 'string', required: false },
            { name: 'unwatched_only', description: 'Nur ungesehene Titel', type: 'boolean', required: false },
        ],
        async autocomplete(ctx) {
            const clientId = ctx.interaction.client.user.id;
            const guildId  = ctx.guild?.id;
            if (!guildId) return [];
            const allowed = await getAllowedLibraries(bh, clientId, guildId);
            if (!allowed.length) return [];
            const botSettings = await getBotSettings(clientId);
            if (!botSettings?.baseUrl || !botSettings?.token) return [];
            const res = await plexApi.getLibrarySections(bh, { baseUrl: botSettings.baseUrl, token: botSettings.token });
            if (!res.ok) return [];
            const focusedValue = String(ctx.focused?.value ?? '').toLowerCase();
            return res.sections
                .filter(s => allowed.includes(s.id))
                .filter(s => s.title.toLowerCase().includes(focusedValue))
                .slice(0, 25)
                .map(s => ({ name: s.title, value: s.id }));
        },
        execute: safeCommand(async (ctx) => {
            if (!await checkCmd(ctx, 'plex:plex-random')) return;
            const botSettings = await requireBotSettings(ctx);
            if (!botSettings) return;
            const gate = await requireGuildAllowlisted(ctx, botSettings.clientId);
            if (!gate) return;

            await ctx.defer();
            const cfg = { baseUrl: botSettings.settings.baseUrl, token: botSettings.settings.token };
            const library       = ctx.options.getString('library', false);
            const genre          = ctx.options.getString('genre', false);
            const unwatchedOnly  = ctx.options.getBoolean('unwatched_only', false) ?? false;

            const res = await pickRandom(cfg, gate.allowedLibraries, { library, genre, unwatchedOnly });
            if (!res.ok) { await ctx.editReply({ content: apiErrorMessage(res) }); return; }
            if (!res.item) { await ctx.editReply({ content: '🎲 Keine Treffer gefunden.' }); return; }

            const interactionId = ctx.interaction.id;
            await bh.cache.set(`random:${interactionId}`, {
                library, genre, unwatchedOnly, lastRatingKey: res.item.ratingKey,
            }, { ttl: 600 });

            const embed = withPoster(mediaEmbed(res.item), res.item, cfg);
            await ctx.editReply({ embeds: [embed], components: [rerollRow(interactionId)] });
        }),
    });

    bh.events.on('button.clicked', async (payload) => {
        if (!payload.customId?.startsWith('plex_random_reroll:')) return;
        const interactionId = payload.customId.split(':')[1];
        const interaction    = payload._interaction;
        const guildId        = payload.guild?.id;
        if (!guildId) return;

        const clientId = interaction.client.user.id;
        const state = await bh.cache.get(`random:${interactionId}`);
        const gate  = await getAllowedLibraries(bh, clientId, guildId);
        if (!gate.length) return;

        const botSettings = await getBotSettings(clientId);
        if (!botSettings?.baseUrl || !botSettings?.token) return;
        const cfg = { baseUrl: botSettings.baseUrl, token: botSettings.token };

        const res = await pickRandom(cfg, gate, {
            library:          state?.library ?? null,
            genre:            state?.genre ?? null,
            unwatchedOnly:    state?.unwatchedOnly ?? false,
            excludeRatingKey: state?.lastRatingKey ?? null,
        });
        if (!res.ok || !res.item) {
            try { await interaction.update({ content: '🎲 Keine weiteren Treffer gefunden.', embeds: [], components: [] }); } catch (_) {}
            return;
        }

        await bh.cache.set(`random:${interactionId}`, {
            library: state?.library ?? null, genre: state?.genre ?? null,
            unwatchedOnly: state?.unwatchedOnly ?? false, lastRatingKey: res.item.ratingKey,
        }, { ttl: 600 });

        const embed = withPoster(mediaEmbed(res.item), res.item, cfg);
        try {
            await interaction.update({ embeds: [embed], components: [rerollRow(interactionId)] });
        } catch (e) {
            bh.logger?.error?.(`[plex] Reroll update failed: ${e.message}`);
        }
    });

    // ── /plex-recommend ────────────────────────────────────────────────────
    bh.commands.register({
        name: 'plex-recommend',
        description: 'Empfehlung basierend auf deiner Watch-History',
        execute: safeCommand(async (ctx) => {
            if (!await checkCmd(ctx, 'plex:plex-recommend')) return;
            const account = await getLinkedAccount(ctx.user.id);
            if (!account) { await ctx.reply({ text: '❌ Bitte nutze zuerst `/link`.', ephemeral: true }); return; }

            const botSettings = await requireBotSettings(ctx);
            if (!botSettings) return;
            const gate = await requireGuildAllowlisted(ctx, botSettings.clientId);
            if (!gate) return;

            await ctx.defer();
            const cfg = { baseUrl: botSettings.settings.baseUrl, token: botSettings.settings.token };

            const historyRes = await plexApi.getWatchHistory(bh, cfg, account.plex_uuid);
            if (!historyRes.ok) { await ctx.editReply({ content: apiErrorMessage(historyRes) }); return; }

            const genreCounts = {};
            for (const item of historyRes.items) {
                for (const g of item.genres) genreCounts[g] = (genreCounts[g] ?? 0) + 1;
            }
            const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

            const res = await pickRandom(cfg, gate.allowedLibraries, { genre: topGenre, unwatchedOnly: true });
            if (!res.ok) { await ctx.editReply({ content: apiErrorMessage(res) }); return; }
            if (!res.item) { await ctx.editReply({ content: '🎬 Keine Empfehlung gefunden.' }); return; }

            const embed = withPoster(mediaEmbed(res.item), res.item, cfg);
            await ctx.editReply({ embeds: [embed] });
        }),
    });

    // ── /plex-request ──────────────────────────────────────────────────────
    bh.commands.register({
        name: 'plex-request',
        description: 'Fordere einen Film/eine Serie über Overseerr an',
        options: [{ name: 'titel', description: 'Titel des Films/der Serie', type: 'string', required: true }],
        execute: safeCommand(async (ctx) => {
            if (!await checkCmd(ctx, 'plex:plex-request')) return;
            const account = await getLinkedAccount(ctx.user.id);
            if (!account) { await ctx.reply({ text: '❌ Bitte nutze zuerst `/link`.', ephemeral: true }); return; }

            const botSettings = await requireBotSettings(ctx);
            if (!botSettings) return;
            if (!botSettings.settings.overseerrUrl || !botSettings.settings.overseerrApiKey) {
                await ctx.reply({ text: '❌ Overseerr ist für diesen Bot nicht konfiguriert.', ephemeral: true });
                return;
            }
            const guildId = ctx.guild?.id;
            if (!guildId) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }

            await ctx.defer();
            const overseerrCfg = { baseUrl: botSettings.settings.overseerrUrl, apiKey: botSettings.settings.overseerrApiKey };
            const query = ctx.options.getString('titel', true);

            const searchRes = await overseerrApi.search(bh, overseerrCfg, query);
            if (!searchRes.ok) { await ctx.editReply({ content: apiErrorMessage(searchRes) }); return; }
            const match = searchRes.results[0];
            if (!match) { await ctx.editReply({ content: `🔍 Kein Treffer für "${query}" bei Overseerr.` }); return; }

            const usersRes = await overseerrApi.getUsers(bh, overseerrCfg);
            const matchedUser = usersRes.ok
                ? usersRes.users.find(u => u.plexId === account.plex_uuid || (u.email && u.email === account.plex_email))
                : null;

            const reqRes = await overseerrApi.createRequest(bh, overseerrCfg, {
                mediaType:   match.mediaType,
                mediaId:     match.mediaId,
                userId:      matchedUser?.id ?? null,
                discordNote: matchedUser ? undefined : `Angefragt von Discord-User ${ctx.user.username} (${ctx.user.id})`,
            });
            if (!reqRes.ok) { await ctx.editReply({ content: apiErrorMessage(reqRes) }); return; }

            await bh.database.table('overseerr_requests').insert({
                overseerr_request_id: reqRes.data?.id ?? 0,
                discord_user_id:       ctx.user.id,
                guild_id:               guildId,
            });

            await ctx.editReply({ content: `✅ Anfrage für **${match.title}** wurde bei Overseerr erstellt.` });
        }),
    });

    // ── Interner Endpoint: Rollenvergabe nach abgeschlossenem /link-Flow ───
    // Wird vom PHP-Queue-Worker aufgerufen (bh_plex_link_complete), nachdem die
    // Plex-Web-Seite den OAuth-Flow erfolgreich abgeschlossen hat.
    bh.http.post('/link-complete', async (req, res) => {
        const { discord_user_id, guild_id, role_id } = req.body ?? {};
        if (!discord_user_id || !guild_id || !role_id) {
            return res.status(400).json({ ok: false, error: 'missing_fields' });
        }
        try {
            await bh.roles.add(guild_id, discord_user_id, role_id);
            return res.json({ ok: true });
        } catch (e) {
            return res.status(500).json({ ok: false, error: e.message });
        }
    });

    registerWebhooks(bh, { getBotSettings });
    startHealthCheck(bh);

    bh.plugin.onDisable(() => bh.scheduler.stopAll());
};
