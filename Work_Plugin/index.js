'use strict';

// Work Plugin — Bot Owner legt Jobs im Dashboard an (Name, Gehalt-Range,
// Cooldown, Currency). /job-accept weist einen Job zu, /work verdient Geld
// (respektiert den Job-eigenen Cooldown), /job-leave kündigt. Guthaben läuft
// über das native Economy-Core-Modul (Service-Bridge).

const path = require('path');
const jobs = require('./lib/jobs');

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

function fmtDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
    if (seconds < 86400) return `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)}h`;
    return `${(seconds / 86400).toFixed(seconds % 86400 === 0 ? 0 : 1)}d`;
}

module.exports = async function (bh) {
    bh.logger.info('Work Plugin geladen');

    const economyRead     = await bh.services.get('economy', 'economy.balance.read');
    const economyWrite    = await bh.services.get('economy', 'economy.balance.write');
    const economyCurrency = await bh.services.get('economy', 'economy.currency.info');

    if (!economyRead || !economyWrite || !economyCurrency) {
        bh.logger.error('Work Plugin: Economy-Services nicht verfügbar — /work kann nicht abgewickelt werden.');
    }

    async function resolveCurrency(botId, currencyKey) {
        const currencies = await economyCurrency.listCurrencies(botId);
        if (currencyKey) {
            const match = currencies.find(c => c.currency_key === currencyKey);
            if (match) return match;
        }
        return currencies.find(c => c.is_default) ?? currencies[0] ?? null;
    }

    function fmt(amount, currency) {
        return `${Number(amount).toLocaleString('de-DE')} ${currency.symbol} ${currency.name}`;
    }

    bh.commands.register({
        name: 'job-list', description: 'Zeigt alle verfügbaren Jobs.',
        options: [],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'work-plugin:job-list')) return;
            const clientId = ctx.interaction.client.user.id;
            const botId = await jobs.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const list = await jobs.listJobs(botId, { onlyEnabled: true });
            if (!list.length) {
                await ctx.reply({ text: 'ℹ️ Für diesen Bot sind noch keine Jobs eingerichtet.', ephemeral: true });
                return;
            }

            const lines = list.map(j =>
                `${j.emoji} **${j.name}** (\`${j.job_key}\`)\n` +
                `　${j.description || 'Keine Beschreibung.'}\n` +
                `　💰 ${j.pay_min}–${j.pay_max} · ⏱️ Cooldown: ${fmtDuration(j.cooldown_seconds)}`
            );

            await ctx.reply({
                embeds: [{
                    color: 0xf0c040,
                    title: '💼 Verfügbare Jobs',
                    description: lines.join('\n\n'),
                }],
            });
        },
    });

    bh.commands.register({
        name: 'job-accept', description: 'Nimmt einen Job an.',
        options: [
            { name: 'job', description: 'Job-Key (siehe /job-list)', type: 'string', required: true },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'work-plugin:job-accept')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }

            const clientId = ctx.interaction.client.user.id;
            const botId = await jobs.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const jobKey = ctx.options.getString('job', true).trim().toLowerCase();
            const job = await jobs.getJob(botId, jobKey);
            if (!job || !job.enabled) {
                await ctx.reply({ text: `❌ Unbekannter Job \`${jobKey}\`. Nutze /job-list für eine Übersicht.`, ephemeral: true });
                return;
            }

            await jobs.setEmployment(botId, ctx.guild.id, ctx.user.id, jobKey);
            await ctx.reply({ text: `✅ Du arbeitest jetzt als **${job.emoji} ${job.name}**. Verdiene mit \`/work\`.` });
        },
    });

    bh.commands.register({
        name: 'job-leave', description: 'Kündigt deinen aktuellen Job.',
        options: [],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'work-plugin:job-leave')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }

            const clientId = ctx.interaction.client.user.id;
            const botId = await jobs.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const employment = await jobs.getEmployment(botId, ctx.guild.id, ctx.user.id);
            if (!employment) {
                await ctx.reply({ text: 'ℹ️ Du hast aktuell keinen Job.', ephemeral: true });
                return;
            }

            await jobs.clearEmployment(botId, ctx.guild.id, ctx.user.id);
            await ctx.reply({ text: `👋 Du hast deinen Job gekündigt.`, ephemeral: true });
        },
    });

    bh.commands.register({
        name: 'work', description: 'Verdiene Geld mit deinem aktuellen Job.',
        options: [],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'work-plugin:work')) return;
            if (!ctx.guild) { await ctx.reply({ text: '❌ Nur auf einem Server nutzbar.', ephemeral: true }); return; }
            if (!economyRead || !economyWrite || !economyCurrency) {
                await ctx.reply({ text: '❌ Economy-Modul nicht verfügbar. Bitte Admin kontaktieren.', ephemeral: true });
                return;
            }

            const clientId = ctx.interaction.client.user.id;
            const botId = await jobs.resolveBotId(clientId);
            if (!botId) { await ctx.reply({ text: '❌ Bot nicht gefunden.', ephemeral: true }); return; }

            const employment = await jobs.getEmployment(botId, ctx.guild.id, ctx.user.id);
            if (!employment) {
                await ctx.reply({ text: '❌ Du hast keinen Job. Nimm zuerst einen mit `/job-accept` an.', ephemeral: true });
                return;
            }

            const job = await jobs.getJob(botId, employment.job_key);
            if (!job || !job.enabled) {
                await ctx.reply({ text: '❌ Dein Job existiert nicht mehr. Nimm einen neuen mit `/job-accept` an.', ephemeral: true });
                return;
            }

            if (employment.last_worked_at) {
                const elapsedMs = Date.now() - new Date(employment.last_worked_at).getTime();
                const remainingSec = job.cooldown_seconds - Math.floor(elapsedMs / 1000);
                if (remainingSec > 0) {
                    await ctx.reply({ text: `⏱️ Noch nicht bereit. Nächste Schicht in **${fmtDuration(remainingSec)}**.`, ephemeral: true });
                    return;
                }
            }

            const currency = await resolveCurrency(botId, job.currency_key);
            if (!currency) {
                await ctx.reply({ text: '⚙️ Für diesen Bot ist noch keine Currency eingerichtet.', ephemeral: true });
                return;
            }

            const pay = job.pay_min + Math.floor(Math.random() * (job.pay_max - job.pay_min + 1));
            await economyWrite.addBalance(botId, ctx.guild.id, ctx.user.id, pay, currency.currency_key, `work: ${job.job_key}`);
            await jobs.markWorked(botId, ctx.guild.id, ctx.user.id);
            const bal = await economyRead.getBalance(botId, ctx.guild.id, ctx.user.id, currency.currency_key);

            await ctx.reply({
                embeds: [{
                    color: 0x4ade80,
                    title: `${job.emoji} ${job.name}`,
                    description: `Du hast **${fmt(pay, currency)}** verdient!\nNeuer Kontostand: ${fmt(bal.balance, currency)}\nNächste Schicht in ${fmtDuration(job.cooldown_seconds)}.`,
                }],
            });
        },
    });

    bh.plugin.onEnable(async () => { bh.logger.info('Work Plugin aktiviert'); });
    bh.plugin.onDisable(async () => { bh.logger.info('Work Plugin deaktiviert'); });
};
