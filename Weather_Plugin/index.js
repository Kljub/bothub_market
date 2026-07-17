'use strict';

const OWM_API = 'https://api.openweathermap.org/data/2.5/weather';

const WEATHER_EMOJIS = {
    Thunderstorm: '⛈️',
    Drizzle:      '🌦️',
    Rain:         '🌧️',
    Snow:         '❄️',
    Mist:         '🌫️',
    Smoke:        '🌫️',
    Haze:         '🌫️',
    Dust:         '🌪️',
    Fog:          '🌫️',
    Sand:         '🌪️',
    Ash:          '🌋',
    Squall:       '💨',
    Tornado:      '🌪️',
    Clear:        '☀️',
    Clouds:       '☁️',
};

function weatherEmoji(main) {
    return WEATHER_EMOJIS[main] ?? '🌡️';
}

function windDirection(degrees) {
    const dirs = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round(degrees / 45) % 8];
}

function formatTime(unix, offset) {
    const d = new Date((unix + offset) * 1000);
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
}

async function fetchWeather(location, apiKey, units) {
    const unitSymbol = units === 'imperial' ? '°F' : '°C';
    const speedUnit  = units === 'imperial' ? 'mph' : 'm/s';

    const url = `${OWM_API}?q=${encodeURIComponent(location)}&appid=${encodeURIComponent(apiKey)}&units=${units}&lang=de`;
    const res  = await fetch(url);

    if (res.status === 401) throw new Error('Ungültiger API-Key. Bitte in den Plugin-Einstellungen prüfen.');
    if (res.status === 404) throw new Error(`Ort **${location}** nicht gefunden. Tipp: Stadtname auf Englisch oder PLZ verwenden.`);
    if (!res.ok)            throw new Error(`OpenWeatherMap API-Fehler (HTTP ${res.status}).`);

    const d = await res.json();

    const emoji       = weatherEmoji(d.weather[0]?.main ?? '');
    const description = d.weather[0]?.description ?? '–';
    const temp        = `${d.main.temp.toFixed(1)}${unitSymbol}`;
    const feelsLike   = `${d.main.feels_like.toFixed(1)}${unitSymbol}`;
    const humidity    = `${d.main.humidity}%`;
    const windSpeed   = `${d.wind.speed} ${speedUnit} ${windDirection(d.wind.deg ?? 0)}`;
    const sunrise     = formatTime(d.sys.sunrise, d.timezone);
    const sunset      = formatTime(d.sys.sunset,  d.timezone);
    const cityName    = `${d.name}, ${d.sys.country}`;

    return {
        title:       `${emoji} Wetter für ${cityName}`,
        description: description.charAt(0).toUpperCase() + description.slice(1),
        color:       0x5865f2,
        fields: [
            { name: '🌡️ Temperatur',      value: `${temp} (gefühlt ${feelsLike})`, inline: true },
            { name: '💧 Luftfeuchtigkeit', value: humidity,                          inline: true },
            { name: '💨 Wind',             value: windSpeed,                         inline: true },
            { name: '🌅 Sonnenaufgang',    value: sunrise,                           inline: true },
            { name: '🌇 Sonnenuntergang',  value: sunset,                            inline: true },
        ],
        footer: { text: 'Daten von OpenWeatherMap' },
        timestamp: true,
    };
}

module.exports = async function (bh) {
    bh.logger.info('Weather Plugin geladen');

    const commandDef = {
        name:        'weather',
        description: 'Zeigt das aktuelle Wetter für einen Ort an.',
        options: [
            {
                name:        'location',
                description: 'Stadt oder PLZ (z.B. Berlin oder 10115)',
                type:        'string',
                required:    false,
            },
        ],
        async execute(ctx) {
            await ctx.defer();

            const clientId = ctx.interaction.client.user.id;

            const row    = await bh.database.table('settings').findOne({ client_id: clientId });
            const apiKey = (row?.api_key ?? '').trim();
            const units  = row?.units ?? 'metric';
            const defLoc = (row?.default_location ?? '').trim();

            const location = (ctx.options.getString('location') ?? '').trim() || defLoc;

            if (!apiKey) {
                await ctx.editReply('⚠️ Kein API-Key konfiguriert. Bitte das Weather Plugin im Dashboard einrichten.');
                return;
            }

            if (!location) {
                await ctx.editReply('⚠️ Bitte einen Ort angeben: `/weather Berlin` — oder Standard-Ort im Dashboard setzen.');
                return;
            }

            try {
                const embed = await fetchWeather(location, apiKey, units);
                await ctx.editReply({ embeds: [embed] });
            } catch (err) {
                bh.logger.warn(`Weather-Fehler (clientId ${clientId}): ${err.message}`);
                await ctx.editReply(`❌ ${err.message}`);
            }
        },
    };

    // Register now (works after setCommandManager; noop during early initialize())
    bh.commands.register(commandDef);

    // Re-register on each bot start to ensure the command is always active
    bh.plugin.onBotStart(async () => {
        bh.commands.register(commandDef);
    });

    bh.plugin.onEnable(async () => {
        bh.logger.info('Weather Plugin aktiviert');
    });

    bh.plugin.onDisable(async () => {
        bh.logger.info('Weather Plugin deaktiviert');
    });
};
