'use strict';

// Discord Server Backup Plugin
// Erstellt Komplett-Backups einer Guild (Rollen, Channels inkl. Overwrites,
// Emojis, Sticker, Server-Einstellungen, Bans) — manuell per /backup oder
// per Zeitplan. Es existiert immer genau EIN Backup pro Guild (Überschreiben).

const INCLUDE_DEFAULTS = {
    settings: 1,
    roles: 1,
    channels: 1,
    emojis: 1,
    stickers: 1,
    bans: 1,
};

const INCLUDE_LABELS = {
    settings: 'Server-Einstellungen',
    roles: 'Rollen + Berechtigungen',
    channels: 'Channels + Berechtigungen',
    emojis: 'Emojis / GIFs',
    stickers: 'Sticker',
    bans: 'Bans',
};

// ── Serialisierung ───────────────────────────────────────────────────────────

function serializeOverwrites(channel) {
    const out = [];
    for (const ow of channel.permissionOverwrites?.cache?.values() ?? []) {
        out.push({
            id: ow.id,
            type: ow.type, // 0 = role, 1 = member
            allow: ow.allow?.bitfield?.toString() ?? '0',
            deny: ow.deny?.bitfield?.toString() ?? '0',
        });
    }
    return out;
}

function serializeRoles(guild) {
    return [...guild.roles.cache.values()]
        .sort((a, b) => b.position - a.position)
        .map(r => ({
            id: r.id,
            name: r.name,
            color: r.hexColor,
            hoist: r.hoist,
            position: r.position,
            permissions: r.permissions?.bitfield?.toString() ?? '0',
            mentionable: r.mentionable,
            managed: r.managed,
            icon: r.iconURL?.() ?? null,
            unicode_emoji: r.unicodeEmoji ?? null,
            is_everyone: r.id === guild.id,
        }));
}

function serializeChannels(guild) {
    return [...guild.channels.cache.values()]
        .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0))
        .map(ch => ({
            id: ch.id,
            type: ch.type,
            name: ch.name,
            parent_id: ch.parentId ?? null,
            position: ch.rawPosition ?? ch.position ?? 0,
            topic: ch.topic ?? null,
            nsfw: ch.nsfw ?? false,
            slowmode: ch.rateLimitPerUser ?? 0,
            bitrate: ch.bitrate ?? null,
            user_limit: ch.userLimit ?? null,
            rtc_region: ch.rtcRegion ?? null,
            video_quality: ch.videoQualityMode ?? null,
            auto_archive: ch.defaultAutoArchiveDuration ?? null,
            forum_tags: (ch.availableTags ?? []).map(t => ({
                id: t.id, name: t.name, moderated: t.moderated,
                emoji_id: t.emoji?.id ?? null, emoji_name: t.emoji?.name ?? null,
            })),
            default_reaction: ch.defaultReactionEmoji
                ? { id: ch.defaultReactionEmoji.id ?? null, name: ch.defaultReactionEmoji.name ?? null }
                : null,
            overwrites: serializeOverwrites(ch),
        }));
}

function serializeEmojis(guild) {
    return [...guild.emojis.cache.values()].map(e => ({
        id: e.id,
        name: e.name,
        animated: !!e.animated,
        url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}`,
        roles: [...(e.roles?.cache?.keys?.() ?? [])],
    }));
}

async function serializeStickers(guild) {
    const stickers = await guild.stickers.fetch().catch(() => guild.stickers.cache);
    return [...stickers.values()].map(s => ({
        id: s.id,
        name: s.name,
        description: s.description ?? null,
        tags: s.tags ?? null,
        format: s.format,
        url: s.url ?? `https://cdn.discordapp.com/stickers/${s.id}.png`,
    }));
}

function serializeSettings(guild) {
    return {
        name: guild.name,
        description: guild.description ?? null,
        icon: guild.iconURL({ size: 1024 }) ?? null,
        banner: guild.bannerURL?.({ size: 1024 }) ?? null,
        splash: guild.splashURL?.({ size: 1024 }) ?? null,
        discovery_splash: guild.discoverySplashURL?.() ?? null,
        owner_id: guild.ownerId,
        verification_level: guild.verificationLevel,
        default_notifications: guild.defaultMessageNotifications,
        explicit_content_filter: guild.explicitContentFilter,
        mfa_level: guild.mfaLevel,
        nsfw_level: guild.nsfwLevel,
        preferred_locale: guild.preferredLocale,
        afk_channel_id: guild.afkChannelId ?? null,
        afk_timeout: guild.afkTimeout ?? null,
        system_channel_id: guild.systemChannelId ?? null,
        system_channel_flags: guild.systemChannelFlags?.bitfield?.toString?.() ?? null,
        rules_channel_id: guild.rulesChannelId ?? null,
        public_updates_channel_id: guild.publicUpdatesChannelId ?? null,
        safety_alerts_channel_id: guild.safetyAlertsChannelId ?? null,
        premium_progress_bar: guild.premiumProgressBarEnabled ?? false,
        vanity_url_code: guild.vanityURLCode ?? null,
        features: guild.features ?? [],
        member_count: guild.memberCount,
    };
}

async function serializeBans(guild) {
    try {
        const bans = await guild.bans.fetch();
        return [...bans.values()].map(b => ({
            user_id: b.user?.id,
            user_tag: b.user?.tag ?? null,
            reason: b.reason ?? null,
        }));
    } catch (_) {
        return { error: 'Bans konnten nicht gelesen werden (Berechtigung "Mitglieder bannen" fehlt).' };
    }
}

async function buildBackup(guild, include) {
    // Caches auffrischen, damit nichts fehlt
    await guild.fetch().catch(() => {});
    await guild.roles.fetch().catch(() => {});
    await guild.channels.fetch().catch(() => {});
    await guild.emojis.fetch().catch(() => {});

    const data = {
        format: 'bothub-server-backup',
        version: 1,
        created_at: new Date().toISOString(),
        guild: { id: guild.id, name: guild.name },
        include,
    };

    if (include.settings) data.settings = serializeSettings(guild);
    if (include.roles)    data.roles = serializeRoles(guild);
    if (include.channels) data.channels = serializeChannels(guild);
    if (include.emojis)   data.emojis = serializeEmojis(guild);
    if (include.stickers) data.stickers = await serializeStickers(guild);
    if (include.bans)     data.bans = await serializeBans(guild);

    const counts = {
        roles: Array.isArray(data.roles) ? data.roles.length : 0,
        channels: Array.isArray(data.channels) ? data.channels.length : 0,
        emojis: Array.isArray(data.emojis) ? data.emojis.length : 0,
        stickers: Array.isArray(data.stickers) ? data.stickers.length : 0,
        bans: Array.isArray(data.bans) ? data.bans.length : 0,
    };
    return { data, counts };
}

// ── Zeitzonen-Helfer (für den Zeitplan) ──────────────────────────────────────

function nowInTimezone(tz) {
    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', weekday: 'short',
        }).formatToParts(new Date());
        const get = (t) => parts.find(p => p.type === t)?.value ?? '';
        const weekdayMap = { Sun: '0', Mon: '1', Tue: '2', Wed: '3', Thu: '4', Fri: '5', Sat: '6' };
        return {
            date: `${get('year')}-${get('month')}-${get('day')}`,
            time: `${get('hour') === '24' ? '00' : get('hour')}:${get('minute')}`,
            weekday: weekdayMap[get('weekday')] ?? '1',
        };
    } catch (_) {
        return null; // ungültige Zeitzone
    }
}

// ── Plugin-Entry ─────────────────────────────────────────────────────────────

module.exports = async function (bh) {
    bh.logger.info('Discord Server Backup Plugin geladen');

    function parseInclude(row) {
        let inc = {};
        try { inc = JSON.parse(row?.include_json || '{}') || {}; } catch (_) {}
        const out = {};
        for (const key of Object.keys(INCLUDE_DEFAULTS)) {
            out[key] = inc[key] !== undefined ? (inc[key] ? 1 : 0) : INCLUDE_DEFAULTS[key];
        }
        return out;
    }

    async function saveBackup(guild, triggerType, userId) {
        const settingsRow = await bh.database.table('settings').findOne({ guild_id: guild.id });
        const include = parseInclude(settingsRow);

        const { data, counts } = await buildBackup(guild, include);
        const json = JSON.stringify(data);

        const row = {
            guild_id: guild.id,
            guild_name: guild.name.slice(0, 120),
            created_by: userId ?? null,
            trigger_type: triggerType,
            counts_json: JSON.stringify(counts),
            size_bytes: Buffer.byteLength(json, 'utf8'),
            data: json,
            created_at: new Date(),
        };

        const existing = await bh.database.table('backups').findOne({ guild_id: guild.id });
        if (existing) {
            await bh.database.table('backups').update(row, { guild_id: guild.id });
        } else {
            await bh.database.table('backups').insert(row);
        }
        return { counts, size: row.size_bytes };
    }

    function fmtSize(bytes) {
        if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
        if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return bytes + ' B';
    }

    // ── /backup Command ──────────────────────────────────────────────────
    const commandDef = {
        name: 'backup',
        description: 'Server-Backup erstellen, löschen oder Status anzeigen',
        options: [
            {
                name: 'action',
                description: 'Was soll gemacht werden?',
                type: 'string',
                required: true,
                choices: [
                    { name: 'create — Backup jetzt erstellen (überschreibt das alte)', value: 'create' },
                    { name: 'delete — Gespeichertes Backup löschen', value: 'delete' },
                    { name: 'info — Backup-Status anzeigen', value: 'info' },
                ],
            },
        ],
        async execute(ctx) {
            const guild = ctx.interaction.guild;
            if (!guild) {
                await ctx.reply({ text: '❌ Dieser Command funktioniert nur auf einem Server.', ephemeral: true });
                return;
            }
            if (!ctx.interaction.memberPermissions?.has('ManageGuild')) {
                await ctx.reply({ text: '❌ Du brauchst die Berechtigung **Server verwalten**.', ephemeral: true });
                return;
            }

            const action = ctx.options.getString('action');
            await ctx.defer(true);

            try {
                if (action === 'create') {
                    const started = Date.now();
                    const { counts, size } = await saveBackup(guild, 'manual', ctx.user.id);
                    await ctx.editReply(
                        `✅ **Backup erstellt** (${((Date.now() - started) / 1000).toFixed(1)}s, ${fmtSize(size)})\n`
                        + `Rollen: **${counts.roles}** · Channels: **${counts.channels}** · Emojis: **${counts.emojis}** · Sticker: **${counts.stickers}** · Bans: **${counts.bans}**\n`
                        + `_Das vorherige Backup wurde überschrieben. Details & Download im Dashboard._`
                    );
                } else if (action === 'delete') {
                    const existing = await bh.database.table('backups').findOne({ guild_id: guild.id });
                    if (!existing) {
                        await ctx.editReply('ℹ️ Es existiert kein Backup für diesen Server.');
                        return;
                    }
                    await bh.database.table('backups').delete({ guild_id: guild.id });
                    await ctx.editReply('🗑️ Backup gelöscht.');
                } else {
                    const existing = await bh.database.table('backups').findOne({ guild_id: guild.id });
                    if (!existing) {
                        await ctx.editReply('ℹ️ Kein Backup vorhanden. Erstelle eins mit `/backup create`.');
                        return;
                    }
                    let counts = {};
                    try { counts = JSON.parse(existing.counts_json || '{}'); } catch (_) {}
                    const settingsRow = await bh.database.table('settings').findOne({ guild_id: guild.id });
                    const dayNames = { daily: 'Täglich', 0: 'Sonntag', 1: 'Montag', 2: 'Dienstag', 3: 'Mittwoch', 4: 'Donnerstag', 5: 'Freitag', 6: 'Samstag' };
                    const schedule = settingsRow?.schedule_enabled
                        ? `${dayNames[settingsRow.schedule_day] ?? settingsRow.schedule_day} um ${settingsRow.schedule_time} (${settingsRow.timezone})`
                        : 'deaktiviert';
                    await ctx.editReply(
                        `💾 **Backup-Status für ${guild.name}**\n`
                        + `Erstellt: **${new Date(existing.created_at).toLocaleString('de-DE')}** (${existing.trigger_type === 'schedule' ? 'Zeitplan' : 'manuell'})\n`
                        + `Größe: **${fmtSize(existing.size_bytes)}**\n`
                        + `Rollen: **${counts.roles ?? '–'}** · Channels: **${counts.channels ?? '–'}** · Emojis: **${counts.emojis ?? '–'}** · Sticker: **${counts.stickers ?? '–'}** · Bans: **${counts.bans ?? '–'}**\n`
                        + `Zeitplan: **${schedule}**`
                    );
                }
            } catch (err) {
                bh.logger.error(`Backup-Fehler (${guild.id}): ${err.message}`);
                await ctx.editReply(`❌ Fehler: ${err.message}`);
            }
        },
    };

    bh.commands.register(commandDef);
    bh.plugin.onBotStart(async () => {
        bh.commands.register(commandDef);
    });

    // ── Zeitplan: minütlicher Check ──────────────────────────────────────
    // schedule_day: '0'-'6' (So-Sa) oder 'daily'; schedule_time 'HH:MM'.
    // last_run_key verhindert Doppel-Ausführung innerhalb derselben Minute/Tages.
    let running = false;
    async function scheduleTick() {
        if (running) return;
        running = true;
        try {
            const rows = await bh.database.table('settings').findAll({ schedule_enabled: 1 });
            for (const row of rows) {
                const now = nowInTimezone(row.timezone || 'Europe/Berlin');
                if (!now) continue;
                if (row.schedule_day !== 'daily' && String(row.schedule_day) !== now.weekday) continue;
                if ((row.schedule_time || '09:00') !== now.time) continue;

                const runKey = `${now.date} ${now.time}`;
                if (row.last_run_key === runKey) continue;

                // Guild über die Rollen-SDK auflösen (liefert das volle Guild-Objekt
                // des Bots, der auf diesem Server ist)
                let guild = null;
                try {
                    const roles = await bh.roles.list(row.guild_id);
                    guild = roles?.[0]?.guild ?? null;
                } catch (_) {}
                if (!guild) {
                    bh.logger.warn(`Zeitplan-Backup: Guild ${row.guild_id} nicht erreichbar (Bot offline oder nicht auf dem Server?)`);
                    continue;
                }

                await bh.database.table('settings').update({ last_run_key: runKey }, { guild_id: row.guild_id });
                try {
                    const { size } = await saveBackup(guild, 'schedule', null);
                    bh.logger.info(`Zeitplan-Backup für ${guild.name} (${guild.id}) erstellt — ${size} Bytes`);
                } catch (err) {
                    bh.logger.error(`Zeitplan-Backup fehlgeschlagen (${row.guild_id}): ${err.message}`);
                }
            }
        } catch (err) {
            bh.logger.error(`Backup-Scheduler-Fehler: ${err.message}`);
        } finally {
            running = false;
        }
    }

    bh.scheduler.interval(60_000, () => { scheduleTick().catch(() => {}); }, { key: 'server-backup-schedule' });

    bh.plugin.onEnable(async () => {
        bh.logger.info('Discord Server Backup Plugin aktiviert');
    });

    bh.plugin.onDisable(async () => {
        bh.scheduler.stop('server-backup-schedule');
        bh.logger.info('Discord Server Backup Plugin deaktiviert');
    });
};

module.exports.INCLUDE_DEFAULTS = INCLUDE_DEFAULTS;
module.exports.INCLUDE_LABELS = INCLUDE_LABELS;
module.exports.buildBackup = buildBackup;
