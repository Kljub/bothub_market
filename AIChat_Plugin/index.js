'use strict';

const path = require('path');

const PROVIDER_DEFAULTS = {
    openai:    { base_url: 'https://api.openai.com/v1',           model: 'gpt-4o-mini' },
    nvidia:    { base_url: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.1-70b-instruct' },
    anthropic: { base_url: 'https://api.anthropic.com/v1',        model: 'claude-haiku-4-5-20251001' },
    groq:      { base_url: 'https://api.groq.com/openai/v1',      model: 'llama-3.1-8b-instant' },
    ollama:    { base_url: 'http://localhost:11434/v1',           model: 'llama3' },
    custom:    { base_url: '',                                     model: '' },
};

// ── Raw DB access for plugin-fremde Tabellen (bots, bot_module_states) ─────────
// bh.database.table(...) kann nur auf plugin-eigene, prefixte Tabellen zugreifen.
// Für Command-Permission-Checks und clientId-Auflösung brauchen wir Zugriff auf
// die geteilten BotHub-Tabellen — gleiches Muster wie arcenciel-plugin/index.js.
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

async function getClientId(botId) {
    const dbQuery = getDbQuery();
    if (!dbQuery) return null;
    try {
        const rows = await dbQuery('SELECT client_id FROM bots WHERE id = ? LIMIT 1', [botId]);
        return rows[0]?.client_id ?? null;
    } catch (_) {
        return null;
    }
}

async function getBotId(clientId) {
    const dbQuery = getDbQuery();
    if (!dbQuery) return null;
    try {
        const rows = await dbQuery('SELECT id FROM bots WHERE client_id = ? LIMIT 1', [clientId]);
        return rows[0]?.id ?? null;
    } catch (_) {
        return null;
    }
}

// ── Discord-Presence lesbar formatieren (Status + Aktivitäten) ────────────────
const PRESENCE_STATUS_LABELS = { online: 'Online', idle: 'Abwesend', dnd: 'Nicht stören', invisible: 'Unsichtbar', offline: 'Offline' };
const ACTIVITY_TYPE_LABELS   = { 0: 'spielt', 1: 'streamt', 2: 'hört', 3: 'schaut', 5: 'tritt an in' }; // 4 = Custom Status, gesondert behandelt

function formatPresence(presence) {
    if (!presence) return 'Offline / unbekannt';
    const status = PRESENCE_STATUS_LABELS[presence.status] || presence.status || 'unbekannt';
    const activities = (presence.activities || []).map(a => {
        if (a.type === 4) return a.state ? `Status: "${a.state}"` : null; // Custom Status Text
        const verb = ACTIVITY_TYPE_LABELS[a.type];
        if (!verb) return null;
        return `${verb} ${a.name}${a.details ? ` (${a.details})` : ''}`;
    }).filter(Boolean);
    return activities.length ? `${status} — ${activities.join(', ')}` : status;
}

// ── Heutige Bot-Aktivität: Verwarnungen aus BotHub-eigener Tabelle + Bans/Kicks
// aus dem Discord-Audit-Log (nur Einträge, wo DIESER Bot der Executor ist). Braucht
// die Berechtigung "Audit-Log anzeigen" für den Bot in der Guild — fehlt sie, wird
// das transparent im Kontext vermerkt statt Zahlen zu erfinden. ──────────────────
async function getTodayStats(bh, botId, guildId, clientId) {
    const dbQuery = getDbQuery();
    let warningsToday = 0;
    if (dbQuery && botId) {
        try {
            const rows = await dbQuery(
                'SELECT COUNT(*) AS c FROM bot_warnings WHERE bot_id = ? AND created_at >= CURDATE()',
                [botId]
            );
            warningsToday = Number(rows[0]?.c ?? 0);
        } catch (_) {}
    }

    let bansToday = 0, kicksToday = 0, auditNote = '';
    if (guildId && clientId) {
        try {
            const todayStartMs = new Date().setHours(0, 0, 0, 0);
            const [bans, kicks] = await Promise.all([
                bh.guilds.fetchAuditLog(guildId, { type: 'MemberBanAdd', limit: 100 }),
                bh.guilds.fetchAuditLog(guildId, { type: 'MemberKick',   limit: 100 }),
            ]);
            bansToday  = bans.filter(e => e.executorId === clientId && e.createdTimestamp >= todayStartMs).length;
            kicksToday = kicks.filter(e => e.executorId === clientId && e.createdTimestamp >= todayStartMs).length;
        } catch (_) {
            auditNote = ' (Bans/Kicks unbekannt — Bot fehlt die Berechtigung "Audit-Log anzeigen")';
        }
    }

    return `${warningsToday} Verwarnung(en), ${bansToday} Bann(e), ${kicksToday} Kick(s) heute${auditNote}`;
}

function buildStatusContext({ botPresence, userPresence, username, statsLine }) {
    const lines = [];
    lines.push(`[Bot-Status: ${formatPresence(botPresence)}]`);
    if (userPresence !== undefined) lines.push(`[Status von ${username || 'User'}: ${formatPresence(userPresence)}]`);
    if (statsLine) lines.push(`[Bot-Aktivität heute: ${statsLine}]`);
    return lines.join('\n');
}

// ── Permission Check (Command-Toggle + allowed/banned roles/channels) ─────────
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
        const rows = await dbQuery(
            'SELECT enabled, settings FROM bot_module_states WHERE bot_id = ? AND module_key = ? LIMIT 1',
            [botId, moduleKey]
        );
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

const MENTION_MODULE_KEY = 'aichat:mention';

// ── Permission Check für @Mention-Antworten (gleiches Regelwerk wie checkCmd,
// aber ohne Slash-Command-Interaction — Rollen/Berechtigungen kommen daher aus dem
// rohen discord.js-Message-Objekt via bh.messaging.get() statt ctx.interaction.member.
// Kein Fehl-Reply bei Ablehnung — eine gefilterte Mention bleibt einfach stumm,
// gleiches Verhalten wie der bisherige Channel-Filter. ──────────────────────────
async function checkMentionPerms(bh, payload) {
    const dbQuery = getDbQuery();
    if (!dbQuery) return true;

    let row;
    try {
        const rows = await dbQuery(
            'SELECT settings FROM bot_module_states WHERE bot_id = ? AND module_key = ? LIMIT 1',
            [payload.botId, MENTION_MODULE_KEY]
        );
        row = rows[0];
    } catch (_) {}
    if (!row) return true;

    let cfg = {};
    try { cfg = typeof row.settings === 'string' ? JSON.parse(row.settings) : (row.settings ?? {}); } catch (_) {}

    const bannedChannels      = cfg.banned_channels      ?? [];
    const requiredPermissions = cfg.required_permissions ?? [];
    const bannedRoles         = cfg.banned_roles         ?? [];
    const allowedRoles        = cfg.allowed_roles        ?? [];

    if (bannedChannels.includes(payload.channel?.name ?? '')) return false;
    if (!requiredPermissions.length && !bannedRoles.length && !allowedRoles.length) return true;

    // Rollen/Berechtigungen brauchen das volle GuildMember — nur bei Bedarf holen,
    // damit der Channel-only-Fall (der häufigste) ohne Extra-API-Call auskommt.
    let member;
    try {
        const fullMsg = await bh.messaging.get(payload.channel.id, payload.id);
        member = fullMsg?.member;
    } catch (_) {}
    if (!member) return true; // Member nicht auflösbar — nicht blockieren

    const memberRoles = member.roles?.cache?.map(r => r.name) ?? [];

    for (const perm of requiredPermissions) {
        if (!member.permissions?.has(perm)) return false;
    }
    if (bannedRoles.length && bannedRoles.some(r => memberRoles.includes(r))) return false;
    if (allowedRoles.length && !allowedRoles.some(r => memberRoles.includes(r))) return false;
    return true;
}

// ── Web-Suche: Brave → SearXNG → DuckDuckGo Kaskade ───────────────────────────
async function webSearch(query, { braveApiKey = '', searxngUrl = '' } = {}) {
    const q = encodeURIComponent(query);

    if (braveApiKey) {
        try {
            const resp = await fetch(
                `https://api.search.brave.com/res/v1/web/search?q=${q}&count=4`,
                { headers: { 'Accept': 'application/json', 'X-Subscription-Token': braveApiKey } }
            );
            if (resp.ok) {
                const data = await resp.json();
                const results = (data.web?.results || []).slice(0, 4).map(r => ({
                    title: r.title, snippet: r.description || '', url: r.url,
                }));
                if (results.length) return results;
            }
        } catch (_) {}
    }

    if (searxngUrl) {
        try {
            const base = searxngUrl.replace(/\/$/, '');
            const resp = await fetch(
                `${base}/search?q=${q}&format=json&categories=general`,
                { headers: { 'Accept': 'application/json', 'User-Agent': 'BotHub/1.0' } }
            );
            if (resp.ok) {
                const data = await resp.json();
                const results = (data.results || []).slice(0, 4).map(r => ({
                    title: r.title || '', snippet: r.content || '', url: r.url || '',
                }));
                if (results.length) return results;
            }
        } catch (_) {}
    }

    try {
        const resp = await fetch(
            `https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`,
            { headers: { 'User-Agent': 'BotHub/1.0' } }
        );
        if (!resp.ok) return [];
        const data = await resp.json();
        const results = [];
        if (data.AbstractText) {
            results.push({ title: data.Heading || query, snippet: data.AbstractText, url: data.AbstractURL });
        }
        for (const r of (data.RelatedTopics || [])) {
            if (r.Text && results.length < 4) {
                results.push({ title: r.Text.split(' - ')[0] || '', snippet: r.Text, url: r.FirstURL || '' });
            }
        }
        return results;
    } catch (_) {
        return [];
    }
}

function buildSearchContext(query, results) {
    if (!results.length) return `[Websuche für "${query}" lieferte keine Ergebnisse]`;
    const lines = results.map((r, i) =>
        `${i + 1}. **${r.title}**\n   ${r.snippet}${r.url ? `\n   ${r.url}` : ''}`
    );
    return `[Websuche: "${query}"]\n${lines.join('\n\n')}`;
}

// ── Konversations-Historie (persistiert statt In-Memory) ──────────────────────
async function loadHistory(bh, clientId, userId, historyLength, timeoutMin) {
    const limit = Math.max(1, historyLength) * 2;
    let rows;
    try {
        rows = await bh.database.table('history')
            .where({ client_id: clientId, user_id: userId })
            .orderBy('created_at', 'desc')
            .limit(limit)
            .findAll();
    } catch (_) {
        return [];
    }
    if (!rows.length) return [];

    const newest = new Date(rows[0].created_at).getTime();
    if (Date.now() - newest > timeoutMin * 60_000) return [];

    return rows.reverse().map(r => ({ role: r.role, content: r.content }));
}

async function saveExchange(bh, clientId, userId, userMessage, answer) {
    try {
        await bh.database.table('history').insert({
            client_id: clientId, user_id: userId, role: 'user', content: userMessage.slice(0, 60000),
        });
        await bh.database.table('history').insert({
            client_id: clientId, user_id: userId, role: 'assistant', content: answer.slice(0, 60000),
        });
    } catch (_) {}
}

// ── AI-Anbieter aufrufen ───────────────────────────────────────────────────────
// botPresence/userPresence/username werden vom Aufrufer übergeben (nur der hat
// Zugriff auf das Interaction-/Message-Objekt) — ob sie tatsächlich verwendet
// werden, entscheidet hier zentral settings.status_context_enabled (Dashboard-Toggle).
async function askAI(bh, clientId, userId, userMessage, { useWeb = false, botId = null, guildId = null, botPresence = null, userPresence = undefined, username = '' } = {}) {
    const settings = await bh.database.table('settings').findOne({ client_id: clientId });
    if (!settings) throw new Error('Kein AI-Anbieter konfiguriert. Bitte im Dashboard unter „AI Chat" einrichten.');

    const provider     = settings.active_provider || 'openai';
    const providerRow  = (await bh.database.table('providers').findOne({ client_id: clientId, provider })) || {};
    const defaults     = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.custom;
    const baseUrl      = (providerRow.base_url || defaults.base_url || '').replace(/\/$/, '');
    const model        = providerRow.selected_model || defaults.model || '';
    const apiKey       = providerRow.api_key || '';

    if (!baseUrl) throw new Error('Kein AI-Anbieter konfiguriert.');
    if (!model)   throw new Error('Kein Modell ausgewählt.');

    const historyLength = Number(settings.history_length)      || 10;
    const timeoutMin    = Number(settings.session_timeout_min) || 30;
    const webEnabled    = Boolean(settings.web_search_enabled);
    const webAlways     = Boolean(settings.web_search_always);
    const shouldSearch  = webEnabled && (useWeb || webAlways);

    // System-Prompt getrennt von der Konversation aufbauen (Anthropic erwartet
    // "system" als eigenes Top-Level-Feld, nicht als Message mit role:"system").
    // Positiv-/Negativ-Prompt bauen die Persona: getrennte Felder statt alles in
    // system_prompt zu mischen, damit man Verhalten (positiv) und Tabus (negativ)
    // unabhängig voneinander pflegen kann.
    let systemPrompt = (settings.system_prompt || '').trim();
    const positivePrompt = (settings.positive_prompt || '').trim();
    const negativePrompt = (settings.negative_prompt || '').trim();
    if (positivePrompt) systemPrompt = systemPrompt ? `${systemPrompt}\n\nVerhalte dich so: ${positivePrompt}` : `Verhalte dich so: ${positivePrompt}`;
    if (negativePrompt) systemPrompt = systemPrompt ? `${systemPrompt}\n\nVermeide unbedingt Folgendes: ${negativePrompt}` : `Vermeide unbedingt Folgendes: ${negativePrompt}`;

    if (shouldSearch) {
        const results = await webSearch(userMessage, {
            braveApiKey: settings.brave_api_key || '',
            searxngUrl:  settings.searxng_url   || '',
        }).catch(() => []);
        const ctx = buildSearchContext(userMessage, results);
        const searchNote = `Nutze folgende aktuelle Websuche-Ergebnisse für deine Antwort:\n\n${ctx}`;
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${searchNote}` : searchNote;
    }

    if (settings.status_context_enabled) {
        const statsLine = await getTodayStats(bh, botId, guildId, clientId);
        const statusContext = buildStatusContext({ botPresence, userPresence, username, statsLine });
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${statusContext}` : statusContext;
    }

    const history  = await loadHistory(bh, clientId, userId, historyLength, timeoutMin);
    const messages = [...history, { role: 'user', content: userMessage }];

    const maxTokens   = Number(settings.max_tokens) || 1000;
    const temperature = parseFloat(settings.temperature) || 0.7;

    const headers = { 'Content-Type': 'application/json' };
    let endpoint;
    let body;

    if (provider === 'anthropic') {
        headers['x-api-key']         = apiKey;
        headers['anthropic-version'] = '2023-06-01';
        endpoint = `${baseUrl}/messages`;
        body = JSON.stringify({
            model,
            messages,
            ...(systemPrompt ? { system: systemPrompt } : {}),
            max_tokens: maxTokens,
            temperature,
        });
    } else {
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
        endpoint = provider === 'ollama'
            ? `${baseUrl.replace(/\/v1\/?$/, '')}/v1/chat/completions`
            : `${baseUrl}/chat/completions`;
        body = JSON.stringify({
            model,
            messages: systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages,
            max_tokens: maxTokens,
            temperature,
        });
    }

    const resp = await fetch(endpoint, { method: 'POST', headers, body });
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`AI API Fehler ${resp.status}: ${text.slice(0, 200)}`);
    }

    const json = await resp.json();
    const answer = provider === 'anthropic'
        ? (json.content?.[0]?.text || '(keine Antwort)')
        : (json.choices?.[0]?.message?.content || '(keine Antwort)');

    await saveExchange(bh, clientId, userId, userMessage, answer);

    return answer;
}

// ── Plugin Entry ──────────────────────────────────────────────────────────────
module.exports = async function (bh) {
    bh.logger.info('AI Chat Plugin geladen');

    const askCommandDef = {
        name:        'ask',
        description: 'Stelle der KI eine Frage.',
        options: [
            { name: 'frage', description: 'Deine Frage an die KI',                type: 'string',  required: true },
            { name: 'web',   description: 'Aktuelle Web-Suche einbeziehen?',       type: 'boolean', required: false },
        ],
        async execute(ctx) {
            if (!await checkCmd(ctx, 'aichat:ask')) return;
            await ctx.defer(false);

            const clientId = ctx.interaction.client.user.id;
            const userId   = ctx.interaction.user?.id ?? '';
            const question = ctx.options.getString('frage', true);
            const useWeb   = ctx.options.getBoolean('web') ?? false;

            try {
                const botId = await getBotId(clientId);
                const answer = await askAI(bh, clientId, userId, question, {
                    useWeb, botId,
                    guildId:      ctx.interaction.guild?.id || null,
                    botPresence:  ctx.interaction.client.user.presence,
                    userPresence: ctx.interaction.member?.presence,
                    username:     ctx.interaction.user?.username || '',
                });
                const text   = answer.length > 1900 ? answer.slice(0, 1900) + '…' : answer;
                await ctx.editReply(text);
            } catch (err) {
                bh.logger.error(`AIChat /ask: ${err.message}`);
                await ctx.editReply(`❌ ${err.message}`);
            }
        },
    };

    bh.commands.register(askCommandDef);

    // Re-register on each bot start to ensure the command is always active
    bh.plugin.onBotStart(async () => {
        bh.commands.register(askCommandDef);
    });

    // Antworten des Bots erkennen wir am festen "🤖 "-Präfix (siehe send() unten) —
    // damit lösen nur AI-Chat-Antworten den Reply-Auto-Trigger aus, nicht Replies auf
    // Nachrichten anderer Plugins/Bots im selben Channel.
    const ANSWER_PREFIX = '🤖 ';

    // Reply auf eine eigene AI-Chat-Antwort erkennen — braucht das rohe discord.js-
    // Message-Objekt für .reference, die normalisierte SDK-Payload hat das Feld nicht.
    async function findReplyTarget(bh, payload, clientId) {
        try {
            const fullMsg = await bh.messaging.get(payload.channel.id, payload.id);
            const refId = fullMsg?.reference?.messageId;
            if (!refId) return null;
            const refMsg = await bh.messaging.get(payload.channel.id, refId);
            if (refMsg?.author?.id === clientId && (refMsg.content || '').startsWith(ANSWER_PREFIX)) {
                return refId;
            }
        } catch (_) {}
        return null;
    }

    // ── @Mention-Chat ───────────────────────────────────────────────────────────
    bh.events.on('message.created', async (payload) => {
        try {
            if (payload.author?.bot) return;

            const clientId = await getClientId(payload.botId);
            if (!clientId) return;

            const mentionPattern = new RegExp(`<@!?${clientId}>`);
            const isMentioned    = mentionPattern.test(payload.content || '');

            // Kein @Mention nötig, wenn der User direkt auf eine eigene AI-Chat-Antwort
            // des Bots antwortet (Discord-Reply) — fühlt sich sonst wie ein Bruch in der
            // Konversation an, weil man bei jeder Folgenachricht erneut mentionen müsste.
            let replyToId = null;
            if (!isMentioned) {
                replyToId = await findReplyTarget(bh, payload, clientId);
                if (!replyToId) return;
            }

            const settings = await bh.database.table('settings').findOne({ client_id: clientId });
            if (!settings?.mention_enabled) return;

            if (!await checkMentionPerms(bh, payload)) return;

            const question = (payload.content || '').replace(/<@!?\d+>/g, '').trim();
            if (!question) return;

            const useWeb = Boolean(settings.web_search_enabled && settings.web_search_always);

            // Presence nur holen, wenn der Dashboard-Toggle es tatsächlich braucht —
            // spart die Extra-API-Anfrage im Normalfall.
            let botPresence = null, userPresence, username = payload.author?.username || '';
            if (settings.status_context_enabled) {
                try {
                    const fullMsg = await bh.messaging.get(payload.channel.id, payload.id);
                    botPresence  = fullMsg?.client?.user?.presence ?? null;
                    userPresence = fullMsg?.member?.presence ?? null;
                } catch (_) {}
            }

            let answer;
            try {
                // payload.botId ist bereits die interne bots.id (siehe event-bus.js), keine
                // weitere Auflösung nötig — anders als bei /ask (dort nur client_id verfügbar).
                answer = await askAI(bh, clientId, payload.author.id, question, {
                    useWeb, botId: payload.botId, guildId: payload.guild?.id || null, botPresence, userPresence, username,
                });
            } catch (err) {
                answer = `❌ ${err.message}`;
            }

            const text = answer.length > 1900 ? answer.slice(0, 1900) + '…' : answer;
            await bh.messaging.send(payload.channel.id, {
                text: `${ANSWER_PREFIX}${text}`,
                ...(replyToId ? { replyTo: payload.id } : {}),
            });
        } catch (err) {
            bh.logger.error(`AIChat Mention-Handler: ${err.message}`);
        }
    });

    bh.plugin.onEnable(async () => {
        bh.logger.info('AI Chat Plugin aktiviert');
    });

    bh.plugin.onDisable(async () => {
        bh.logger.info('AI Chat Plugin deaktiviert');
    });
};
