'use strict';

const anilist  = require('./lib/anilist');
const tracking = require('./lib/tracking');

const CHECK_INTERVAL_MS = 15 * 60_000; // alle 15 Minuten Airing-Status prüfen

module.exports = async function (bh) {
    bh.logger.info('AniSearch Plugin geladen');

    async function searchAndReply(ctx, type, label) {
        const query = ctx.options.getString('titel', true);
        await ctx.defer(false);
        try {
            const media = await anilist.searchMedia(bh, query, type);
            if (!media) {
                await ctx.editReply(`❌ Kein ${label} mit dem Titel "${query}" gefunden.`);
                return;
            }
            await ctx.editReply({ embeds: [anilist.buildMediaEmbed(media, type)] });
        } catch (err) {
            bh.logger.error(`AniSearch ${label}-Suche fehlgeschlagen: ${err.message}`);
            await ctx.editReply(`❌ Fehler bei der Suche: ${err.message}`);
        }
    }

    bh.commands.register({
        name: 'anisearch-anime', description: 'Sucht einen Anime auf AniList.',
        options: [{ name: 'titel', description: 'Titel des Anime', type: 'string', required: true }],
        async execute(ctx) { await searchAndReply(ctx, 'ANIME', 'Anime'); },
    });

    bh.commands.register({
        name: 'anisearch-manga', description: 'Sucht einen Manga auf AniList.',
        options: [{ name: 'titel', description: 'Titel des Manga', type: 'string', required: true }],
        async execute(ctx) { await searchAndReply(ctx, 'MANGA', 'Manga'); },
    });

    bh.commands.register({
        name: 'anisearch-track', description: 'Verfolgt einen Anime — postet eine Nachricht, sobald eine neue Episode erscheint.',
        options: [{ name: 'titel', description: 'Titel des Anime', type: 'string', required: true }],
        async execute(ctx) {
            if (!ctx.interaction.memberPermissions?.has('ManageGuild')) {
                await ctx.reply({ text: '❌ Du brauchst die Berechtigung **Server verwalten**.', ephemeral: true });
                return;
            }
            const clientId = ctx.interaction.client.user.id;
            const botId = await tracking.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const settings = await tracking.getSettings(botId);
            if (!settings?.channel_id) {
                await ctx.reply({ text: '❌ Kein Ziel-Channel konfiguriert — bitte zuerst im Dashboard einstellen.', ephemeral: true });
                return;
            }

            await ctx.defer(true);
            const query = ctx.options.getString('titel', true);
            try {
                const media = await anilist.searchMedia(bh, query, 'ANIME');
                if (!media) { await ctx.editReply(`❌ Kein Anime mit dem Titel "${query}" gefunden.`); return; }

                if (await tracking.isTracked(botId, media.id)) {
                    await ctx.editReply(`ℹ️ "${media.title?.romaji || query}" wird bereits verfolgt.`);
                    return;
                }

                const title = media.title?.english || media.title?.romaji || media.title?.native || query;
                const airing = await anilist.getAiringInfo(bh, media.id).catch(() => null);
                const initialEpisode = airing?.nextAiringEpisode?.episode ?? null;

                await tracking.addTracked(botId, media.id, title, media.coverImage?.large || null, initialEpisode);
                await ctx.editReply(`✅ "${title}" wird jetzt verfolgt — neue Episoden werden in <#${settings.channel_id}> angekündigt.`);
            } catch (err) {
                await ctx.editReply(`❌ Fehler: ${err.message}`);
            }
        },
    });

    bh.commands.register({
        name: 'anisearch-untrack', description: 'Entfernt einen verfolgten Anime.',
        options: [{ name: 'titel', description: 'Titel des verfolgten Anime', type: 'string', required: true, autocomplete: true }],
        async execute(ctx) {
            if (!ctx.interaction.memberPermissions?.has('ManageGuild')) {
                await ctx.reply({ text: '❌ Du brauchst die Berechtigung **Server verwalten**.', ephemeral: true });
                return;
            }
            const clientId = ctx.interaction.client.user.id;
            const botId = await tracking.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const rawInput = ctx.options.getString('titel', true);
            const anilistId = Number(rawInput);
            const tracked = await tracking.listTracked(botId);
            const match = tracked.find(t => t.anilist_id === anilistId) || tracked.find(t => t.title === rawInput);
            if (!match) { await ctx.reply({ text: '❌ Nicht gefunden — bitte aus der Autocomplete-Liste wählen.', ephemeral: true }); return; }

            await tracking.removeTracked(botId, match.anilist_id);
            await ctx.reply({ text: `✅ "${match.title}" wird nicht mehr verfolgt.`, ephemeral: true });
        },
        async autocomplete(ctx) {
            const clientId = ctx.interaction.client.user.id;
            const botId = await tracking.resolveBotId(clientId);
            if (!botId) return [];
            const focused = String(ctx.focused?.value ?? '').toLowerCase();
            const tracked = await tracking.listTracked(botId);
            return tracked
                .filter(t => t.title.toLowerCase().includes(focused))
                .slice(0, 25)
                .map(t => ({ name: t.title, value: String(t.anilist_id) }));
        },
    });

    bh.commands.register({
        name: 'anisearch-list', description: 'Zeigt alle verfolgten Anime dieses Servers.',
        options: [],
        async execute(ctx) {
            const clientId = ctx.interaction.client.user.id;
            const botId = await tracking.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const tracked = await tracking.listTracked(botId);
            if (!tracked.length) {
                await ctx.reply({ text: 'ℹ️ Aktuell wird kein Anime verfolgt.', ephemeral: true });
                return;
            }
            const list = tracked.map(t => `• ${t.title}`).join('\n');
            await ctx.reply({ embeds: [{ color: 0x02a9ff, title: '🎌 Verfolgte Anime', description: list }], ephemeral: true });
        },
    });

    // ── Periodischer Airing-Check ─────────────────────────────────────────────
    // Diff-basiert statt zeitbasiert: nextAiringEpisode.episode zeigt immer auf die
    // NÄCHSTE (noch nicht ausgestrahlte) Episode. Steigt die Zahl gegenüber dem
    // zuletzt gespeicherten Wert, ist die vorherige "nächste" Episode inzwischen
    // ausgestrahlt worden — genau die wird als "neu erschienen" gemeldet.
    async function runAiringCheck() {
        let rows;
        try { rows = await tracking.listAllTrackedAcrossBots(); } catch (err) {
            bh.logger.warn(`AniSearch Airing-Check: DB-Fehler: ${err.message}`);
            return;
        }
        if (!rows.length) return;

        // Nach bot_id gruppieren, damit Settings/Channel nur einmal pro Bot geladen werden.
        const byBot = new Map();
        for (const r of rows) {
            if (!byBot.has(r.bot_id)) byBot.set(r.bot_id, []);
            byBot.get(r.bot_id).push(r);
        }

        for (const [botId, entries] of byBot) {
            const settings = await tracking.getSettings(botId).catch(() => null);
            if (!settings?.channel_id) continue;

            for (const entry of entries) {
                let info;
                try { info = await anilist.getAiringInfo(bh, entry.anilist_id); } catch (err) {
                    bh.logger.warn(`AniSearch: Airing-Info für "${entry.title}" fehlgeschlagen: ${err.message}`);
                    continue;
                }
                const nextEp = info?.nextAiringEpisode?.episode ?? null;
                if (nextEp == null) continue; // Serie beendet oder keine Daten

                const previouslyKnown = entry.last_known_episode;
                if (previouslyKnown != null && nextEp > previouslyKnown) {
                    const airedEpisode = nextEp - 1;
                    try {
                        await bh.messaging.send(settings.channel_id, {
                            embeds: [{
                                color: 0x02a9ff,
                                title: `📺 ${entry.title}`,
                                description: `Episode **${airedEpisode}** ist gerade erschienen!`,
                                image: entry.cover_url || undefined,
                                footer: { text: 'AniList' },
                            }],
                        });
                    } catch (err) {
                        bh.logger.warn(`AniSearch: Ankündigung für "${entry.title}" fehlgeschlagen: ${err.message}`);
                    }
                }
                if (previouslyKnown == null || nextEp !== previouslyKnown) {
                    await tracking.updateLastKnownEpisode(entry.id, nextEp).catch(() => {});
                }
            }
        }
    }

    bh.scheduler.interval(CHECK_INTERVAL_MS, () => {
        runAiringCheck().catch(err => bh.logger.error(`AniSearch Airing-Check Fehler: ${err.message}`));
    }, { key: 'anisearch-airing-check' });

    bh.plugin.onEnable(async () => { bh.logger.info('AniSearch Plugin aktiviert'); });
    bh.plugin.onDisable(async () => { bh.logger.info('AniSearch Plugin deaktiviert'); bh.scheduler.stop('anisearch-airing-check'); });
};
