<?php
declare(strict_types=1);

echo '<link rel="stylesheet" href="/assets/css/components-base.css?v=' . filemtime(BH_ROOT . '/assets/css/components-base.css') . '">';

$botId = (int)($context['botId'] ?? $_SESSION['current_bot_id'] ?? 0);
$db    = bh_db();
$csrf  = (string)($_SESSION['csrf_token'] ?? '');

$e = fn(string $v): string => htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

// ── Bot clientId ──────────────────────────────────────────────────────────────
$clientId = '';
if ($botId > 0) {
    try {
        $stmt = $db->prepare('SELECT client_id FROM bots WHERE id = ? LIMIT 1');
        $stmt->execute([$botId]);
        $clientId = (string)($stmt->fetchColumn() ?: '');
    } catch (Throwable) {}
}

// ── Load settings ─────────────────────────────────────────────────────────────
$defaults = [
    'active_provider' => 'openai', 'system_prompt' => '', 'positive_prompt' => '', 'negative_prompt' => '', 'max_tokens' => 1000, 'temperature' => 0.70,
    'history_length' => 10, 'session_timeout_min' => 30,
    'web_search_enabled' => 0, 'web_search_always' => 0, 'brave_api_key' => '', 'searxng_url' => '',
    'mention_enabled' => 0, 'status_context_enabled' => 0,
];
$settings = $defaults;

if ($clientId !== '') {
    try {
        $stmt = $db->prepare('SELECT * FROM plugin_aichat_plugin_settings WHERE client_id = ? LIMIT 1');
        $stmt->execute([$clientId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if ($row) $settings = array_merge($defaults, $row);
    } catch (Throwable) {}
}

// ── Load providers ────────────────────────────────────────────────────────────
$providers = [];
if ($clientId !== '') {
    try {
        $stmt = $db->prepare('SELECT * FROM plugin_aichat_plugin_providers WHERE client_id = ?');
        $stmt->execute([$clientId]);
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $providers[$row['provider']] = $row;
        }
    } catch (Throwable) {}
}

function prov(array $providers, string $key, string $field, string $default = ''): string {
    return (string)($providers[$key][$field] ?? $default);
}

$providerDefs = [
    'openai'    => ['label' => 'OpenAI',                    'default_url' => 'https://api.openai.com/v1',           'default_model' => 'gpt-4o-mini',                   'needs_key' => true,  'has_url' => false, 'has_ollama' => false],
    'nvidia'    => ['label' => 'NVIDIA / build.nvidia.com',  'default_url' => 'https://integrate.api.nvidia.com/v1', 'default_model' => 'meta/llama-3.1-70b-instruct',   'needs_key' => true,  'has_url' => false, 'has_ollama' => false],
    'anthropic' => ['label' => 'Anthropic (Claude)',         'default_url' => 'https://api.anthropic.com/v1',        'default_model' => 'claude-haiku-4-5-20251001',     'needs_key' => true,  'has_url' => false, 'has_ollama' => false],
    'groq'      => ['label' => 'Groq',                       'default_url' => 'https://api.groq.com/openai/v1',      'default_model' => 'llama-3.1-8b-instant',          'needs_key' => true,  'has_url' => false, 'has_ollama' => false],
    'ollama'    => ['label' => 'Ollama (lokal)',             'default_url' => 'http://localhost:11434/v1',           'default_model' => 'llama3',                        'needs_key' => false, 'has_url' => true,  'has_ollama' => true],
    'custom'    => ['label' => 'Custom (OpenAI-kompatibel)', 'default_url' => '',                                    'default_model' => '',                              'needs_key' => true,  'has_url' => true,  'has_ollama' => false],
];

$activeProvider = (string)($settings['active_provider'] ?? 'openai');
if (!isset($providerDefs[$activeProvider])) $activeProvider = 'openai';

// Geteilte Discord-Permission-Liste — genutzt vom Command-Gear (/ask) UND vom
// dauerhaft sichtbaren Permissions-panel bei @Mention-Antworten.
$discordPerms = [
    'Administrator'   => 'Administrator',
    'ManageGuild'     => 'Server verwalten',
    'ManageRoles'     => 'Rollen verwalten',
    'ManageChannels'  => 'Kanäle verwalten',
    'KickMembers'     => 'Mitglieder kicken',
    'BanMembers'      => 'Mitglieder bannen',
    'ManageMessages'  => 'Nachrichten verwalten',
    'ModerateMembers' => 'Mitglieder per Timeout sperren',
    'MuteMembers'     => 'Mitglieder stummschalten (Voice)',
    'ViewAuditLog'    => 'Audit-Log anzeigen',
    'ManageWebhooks'  => 'Webhooks verwalten',
    'ManageThreads'   => 'Threads verwalten',
];

// ── Seed and load /ask command state ──────────────────────────────────────────
$cmdKey = 'aichat:ask';
$cmdState = ['enabled' => true, 'settings' => []];
if ($botId > 0) {
    try {
        $db->prepare('INSERT IGNORE INTO bot_module_states (bot_id, module_key, enabled) VALUES (?, ?, 1)')
           ->execute([$botId, $cmdKey]);

        $stmt = $db->prepare('SELECT enabled, settings FROM bot_module_states WHERE bot_id = ? AND module_key = ? LIMIT 1');
        $stmt->execute([$botId, $cmdKey]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $cmdState = [
            'enabled'  => (bool)($row['enabled'] ?? true),
            'settings' => json_decode($row['settings'] ?? '{}', true) ?: [],
        ];
    } catch (Throwable) {}
}

// ── Seed and load @Mention permissions (Permissions-panel, dauerhaft sichtbar) ─
$mentionModuleKey = 'aichat:mention';
$mentionPermCfg   = [];
if ($botId > 0) {
    try {
        $db->prepare('INSERT IGNORE INTO bot_module_states (bot_id, module_key, enabled) VALUES (?, ?, 1)')
           ->execute([$botId, $mentionModuleKey]);

        $stmt = $db->prepare('SELECT settings FROM bot_module_states WHERE bot_id = ? AND module_key = ? LIMIT 1');
        $stmt->execute([$botId, $mentionModuleKey]);
        $mentionPermCfg = json_decode((string)($stmt->fetchColumn() ?: '{}'), true) ?: [];
    } catch (Throwable) {}
}

$hasKey       = !empty($providers[$activeProvider]['api_key']);
$hasBaseUrl   = !empty($providerDefs[$activeProvider]['has_url'] ? $providers[$activeProvider]['base_url'] ?? $providerDefs[$activeProvider]['default_url'] : true);
$isConfigured = $hasKey || $activeProvider === 'ollama';
$isMention    = !empty($settings['mention_enabled']);
$isWeb        = !empty($settings['web_search_enabled']);
$model        = prov($providers, $activeProvider, 'selected_model', $providerDefs[$activeProvider]['default_model']);
$historyLen   = (int)($settings['history_length'] ?? 10);
?>

<style>
.aic-stats {
    display: flex; gap: 12px; flex-wrap: wrap;
    background: var(--bg-secondary); border-radius: 8px;
    padding: 14px 16px; margin-bottom: 20px;
    border: 1px solid var(--border);
}
.aic-stat { flex: 1; min-width: 100px; text-align: center; }
.aic-stat__val { font-size: 16px; font-weight: 700; color: var(--text); word-break: break-word; }
.aic-stat__lbl { font-size: 11px; color: var(--text-muted); margin-top: 2px; }

.aic-key-row { display: flex; align-items: center; gap: 8px; }
.aic-key-row .bh-input { flex: 1; font-family: monospace; font-size: 13px; }
.aic-key-btn {
    flex-shrink: 0; background: none;
    border: 1px solid var(--border); border-radius: 6px;
    padding: 0 10px; height: 38px; cursor: pointer;
    color: var(--text-muted); display: flex; align-items: center;
    transition: border-color .15s, color .15s;
}
.aic-key-btn:hover { border-color: #7c3aed; color: #7c3aed; }
</style>

<?php if ($botId <= 0): ?>
    <div class="bh-alert bh-alert-error">Kein Bot ausgewählt.</div>
<?php else: ?>

<div id="aic-alert" class="bh-alert" style="display:none"></div>

<!-- Stats -->
<div class="aic-stats">
    <div class="aic-stat">
        <div class="aic-stat__val"><?= $e($providerDefs[$activeProvider]['label']) ?></div>
        <div class="aic-stat__lbl">Anbieter</div>
    </div>
    <div class="aic-stat">
        <div class="aic-stat__val"><?= $e($model ?: '—') ?></div>
        <div class="aic-stat__lbl">Modell</div>
    </div>
    <div class="aic-stat">
        <div class="aic-stat__val"><?= $historyLen ?></div>
        <div class="aic-stat__lbl">Verlauf (Msgs)</div>
    </div>
    <div class="aic-stat">
        <div class="aic-stat__val"><?= $isWeb ? 'An' : 'Aus' ?></div>
        <div class="aic-stat__lbl">Web-Suche</div>
    </div>
    <div class="aic-stat">
        <div class="aic-stat__val"><?= $isMention ? 'An' : 'Aus' ?></div>
        <div class="aic-stat__lbl">@Mention-Chat</div>
    </div>
</div>

<!-- ── Anbieter ──────────────────────────────────────────────────────────────── -->
<div class="bh-card" style="margin-bottom:20px">
    <div class="bh-card-title">🔑 Anbieter Konfiguration</div>
    <div class="bh-card-body">

        <div class="bh-form-group">
            <label class="bh-label" for="aic-active-provider">Aktiver Anbieter</label>
            <select id="aic-active-provider" class="bh-input" style="max-width:320px">
                <?php foreach ($providerDefs as $key => $def): ?>
                <option value="<?= $key ?>" <?= $activeProvider === $key ? 'selected' : '' ?>><?= $e($def['label']) ?></option>
                <?php endforeach; ?>
            </select>
            <div class="bh-hint">Dieser Anbieter wird für <code>/ask</code> und @Mention-Antworten verwendet.</div>
        </div>

        <?php foreach ($providerDefs as $key => $def): ?>
        <div class="bh-form-group aic-provider-block" id="aic-prov-<?= $key ?>" style="<?= $activeProvider !== $key ? 'display:none' : '' ?>;border-top:1px solid var(--border);padding-top:14px;margin-top:14px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
                <div class="bh-label" style="margin-bottom:0;font-size:14px"><?= $e($def['label']) ?></div>
                <?php if ($activeProvider === $key): ?>
                <span class="badge badge--active">Aktiv</span>
                <?php endif; ?>
            </div>

            <?php if ($def['needs_key']): ?>
            <div style="margin-bottom:10px">
                <label class="bh-label" for="aic-key-<?= $key ?>">API-Schlüssel</label>
                <div class="aic-key-row">
                    <input type="password" id="aic-key-<?= $key ?>" class="bh-input aic-api-key" data-provider="<?= $key ?>"
                        value="<?= $e(prov($providers, $key, 'api_key')) ?>" placeholder="sk-..." autocomplete="new-password">
                    <button type="button" class="aic-key-btn aic-key-toggle" data-target="aic-key-<?= $key ?>" title="Anzeigen / Verbergen">👁</button>
                </div>
                <div class="bh-hint">Leer lassen um den gespeicherten Schlüssel beizubehalten.</div>
            </div>
            <?php endif; ?>

            <?php if ($def['has_url']): ?>
            <div style="margin-bottom:10px">
                <label class="bh-label" for="aic-url-<?= $key ?>">Base URL</label>
                <input type="text" id="aic-url-<?= $key ?>" class="bh-input aic-base-url" data-provider="<?= $key ?>"
                    value="<?= $e(prov($providers, $key, 'base_url', $def['default_url'])) ?>" placeholder="<?= $e($def['default_url']) ?>">
            </div>
            <?php endif; ?>

            <div style="margin-bottom:10px">
                <label class="bh-label" for="aic-model-<?= $key ?>">Modell</label>
                <div style="display:flex;gap:8px">
                    <input type="text" id="aic-model-<?= $key ?>" class="bh-input aic-model" data-provider="<?= $key ?>"
                        value="<?= $e(prov($providers, $key, 'selected_model', $def['default_model'])) ?>"
                        placeholder="<?= $e($def['default_model']) ?>" style="flex:1">
                    <?php if ($def['has_ollama']): ?>
                    <button class="bh-btn bh-btn-primary bh-btn-sm aic-ollama-fetch" data-provider="<?= $key ?>" type="button" style="white-space:nowrap">Models laden</button>
                    <?php endif; ?>
                </div>
                <?php if ($def['has_ollama']): ?>
                <select id="aic-ollama-list-<?= $key ?>" class="bh-input aic-ollama-select" data-provider="<?= $key ?>" style="display:none;margin-top:8px">
                    <option value="">-- Modell wählen --</option>
                </select>
                <div class="bh-hint aic-ollama-status-<?= $key ?>"></div>
                <?php endif; ?>
            </div>

            <div style="display:flex;justify-content:flex-end;align-items:center;margin-top:16px">
                <button class="bh-btn bh-btn-primary aic-save-provider" data-provider="<?= $key ?>" type="button">Speichern</button>
                <span class="lv-save-msg aic-prov-msg-<?= $key ?>" style="margin-left:10px;font-size:12px"></span>
            </div>
        </div>
        <?php endforeach; ?>
    </div>
</div>

<!-- ── Allgemeine Einstellungen ──────────────────────────────────────────────── -->
<div class="bh-card" style="margin-bottom:20px">
    <div class="bh-card-title">⚙️ Allgemeine Einstellungen</div>
    <div class="bh-card-body">

        <div class="bh-form-group">
            <label class="bh-label" for="aic-system-prompt">System-Prompt <span style="font-weight:400;color:var(--text-muted)">— optional</span></label>
            <textarea id="aic-system-prompt" class="bh-input" rows="3" style="resize:vertical"
                placeholder="Du bist ein hilfreicher Assistent auf einem Discord-Server."><?= $e((string)($settings['system_prompt'] ?? '')) ?></textarea>
            <div class="bh-hint">Gibt der KI eine Rolle oder einen Kontext vor. Leer lassen für Standardverhalten.</div>
        </div>

        <div class="bh-form-group">
            <div style="display:flex;gap:12px;flex-wrap:wrap">
                <div style="flex:1;min-width:220px">
                    <label class="bh-label" for="aic-positive-prompt">Positiv-Prompt <span style="font-weight:400;color:var(--text-muted)">— optional, Persona</span></label>
                    <textarea id="aic-positive-prompt" class="bh-input" rows="3" style="resize:vertical"
                        placeholder="freundlich, humorvoll, antwortet immer auf Deutsch, nennt sich selbst 'Robo'"><?= $e((string)($settings['positive_prompt'] ?? '')) ?></textarea>
                    <div class="bh-hint">Verhalten/Eigenschaften, die die KI annehmen soll.</div>
                </div>
                <div style="flex:1;min-width:220px">
                    <label class="bh-label" for="aic-negative-prompt">Negativ-Prompt <span style="font-weight:400;color:var(--text-muted)">— optional, Persona</span></label>
                    <textarea id="aic-negative-prompt" class="bh-input" rows="3" style="resize:vertical"
                        placeholder="keine Beleidigungen, gibt nicht zu ein Sprachmodell zu sein, keine Emojis"><?= $e((string)($settings['negative_prompt'] ?? '')) ?></textarea>
                    <div class="bh-hint">Verhalten, das die KI unbedingt vermeiden soll.</div>
                </div>
            </div>
        </div>

        <div class="bh-form-group">
            <div style="display:flex;gap:12px;flex-wrap:wrap">
                <div style="flex:1;min-width:140px">
                    <label class="bh-label" for="aic-max-tokens">Max. Tokens</label>
                    <input type="number" id="aic-max-tokens" class="bh-input" value="<?= (int)($settings['max_tokens'] ?? 1000) ?>" min="1" max="8000">
                </div>
                <div style="flex:1;min-width:140px">
                    <label class="bh-label" for="aic-temperature">Temperature</label>
                    <input type="number" id="aic-temperature" class="bh-input" value="<?= number_format((float)($settings['temperature'] ?? 0.7), 2) ?>" min="0" max="2" step="0.05">
                </div>
            </div>
        </div>

        <div class="bh-form-group">
            <div style="display:flex;gap:12px;flex-wrap:wrap">
                <div style="flex:1;min-width:140px">
                    <label class="bh-label" for="aic-history-length">Verlauf (Nachrichten)</label>
                    <input type="number" id="aic-history-length" class="bh-input" value="<?= $historyLen ?>" min="1" max="50">
                    <div class="bh-hint">Wie viele Nachrichten sich die KI pro User merkt.</div>
                </div>
                <div style="flex:1;min-width:140px">
                    <label class="bh-label" for="aic-session-timeout">Session-Timeout (Minuten)</label>
                    <input type="number" id="aic-session-timeout" class="bh-input" value="<?= (int)($settings['session_timeout_min'] ?? 30) ?>" min="1" max="1440">
                    <div class="bh-hint">Nach dieser Inaktivität startet eine neue Konversation.</div>
                </div>
            </div>
        </div>

        <div class="lv-feature" style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--border)">
            <div>
                <div class="lv-feature__title" style="font-weight:600">Memory zurücksetzen</div>
                <div class="lv-feature__desc" style="font-size:12px;color:var(--text-muted)">Löscht die gespeicherte Konversations-Historie aller User für diesen Bot sofort.</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
                <button type="button" class="bh-btn bh-btn-danger" id="aic-reset-memory" style="white-space:nowrap">Memory löschen</button>
                <span class="lv-save-msg" id="aic-reset-memory-msg"></span>
            </div>
        </div>

        <div class="lv-feature" style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--border)">
            <div>
                <div class="lv-feature__title" style="font-weight:600">Status-Erkennung</div>
                <div class="lv-feature__desc" style="font-size:12px;color:var(--text-muted)">Gibt der KI Bot-Status/-Aktivität sowie Status/Aktivität des anfragenden Users als Kontext mit (z.B. "hört Spotify"). Zusätzlich: heutige Bot-Aktivität (Verwarnungen, Bans, Kicks — Bans/Kicks brauchen "Audit-Log anzeigen"-Berechtigung des Bots). Wird an den KI-Anbieter geschickt.</div>
            </div>
            <label class="bh-toggle">
                <input class="bh-toggle-input" type="checkbox" id="aic-status-context-enabled" <?= !empty($settings['status_context_enabled']) ? 'checked' : '' ?>>
                <span class="bh-toggle-track"><span class="bh-toggle-thumb"></span></span>
            </label>
        </div>

        <div class="lv-feature" style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--border)">
            <div>
                <div class="lv-feature__title" style="font-weight:600">Web Research</div>
                <div class="lv-feature__desc" style="font-size:12px;color:var(--text-muted)">Erlaubt Websuche über die <code>web</code>-Option beim <code>/ask</code>-Command.</div>
            </div>
            <label class="bh-toggle">
                <input class="bh-toggle-input" type="checkbox" id="aic-web-enabled" <?= $isWeb ? 'checked' : '' ?>>
                <span class="bh-toggle-track"><span class="bh-toggle-thumb"></span></span>
            </label>
        </div>

        <div class="lv-feature" id="aic-web-always-row" style="display:<?= $isWeb ? 'flex' : 'none' ?>;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--border)">
            <div>
                <div class="lv-feature__title" style="font-weight:600">Immer Web-Research nutzen</div>
                <div class="lv-feature__desc" style="font-size:12px;color:var(--text-muted)">Bei jeder Anfrage automatisch suchen — auch bei @Mentions.</div>
            </div>
            <label class="bh-toggle">
                <input class="bh-toggle-input" type="checkbox" id="aic-web-always" <?= !empty($settings['web_search_always']) ? 'checked' : '' ?>>
                <span class="bh-toggle-track"><span class="bh-toggle-thumb"></span></span>
            </label>
        </div>

        <div class="bh-form-group" id="aic-web-fields" style="display:<?= $isWeb ? 'block' : 'none' ?>;margin-top:12px">
            <label class="bh-label">Such-Anbieter & API Keys <span style="font-weight:400;color:var(--text-muted)">(optional — ohne Key wird DuckDuckGo verwendet)</span></label>
            <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
                <div>
                    <label class="bh-label" for="aic-brave-key" style="font-size:11px">Brave Search API Key</label>
                    <input type="password" id="aic-brave-key" class="bh-input" placeholder="BSA..." value="<?= $e((string)($settings['brave_api_key'] ?? '')) ?>">
                    <div class="bh-hint">Kostenloser Key unter search.brave.com/api</div>
                </div>
                <div>
                    <label class="bh-label" for="aic-searxng-url" style="font-size:11px">SearXNG Instance URL <span style="color:var(--text-muted)">(optional)</span></label>
                    <input type="text" id="aic-searxng-url" class="bh-input" placeholder="https://searxng.example.com" value="<?= $e((string)($settings['searxng_url'] ?? '')) ?>">
                </div>
            </div>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:16px">
            <button type="button" id="aic-save-general" class="bh-btn bh-btn-primary">Speichern</button>
            <span class="lv-save-msg" id="aic-general-msg" style="margin-left:10px"></span>
        </div>
    </div>
</div>

<!-- ── @Mention-Chat ─────────────────────────────────────────────────────────── -->
<div class="bh-card">
    <div class="bh-card-title">💬 @Mention-Antworten</div>
    <div class="bh-card-body">

        <div class="lv-feature" style="display:flex;align-items:center;justify-content:space-between;padding:12px 0">
            <div>
                <div class="lv-feature__title" style="font-weight:600">Aktiviert</div>
                <div class="lv-feature__desc" style="font-size:12px;color:var(--text-muted)">Bot antwortet, wenn er per @Mention in einem erlaubten Channel angesprochen wird.</div>
            </div>
            <label class="bh-toggle">
                <input class="bh-toggle-input" type="checkbox" id="aic-mention-enabled" <?= $isMention ? 'checked' : '' ?>>
                <span class="bh-toggle-track"><span class="bh-toggle-thumb"></span></span>
            </label>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:4px;padding-bottom:12px;border-bottom:1px solid var(--border)">
            <button type="button" id="aic-save-mention" class="bh-btn bh-btn-primary">Speichern</button>
            <span class="lv-save-msg" id="aic-mention-msg" style="margin-left:10px"></span>
        </div>
    </div>

    <!-- Permissions-panel dauerhaft sichtbar (nicht über Gear wie bei Commands) —
         steuert Erlaubte/Verbotene Channels, Rollen und Berechtigungen für @Mentions,
         gespeichert über bot_module_states (module_key 'aichat:mention'). -->
    <style>#perm-aichat-mention { display: block !important; }</style>
    <?php
    $permModuleKey    = $mentionModuleKey;
    $permPanelId      = 'perm-aichat-mention';
    $permCfg          = $mentionPermCfg;
    $permDiscordPerms = $discordPerms;
    require BH_ROOT . '/assets/features/permissions-panel.php';
    ?>
</div>

<!-- ── Commands ──────────────────────────────────────────────────────────────── -->
<div class="bh-card" style="margin-top:20px">
    <div class="bh-card-title">🎮 Commands</div>
    <?php
    $rowModuleKey    = (string)$cmdKey;
    $rowCmdCode      = '/ask';
    $rowOptions      = [
        ['label' => 'frage', 'required' => true,  'type' => 'string'],
        ['label' => 'web',   'required' => false, 'type' => 'boolean'],
    ];
    $rowDesc         = 'Stellt der KI eine Frage und postet die Antwort im Channel.';
    $rowEnabled      = (bool)$cmdState['enabled'];
    $rowPermCfg      = (array)$cmdState['settings'];
    $rowDiscordPerms = $discordPerms;
    require BH_ROOT . '/assets/features/module-command-row.php';
    ?>
</div>

<?php endif; ?>

<script>
(function () {
    // Kein <meta name="csrf-token"> im Layout vorhanden — Token kommt direkt aus der
    // PHP-Session, gleiches Muster wie window.BH_CSRF auf der Modules-Seite.
    var csrf = <?= json_encode($csrf) ?>;
    var API  = '/api/v1/plugins/aichat';

    function showAlert(type, msg) {
        var el = document.getElementById('aic-alert');
        if (!el) return;
        el.className = 'bh-alert bh-alert-' + (type === 'err' ? 'error' : type);
        el.textContent = msg;
        el.style.display = 'block';
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.style.display = 'none'; }, 4000);
    }

    function showMsg(el, ok, text) {
        if (!el) return;
        el.textContent = text;
        el.style.color = ok ? '#4ade80' : '#f87171';
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.textContent = ''; }, 3000);
    }

    function post(data) {
        return fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ csrf_token: csrf }, data)),
        }).then(function (r) { return r.json(); });
    }

    // ── Provider select visibility ────────────────────────────────────────────
    function updateProviderVisibility(active) {
        document.querySelectorAll('.aic-provider-block').forEach(function (el) {
            var prov = el.id.replace('aic-prov-', '');
            el.style.display = prov === active ? '' : 'none';
        });
    }
    var activeProviderSelect = document.getElementById('aic-active-provider');
    activeProviderSelect?.addEventListener('change', function () { updateProviderVisibility(this.value); });

    // ── API key show/hide ──────────────────────────────────────────────────────
    document.querySelectorAll('.aic-key-toggle').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var input = document.getElementById(this.dataset.target);
            if (input) input.type = input.type === 'password' ? 'text' : 'password';
        });
    });

    // ── Web search toggle shows/hides key fields + always-row ────────────────
    var webToggle    = document.getElementById('aic-web-enabled');
    var webFields    = document.getElementById('aic-web-fields');
    var webAlwaysRow = document.getElementById('aic-web-always-row');
    webToggle?.addEventListener('change', function () {
        webFields.style.display    = this.checked ? 'block' : 'none';
        webAlwaysRow.style.display = this.checked ? 'flex'  : 'none';
        if (!this.checked) document.getElementById('aic-web-always').checked = false;
    });

    // ── Save general settings ─────────────────────────────────────────────────
    document.getElementById('aic-save-general')?.addEventListener('click', function () {
        var msg = document.getElementById('aic-general-msg');
        post({
            action:              'save_settings',
            active_provider:     activeProviderSelect ? activeProviderSelect.value : 'openai',
            system_prompt:       document.getElementById('aic-system-prompt').value,
            positive_prompt:     document.getElementById('aic-positive-prompt').value,
            negative_prompt:     document.getElementById('aic-negative-prompt').value,
            max_tokens:          document.getElementById('aic-max-tokens').value,
            temperature:         document.getElementById('aic-temperature').value,
            history_length:      document.getElementById('aic-history-length').value,
            session_timeout_min: document.getElementById('aic-session-timeout').value,
            web_search_enabled:  document.getElementById('aic-web-enabled').checked ? 1 : 0,
            web_search_always:   document.getElementById('aic-web-always').checked ? 1 : 0,
            brave_api_key:       document.getElementById('aic-brave-key').value,
            searxng_url:         document.getElementById('aic-searxng-url').value,
            status_context_enabled: document.getElementById('aic-status-context-enabled').checked ? 1 : 0,
        }).then(function (r) {
            showMsg(msg, r.ok, r.ok ? '✓ Gespeichert' : '✗ ' + (r.error || 'Fehler'));
            showAlert(r.ok ? 'ok' : 'err', r.ok ? '✅ Einstellungen gespeichert.' : '❌ ' + (r.error || 'Fehler'));
        }).catch(function () { showMsg(msg, false, '✗ Netzwerkfehler'); });
    });

    // ── Save individual provider ──────────────────────────────────────────────
    // Speichern macht diesen Anbieter gleichzeitig aktiv (make_active) — vorher blieb
    // die "Aktiver Anbieter"-Auswahl wirkungslos, bis man zusätzlich unten in
    // "Allgemeine Einstellungen" auf Speichern klickte. Badge + Dropdown werden nach
    // Erfolg direkt im DOM aktualisiert, ohne Reload.
    document.querySelectorAll('.aic-save-provider').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var prov  = this.dataset.provider;
            var msgEl = document.querySelector('.aic-prov-msg-' + prov);
            post({
                action:         'save_provider',
                provider:       prov,
                api_key:        document.getElementById('aic-key-' + prov)?.value ?? '',
                base_url:       document.getElementById('aic-url-' + prov)?.value ?? '',
                selected_model: document.getElementById('aic-model-' + prov)?.value ?? '',
                make_active:    true,
            }).then(function (r) {
                showMsg(msgEl, r.ok, r.ok ? '✓ Gespeichert & aktiviert' : '✗ ' + (r.error || 'Fehler'));
                if (r.ok && r.active_provider) {
                    if (activeProviderSelect) activeProviderSelect.value = r.active_provider;
                    document.querySelectorAll('.aic-provider-block .badge--active').forEach(function (b) { b.remove(); });
                    var titleEl = document.querySelector('#aic-prov-' + r.active_provider + ' .bh-label');
                    if (titleEl) {
                        var badge = document.createElement('span');
                        badge.className = 'badge badge--active';
                        badge.textContent = 'Aktiv';
                        titleEl.parentNode.appendChild(badge);
                    }
                }
            }).catch(function () { showMsg(msgEl, false, '✗ Netzwerkfehler'); });
        });
    });

    // ── Ollama model fetch ─────────────────────────────────────────────────────
    // Dropdown wird sowohl per Klick auf "Models laden" befüllt als auch automatisch,
    // sobald Ollama als aktiver Anbieter gewählt wird bzw. beim Laden schon aktiv ist —
    // kein manueller Klick mehr nötig, um die Modell-Liste zu sehen.
    function fetchOllamaModels(prov, btn) {
        var urlInput = document.getElementById('aic-url-' + prov);
        var baseUrl  = (urlInput && urlInput.value) || 'http://localhost:11434';
        var tagsBase = baseUrl.replace(/\/v1\/?$/, '');
        var statusEl = document.querySelector('.aic-ollama-status-' + prov);
        var selectEl = document.getElementById('aic-ollama-list-' + prov);

        if (btn) { btn.disabled = true; btn.textContent = 'Laden…'; }
        if (statusEl) statusEl.textContent = 'Lade Modelle…';

        return post({ action: 'fetch_ollama_models', base_url: tagsBase }).then(function (r) {
            if (btn) { btn.disabled = false; btn.textContent = 'Models laden'; }
            if (!r.ok) {
                if (statusEl) statusEl.textContent = r.error || 'Fehler';
                return;
            }
            if (statusEl) statusEl.textContent = r.models.length + ' Modell(e) gefunden.';
            if (selectEl && r.models.length > 0) {
                var currentModel = document.getElementById('aic-model-' + prov)?.value || '';
                var sortedModels = r.models.slice().sort(function (a, b) { return a.localeCompare(b); });
                selectEl.innerHTML = '<option value="">-- Modell wählen --</option>';
                sortedModels.forEach(function (m) {
                    var opt = document.createElement('option');
                    opt.value = m; opt.textContent = m;
                    if (m === currentModel) opt.selected = true;
                    selectEl.appendChild(opt);
                });
                selectEl.style.display = '';
            }
        }).catch(function () {
            if (btn) { btn.disabled = false; btn.textContent = 'Models laden'; }
            if (statusEl) statusEl.textContent = 'Netzwerkfehler';
        });
    }

    // Change-Listener nur EINMAL pro Dropdown registrieren (nicht bei jedem Fetch neu),
    // sonst würde der Model-Input bei mehrfachem Laden mehrfach gesetzt.
    document.querySelectorAll('.aic-ollama-select').forEach(function (selectEl) {
        selectEl.addEventListener('change', function () {
            var prov       = this.dataset.provider;
            var modelInput = document.getElementById('aic-model-' + prov);
            if (modelInput && this.value) modelInput.value = this.value;
        });
    });

    document.querySelectorAll('.aic-ollama-fetch').forEach(function (btn) {
        btn.addEventListener('click', function () { fetchOllamaModels(this.dataset.provider, this); });
    });

    // Auto-Fetch: beim Laden, falls Ollama schon aktiv ist, UND jedes Mal wenn der
    // Anbieter-Select auf Ollama umgestellt wird.
    document.querySelectorAll('.aic-ollama-fetch').forEach(function (btn) {
        var prov = btn.dataset.provider;
        if (activeProviderSelect && activeProviderSelect.value === prov) fetchOllamaModels(prov, btn);
    });
    activeProviderSelect?.addEventListener('change', function () {
        var btn = document.querySelector('.aic-ollama-fetch[data-provider="' + this.value + '"]');
        if (btn) fetchOllamaModels(this.value, btn);
    });

    // ── Save mention settings ─────────────────────────────────────────────────
    document.getElementById('aic-save-mention')?.addEventListener('click', function () {
        var msg = document.getElementById('aic-mention-msg');
        post({
            action:           'save_mention_settings',
            mention_enabled:  document.getElementById('aic-mention-enabled').checked ? 1 : 0,
        }).then(function (r) {
            showMsg(msg, r.ok, r.ok ? '✓ Gespeichert' : '✗ ' + (r.error || 'Fehler'));
        }).catch(function () { showMsg(msg, false, '✗ Netzwerkfehler'); });
    });

    // ── Reset memory ───────────────────────────────────────────────────────────
    document.getElementById('aic-reset-memory')?.addEventListener('click', function () {
        var btn = this;
        var msg = document.getElementById('aic-reset-memory-msg');
        if (!confirm('Alle Gesprächsverläufe für diesen Bot löschen?')) return;
        btn.disabled = true;
        post({ action: 'reset_memory' }).then(function (r) {
            showMsg(msg, r.ok, r.ok ? '✓ Memory gelöscht' : '✗ ' + (r.error || 'Fehler'));
        }).catch(function () {
            showMsg(msg, false, '✗ Netzwerkfehler');
        }).finally(function () { btn.disabled = false; });
    });
})();
</script>
