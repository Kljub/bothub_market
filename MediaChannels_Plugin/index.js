'use strict';

const channels = require('./lib/channels');

const MODE_LABELS = {
    media: 'Nur Medien (Bilder/Videos)',
    gif:   'Nur GIFs',
    emoji: 'Nur Emojis',
    text:  'Nur Text',
};

const MEDIA_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|mp4|mov|webm|avi)(\?\S*)?$/i;
const GIF_HOST_RE  = /(tenor\.com|giphy\.com)\/\S+/i;
const URL_RE        = /https?:\/\/\S+/;
// Unicode-Emoji-Heuristik: Extended_Pictographic deckt die meisten Standard-Emojis ab,
// plus ZWJ/Variation-Selector/Hauttonmodifikatoren für zusammengesetzte Emojis. Kein
// vollständiger Parser, aber für "ist diese Nachricht nur Emojis" ausreichend genau.
const CUSTOM_EMOJI_RE = /<a?:\w+:\d+>/g;
const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}|‍|️|[\u{1F3FB}-\u{1F3FF}]/gu;

function isEmojiOnly(content) {
    const trimmed = content.trim();
    if (!trimmed) return false;
    const stripped = trimmed.replace(CUSTOM_EMOJI_RE, '').replace(UNICODE_EMOJI_RE, '').trim();
    return stripped.length === 0;
}

function isAllowed(mode, message) {
    const atts = [...message.attachments.values()];
    const hasAttachment = atts.length > 0;
    const hasUrl = URL_RE.test(message.content);

    switch (mode) {
        case 'media':
            if (!hasAttachment) return false;
            return atts.every(a => (a.contentType || '').startsWith('image/') || (a.contentType || '').startsWith('video/') || MEDIA_EXT_RE.test(a.name || ''));
        case 'gif':
            if (hasAttachment) return atts.every(a => a.contentType === 'image/gif' || /\.gif(\?\S*)?$/i.test(a.name || ''));
            return GIF_HOST_RE.test(message.content);
        case 'emoji':
            return !hasAttachment && !hasUrl && isEmojiOnly(message.content);
        case 'text':
            return !hasAttachment && !hasUrl;
        default:
            return true;
    }
}

module.exports = async function (bh) {
    bh.logger.info('Media Channel Plugin geladen');

    bh.events.on('message.created', async (payload) => {
        if (payload.author?.bot) return;
        if (!payload.guild || !payload.channel) return;

        // payload.botId ist bereits die interne Bot-ID (siehe event-bus.js attachDiscordClient) —
        // kein client_id-Lookup nötig, anders als in den Dashboard-seitigen PHP-Handlern.
        const rule = await channels.getRuleForChannel(payload.botId, payload.channel.id);
        if (!rule) return;

        let message;
        try {
            message = await bh.messaging.get(payload.channel.id, payload.id);
        } catch (_) { return; }
        if (!message) return;

        if (isAllowed(rule.mode, message)) return;

        try {
            await bh.messaging.delete(payload.channel.id, payload.id);
        } catch (e) {
            bh.logger.warn(`Media Channel: Löschen fehlgeschlagen: ${e.message}`);
            return;
        }

        try {
            const warn = await bh.messaging.send(payload.channel.id, {
                text: `❌ <@${payload.author.id}>, in diesem Channel ist nur **${MODE_LABELS[rule.mode]}** erlaubt.`,
            });
            bh.scheduler.after(6_000, async () => {
                try { await bh.messaging.delete(payload.channel.id, warn.id); } catch (_) {}
            });
        } catch (_) {}
    });

    bh.plugin.onEnable(async () => { bh.logger.info('Media Channel Plugin aktiviert'); });
    bh.plugin.onDisable(async () => { bh.logger.info('Media Channel Plugin deaktiviert'); });
};
