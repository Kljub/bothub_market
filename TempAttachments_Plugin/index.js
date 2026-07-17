'use strict';

// TempAttachments Plugin — /tempfile-create postet ein Embed mit Zugriffs-Button.
// Zugriffsregeln (Startdatum/Ablaufdatum/Passwort/Max-Nutzungen/1x-pro-User/
// erlaubte Rollen) werden bei JEDEM Klick frisch gegen die DB geprüft — läuft
// über einen Bot-Neustart hinweg korrekt weiter (kein In-Memory-Timer-Zustand).
// Nur der Bot Owner (Dashboard) kann die Commands aktivieren/deaktivieren und
// Berechtigungen (Rollen/Channels) setzen — kein eigenes Konfigurations-UI.

const path = require('path');
const files = require('./lib/files');

let _dbQuery = null;
function getDbQuery() {
    if (_dbQuery) return _dbQuery;
    const candidates = [
        path.resolve(__dirname, '../../core/src/plugin-runtime/db'),
        path.resolve(__dirname, '../../src/plugin-runtime/db'),
    ];
    for (const c of candidates) {
        try { _dbQuery = require(c).query; break; } catch (_) {}
    }
    return _dbQuery;
}

async function checkCmd(ctx, moduleKey) {
    const dbQuery = getDbQuery();
    if (!dbQuery) return true;
    const clientId = ctx.interaction?.client?.user?.id;
    if (!clientId) return true;

    let botId;
    try {
        const rows = await dbQuery('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
        botId = rows[0]?.id;
    } catch (_) {}
    if (!botId) return true;

    let row;
    try {
        const rows = await dbQuery('SELECT enabled, settings FROM bot_module_states WHERE bot_id = ? AND module_key = ? LIMIT 1', [botId, moduleKey]);
        row = rows[0];
    } catch (_) {}
    if (!row) return true;
    if (!row.enabled) {
        await ctx.reply({ text: '❌ Dieser Command ist deaktiviert.', ephemeral: true });
        return false;
    }

    let cfg = {};
    try { cfg = typeof row.settings === 'string' ? JSON.parse(row.settings) : (row.settings ?? {}); } catch (_) {}
    const bannedChannels      = cfg.banned_channels      ?? [];
    const requiredPermissions = cfg.required_permissions ?? [];
    const bannedRoles         = cfg.banned_roles         ?? [];
    const allowedRoles        = cfg.allowed_roles        ?? [];
    const member      = ctx.interaction?.member;
    const channelName = ctx.channel?.name ?? '';
    const memberRoles = member?.roles?.cache?.map(r => r.name) ?? [];

    if (bannedChannels.length && bannedChannels.includes(channelName)) {
        await ctx.reply({ text: '❌ Dieser Command ist in diesem Channel nicht erlaubt.', ephemeral: true });
        return false;
    }
    for (const perm of requiredPermissions) {
        if (!member?.permissions?.has(perm)) {
            await ctx.reply({ text: `❌ Du benötigst die Berechtigung \`${perm}\`.`, ephemeral: true });
            return false;
        }
    }
    if (bannedRoles.length && bannedRoles.some(r => memberRoles.includes(r))) {
        await ctx.reply({ text: '❌ Eine deiner Rollen verbietet die Nutzung dieses Commands.', ephemeral: true });
        return false;
    }
    if (allowedRoles.length && !allowedRoles.some(r => memberRoles.includes(r))) {
        await ctx.reply({ text: '❌ Du hast keine erlaubte Rolle für diesen Command.', ephemeral: true });
        return false;
    }
    return true;
}

function parseDate(str) {
    if (!str) return null;
    const d = new Date(str);
    return isNaN(d.getTime()) ? undefined : d; // undefined = Parse-Fehler, null = nicht gesetzt
}

function accessButtonRow(fileId, disabled = false) {
    return [{ type: 1, components: [{ type: 2, style: 1, label: '📎 Zugriff', custom_id: `taf_access:${fileId}`, disabled }] }];
}

module.exports = async function (bh) {
    bh.logger.info('TempAttachments Plugin geladen');

    /** Prüft Start-/Ablaufdatum, Rollen, Max-Nutzungen, 1x-pro-User. Liefert {ok:true} oder {ok:false, reason, disableButton}. */
    async function checkAccess(file, member, userId) {
        const now = new Date();
        if (file.starting_date && now < new Date(file.starting_date)) {
            return { ok: false, reason: '⏳ Diese Datei ist noch nicht verfügbar.' };
        }
        if (file.expiring_date && now > new Date(file.expiring_date)) {
            return { ok: false, reason: '⏰ Diese Datei ist nicht mehr verfügbar.', disableButton: true };
        }
        if (file.max_usages !== null && file.used_count >= file.max_usages) {
            return { ok: false, reason: '🚫 Das Nutzungslimit wurde erreicht.', disableButton: true };
        }
        if (file.one_per_user && await files.hasUsed(file.id, userId)) {
            return { ok: false, reason: '🚫 Du hast diese Datei bereits verwendet.' };
        }
        const allowedRoles = await files.getAllowedRoles(file.id);
        if (allowedRoles.length) {
            const memberRoleIds = member?.roles?.cache ? [...member.roles.cache.keys()] : [];
            if (!allowedRoles.some(r => memberRoleIds.includes(r))) {
                return { ok: false, reason: '🚫 Du hast keine berechtigte Rolle für diese Datei.' };
            }
        }
        return { ok: true };
    }

    async function grantAccess(file, interaction) {
        await files.recordUsage(file.id, interaction.user.id);
        const parts = [];
        if (file.text_content) parts.push(file.text_content);
        if (file.attachment_url) parts.push(file.attachment_url);
        await interaction.reply({ content: parts.join('\n\n') || 'ℹ️ Kein Inhalt hinterlegt.', ephemeral: true }).catch(() => {});

        const updated = await files.getFileById(file.id);
        if (updated.max_usages !== null && updated.used_count >= updated.max_usages && updated.message_id && updated.channel_id) {
            await bh.messaging.edit(updated.channel_id, updated.message_id, { components: accessButtonRow(file.id, true) }).catch(() => {});
        }
    }

    async function disableButtonMessage(file) {
        if (!file.message_id || !file.channel_id) return;
        await bh.messaging.edit(file.channel_id, file.message_id, { components: accessButtonRow(file.id, true) }).catch(() => {});
    }

    // ── Button: "📎 Zugriff" ──────────────────────────────────────────────────
    bh.events.on('button.clicked', async (payload) => {
        if (!payload.customId?.startsWith('taf_access:')) return;
        const interaction = payload._interaction;
        const fileId = parseInt(payload.customId.slice('taf_access:'.length), 10);
        const file = await files.getFileById(fileId);
        if (!file) { await interaction.reply({ content: '❌ Diese Datei existiert nicht mehr.', ephemeral: true }).catch(() => {}); return; }

        const check = await checkAccess(file, interaction.member, interaction.user.id);
        if (!check.ok) {
            await interaction.reply({ content: check.reason, ephemeral: true }).catch(() => {});
            if (check.disableButton) await disableButtonMessage(file);
            return;
        }

        if (file.password_hash) {
            await interaction.showModal({
                custom_id: `taf_pw:${fileId}`,
                title: `Passwort für "${file.name}"`,
                components: [{
                    type: 1,
                    components: [{ type: 4, custom_id: 'password', label: 'Passwort', style: 1, required: true, max_length: 100 }],
                }],
            }).catch(() => {});
            return;
        }

        await grantAccess(file, interaction);
    });

    // ── Modal-Submit: Passwort-Eingabe ──────────────────────────────────────
    bh.events.on('modal.submitted', async (payload) => {
        if (!payload.customId?.startsWith('taf_pw:')) return;
        const interaction = payload._interaction;
        const fileId = parseInt(payload.customId.slice('taf_pw:'.length), 10);
        const file = await files.getFileById(fileId);
        if (!file) { await interaction.reply({ content: '❌ Diese Datei existiert nicht mehr.', ephemeral: true }).catch(() => {}); return; }

        const check = await checkAccess(file, interaction.member, interaction.user.id);
        if (!check.ok) {
            await interaction.reply({ content: check.reason, ephemeral: true }).catch(() => {});
            if (check.disableButton) await disableButtonMessage(file);
            return;
        }

        const password = payload.fields?.password ?? '';
        if (!files.verifyPassword(password, file.password_hash)) {
            await interaction.reply({ content: '❌ Falsches Passwort.', ephemeral: true }).catch(() => {});
            return;
        }

        await grantAccess(file, interaction);
    });

    // ── /tempfile-create ─────────────────────────────────────────────────────
    bh.commands.register({
        name: 'tempfile-create', description: 'Erstellt eine temporäre Datei/Text mit Zugriffs-Button.',
        options: [
            { name: 'name',           description: 'Eindeutiger Name für diese Datei',        type: 'string',     required: true },
            { name: 'attachment',     description: 'Datei-Anhang (optional)',                  type: 'attachment', required: false },
            { name: 'text',           description: 'Text-Inhalt (optional)',                   type: 'string',     required: false },
            { name: 'password',       description: 'Passwort für den Zugriff (optional)',      type: 'string',     required: false },
            { name: 'max_usages',     description: 'Maximale Anzahl Nutzungen (optional)',     type: 'integer',    required: false, min_value: 1 },
            { name: 'starting_date',  description: 'Verfügbar ab (z.B. 2026-12-24 18:00)',     type: 'string',     required: false },
            { name: 'expiring_date',  description: 'Verfügbar bis (z.B. 2026-12-31 23:59)',    type: 'string',     required: false },
            { name: 'one_per_user',   description: 'Jeder User nur einmal? (Standard: nein)',  type: 'boolean',    required: false },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'tempattachments-plugin:tempfile-create')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }
            if (!ctx.interaction.memberPermissions?.has('ManageGuild')) {
                await ctx.reply({ text: '❌ Du brauchst die Berechtigung **Server verwalten**.', ephemeral: true });
                return;
            }

            const clientId = ctx.interaction.client.user.id;
            const botId = await files.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const name = ctx.options.getString('name', true).trim();
            if (!name) { await ctx.reply({ text: '❌ Name darf nicht leer sein.', ephemeral: true }); return; }
            if (await files.getFile(botId, ctx.guild.id, name)) {
                await ctx.reply({ text: `❌ Es gibt bereits eine Datei namens \`${name}\` auf diesem Server.`, ephemeral: true });
                return;
            }

            const attachment = ctx.options.getAttachment('attachment');
            const text = ctx.options.getString('text');
            if (!attachment && !text) {
                await ctx.reply({ text: '❌ Gib mindestens einen Anhang oder einen Text an.', ephemeral: true });
                return;
            }

            const startingDate = parseDate(ctx.options.getString('starting_date'));
            const expiringDate = parseDate(ctx.options.getString('expiring_date'));
            if (startingDate === undefined || expiringDate === undefined) {
                await ctx.reply({ text: '❌ Ungültiges Datumsformat. Beispiel: `2026-12-24 18:00`.', ephemeral: true });
                return;
            }
            if (startingDate && expiringDate && startingDate >= expiringDate) {
                await ctx.reply({ text: '❌ Das Ablaufdatum muss nach dem Startdatum liegen.', ephemeral: true });
                return;
            }

            const file = await files.createFile(botId, ctx.guild.id, {
                name, createdBy: ctx.user.id,
                textContent: text ?? null,
                attachmentUrl: attachment?.url ?? null,
                attachmentFilename: attachment?.name ?? null,
                password: ctx.options.getString('password') || null,
                maxUsages: ctx.options.getInteger('max_usages') ?? null,
                onePerUser: !!ctx.options.getBoolean('one_per_user'),
                startingDate, expiringDate,
            });

            const lines = [
                `**${name}**`,
                file.password_hash ? '🔒 Passwortgeschützt' : '🔓 Kein Passwort',
                file.max_usages !== null ? `Max. Nutzungen: ${file.max_usages}` : 'Max. Nutzungen: unbegrenzt',
                file.one_per_user ? '👤 Jeder User nur einmal' : '♾️ Mehrfachnutzung pro User erlaubt',
                startingDate ? `Verfügbar ab: ${startingDate.toISOString()}` : null,
                expiringDate ? `Verfügbar bis: ${expiringDate.toISOString()}` : null,
            ].filter(Boolean);

            await ctx.reply({
                embeds: [{ color: 0x5865f2, title: '📎 Temporäre Datei erstellt', description: lines.join('\n') }],
                components: accessButtonRow(file.id),
            });

            const msg = await ctx.interaction.fetchReply().catch(() => null);
            if (msg) await files.setMessageLocation(file.id, msg.id, msg.channel?.id ?? ctx.channel?.id);
        },
    });

    // ── /tempfile-allowrole ──────────────────────────────────────────────────
    bh.commands.register({
        name: 'tempfile-allowrole', description: 'Erlaubt einer Rolle den Zugriff auf eine temporäre Datei.',
        options: [
            { name: 'role', description: 'Rolle',                                        type: 'role',   required: true },
            { name: 'name', description: 'Name der Datei (Standard: deine zuletzt erstellte)', type: 'string', required: false, autocomplete: true },
        ],
        async autocomplete(ctx) {
            const clientId = ctx.interaction.client.user.id;
            const botId = await files.resolveBotId(clientId);
            if (!botId || !ctx.guild) return [];
            const focused = String(ctx.focused?.value ?? '').toLowerCase();
            const list = await files.listFiles(botId, ctx.guild.id);
            return list
                .filter(f => f.name.toLowerCase().includes(focused))
                .map(f => ({ name: `${f.name} (#${f.id})`, value: f.name }));
        },
        async execute(ctx) {
            if (!await checkCmd(ctx, 'tempattachments-plugin:tempfile-allowrole')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }
            if (!ctx.interaction.memberPermissions?.has('ManageGuild')) {
                await ctx.reply({ text: '❌ Du brauchst die Berechtigung **Server verwalten**.', ephemeral: true });
                return;
            }

            const botId = await files.resolveBotId(ctx.interaction.client.user.id);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const name = ctx.options.getString('name');
            const file = name ? await files.getFile(botId, ctx.guild.id, name) : await files.getLatestFileByCreator(botId, ctx.guild.id, ctx.user.id);
            if (!file) { await ctx.reply({ text: '❌ Datei nicht gefunden.', ephemeral: true }); return; }

            const role = ctx.options.getRole('role', true);
            await files.addAllowedRole(file.id, role.id);
            await ctx.reply({ text: `✅ Rolle **${role.name}** hat jetzt Zugriff auf \`${file.name}\`.`, ephemeral: true });
        },
    });

    // ── /tempfile-removerole ─────────────────────────────────────────────────
    bh.commands.register({
        name: 'tempfile-removerole', description: 'Entfernt den Zugriff einer Rolle auf eine temporäre Datei.',
        options: [
            { name: 'role', description: 'Rolle',                                        type: 'role',   required: true },
            { name: 'name', description: 'Name der Datei (Standard: deine zuletzt erstellte)', type: 'string', required: false, autocomplete: true },
        ],
        async autocomplete(ctx) {
            const clientId = ctx.interaction.client.user.id;
            const botId = await files.resolveBotId(clientId);
            if (!botId || !ctx.guild) return [];
            const focused = String(ctx.focused?.value ?? '').toLowerCase();
            const list = await files.listFiles(botId, ctx.guild.id);
            return list
                .filter(f => f.name.toLowerCase().includes(focused))
                .map(f => ({ name: `${f.name} (#${f.id})`, value: f.name }));
        },
        async execute(ctx) {
            if (!await checkCmd(ctx, 'tempattachments-plugin:tempfile-removerole')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }
            if (!ctx.interaction.memberPermissions?.has('ManageGuild')) {
                await ctx.reply({ text: '❌ Du brauchst die Berechtigung **Server verwalten**.', ephemeral: true });
                return;
            }

            const botId = await files.resolveBotId(ctx.interaction.client.user.id);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const name = ctx.options.getString('name');
            const file = name ? await files.getFile(botId, ctx.guild.id, name) : await files.getLatestFileByCreator(botId, ctx.guild.id, ctx.user.id);
            if (!file) { await ctx.reply({ text: '❌ Datei nicht gefunden.', ephemeral: true }); return; }

            const role = ctx.options.getRole('role', true);
            await files.removeAllowedRole(file.id, role.id);
            await ctx.reply({ text: `✅ Rolle **${role.name}** hat keinen Zugriff mehr auf \`${file.name}\`.`, ephemeral: true });
        },
    });

    // ── /tempfile-delete ─────────────────────────────────────────────────────
    bh.commands.register({
        name: 'tempfile-delete', description: 'Löscht eine temporäre Datei.',
        options: [
            { name: 'name', description: 'Name der Datei', type: 'string', required: true },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'tempattachments-plugin:tempfile-delete')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }
            if (!ctx.interaction.memberPermissions?.has('ManageGuild')) {
                await ctx.reply({ text: '❌ Du brauchst die Berechtigung **Server verwalten**.', ephemeral: true });
                return;
            }

            const botId = await files.resolveBotId(ctx.interaction.client.user.id);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const name = ctx.options.getString('name', true);
            const file = await files.getFile(botId, ctx.guild.id, name);
            if (!file) { await ctx.reply({ text: `❌ Datei \`${name}\` nicht gefunden.`, ephemeral: true }); return; }

            if (file.message_id && file.channel_id) {
                await bh.messaging.edit(file.channel_id, file.message_id, { components: accessButtonRow(file.id, true) }).catch(() => {});
            }
            await files.deleteFile(botId, ctx.guild.id, name);
            await ctx.reply({ text: `🗑️ Datei \`${name}\` gelöscht.`, ephemeral: true });
        },
    });

    // ── Proaktiver Ablauf-Sweep: deaktiviert Buttons abgelaufener Dateien auch
    // ohne dass jemand klickt (alle 5 Minuten). checkAccess() beim Klick bleibt
    // die eigentliche Durchsetzung — das hier ist nur UX-Politur. ──────────────
    bh.scheduler.interval(5 * 60_000, async () => {
        const dbQuery = getDbQuery();
        if (!dbQuery) return;
        try {
            const rows = await dbQuery(
                `SELECT id, message_id, channel_id FROM plugin_tempattachments_plugin_files
                 WHERE expiring_date IS NOT NULL AND expiring_date < NOW() AND message_id IS NOT NULL`
            );
            for (const row of rows) {
                await bh.messaging.edit(row.channel_id, row.message_id, { components: accessButtonRow(row.id, true) }).catch(() => {});
            }
        } catch (_) {}
    }, { key: 'tempattachments-expiry-sweep' });

    bh.plugin.onEnable(async () => { bh.logger.info('TempAttachments Plugin aktiviert'); });
    bh.plugin.onDisable(async () => {
        bh.scheduler.stop('tempattachments-expiry-sweep');
        bh.logger.info('TempAttachments Plugin deaktiviert');
    });
};
