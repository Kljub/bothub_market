<?php
declare(strict_types=1);
if (!defined('BH_ROOT')) exit;

require_once BH_ROOT . '/functions/modules/plex.php';

const PLEX_TV = 'https://plex.tv/api/v2';

function plex_link_curl(string $method, string $url, array $headers, ?string $body = null): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => $headers,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $raw  = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($raw === false) return ['ok' => false, 'status' => 0, 'data' => null];
    $data = json_decode((string)$raw, true);
    return ['ok' => $code >= 200 && $code < 300, 'status' => $code, 'data' => $data];
}

function plex_link_get_token_row(string $token): ?array
{
    $stmt = bh_db()->prepare(
        'SELECT * FROM plugin_plex_link_tokens WHERE token = ? AND used = 0 AND expires_at > NOW() LIMIT 1'
    );
    $stmt->execute([$token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    return $row ?: null;
}

// ── AJAX: PIN-Status prüfen + Link abschließen ──────────────────────────────
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    header('Content-Type: application/json; charset=utf-8');
    $token = trim((string)($_POST['token'] ?? ''));
    $row   = $token !== '' ? plex_link_get_token_row($token) : null;

    if (!$row) {
        echo json_encode(['ok' => false, 'error' => 'invalid_or_expired']);
        exit;
    }

    $pinRes = plex_link_curl('GET', PLEX_TV . '/pins/' . (int)$row['plex_pin_id'], [
        'Accept: application/json',
        'X-Plex-Client-Identifier: ' . $row['client_identifier'],
    ]);

    $authToken = $pinRes['data']['authToken'] ?? null;
    if (!$authToken) {
        echo json_encode(['ok' => true, 'linked' => false]);
        exit;
    }

    $userRes = plex_link_curl('GET', PLEX_TV . '/user', [
        'Accept: application/json',
        'X-Plex-Token: ' . $authToken,
    ]);
    if (!$userRes['ok'] || empty($userRes['data'])) {
        echo json_encode(['ok' => false, 'error' => 'plex_user_fetch_failed']);
        exit;
    }

    $plexUser  = $userRes['data'];
    $plexUuid  = (string)($plexUser['uuid'] ?? $plexUser['id'] ?? '');
    $plexName  = (string)($plexUser['username'] ?? '');
    $plexEmail = (string)($plexUser['email'] ?? '');

    bh_db()->prepare(
        'INSERT INTO plugin_plex_accounts (discord_user_id, plex_uuid, plex_username, plex_email, access_token_enc, linked_at)
         VALUES (?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
            plex_uuid = VALUES(plex_uuid), plex_username = VALUES(plex_username),
            plex_email = VALUES(plex_email), access_token_enc = VALUES(access_token_enc), linked_at = VALUES(linked_at)'
    )->execute([
        (string)$row['discord_user_id'], $plexUuid, $plexName, $plexEmail, bh_encrypt($authToken),
    ]);

    bh_db()->prepare('UPDATE plugin_plex_link_tokens SET used = 1 WHERE id = ?')->execute([$row['id']]);

    // Rollenvergabe läuft über den Core (Discord-Client existiert nur dort) —
    // via Queue-Worker, gleiches Muster wie sync_commands.
    $stmt = bh_db()->prepare('SELECT client_id FROM plugin_plex_guild_settings WHERE guild_id = ? LIMIT 1');
    // client_id ist nicht direkt auf dem Token gespeichert; über bots/guild_settings auflösen:
    $guildSettings = null;
    $bots = bh_db()->query('SELECT DISTINCT client_id FROM plugin_plex_guild_settings WHERE guild_id = ' . bh_db()->quote((string)$row['guild_id']))->fetchAll(PDO::FETCH_COLUMN, 0);
    foreach ($bots as $cid) {
        $gs = bh_plex_get_guild_settings((string)$cid, (string)$row['guild_id']);
        if ($gs) { $guildSettings = $gs; break; }
    }

    if ($guildSettings && !empty($guildSettings['role_id'])) {
        require_once BH_ROOT . '/functions/job-queue.php';
        bh_queue_job('sync', 'plex_link_complete', [
            'discord_user_id' => (string)$row['discord_user_id'],
            'guild_id'        => (string)$row['guild_id'],
            'role_id'         => (string)$guildSettings['role_id'],
        ]);
    }

    echo json_encode(['ok' => true, 'linked' => true, 'username' => $plexName]);
    exit;
}

// ── GET: Seite rendern ──────────────────────────────────────────────────────
$token = trim((string)($_GET['token'] ?? ''));
$row   = $token !== '' ? plex_link_get_token_row($token) : null;
$esc   = fn(string $s): string => htmlspecialchars($s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

if (!$row) {
    http_response_code(400);
    ?>
    <!doctype html><html><head><meta charset="utf-8"><title>Plex-Verknüpfung</title></head>
    <body style="font-family:sans-serif;text-align:center;padding:60px;">
        <h2>Link ungültig oder abgelaufen</h2>
        <p>Bitte führe <code>/link</code> in Discord erneut aus.</p>
    </body></html>
    <?php
    exit;
}

$authUrl = 'https://app.plex.tv/auth#?clientID=' . rawurlencode((string)$row['client_identifier'])
    . '&code=' . rawurlencode((string)$row['plex_pin_code'])
    . '&context%5Bdevice%5D%5Bproduct%5D=BotHub';
?>
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Plex-Verknüpfung — BotHub</title>
<style>
body { font-family: -apple-system, sans-serif; background:#1a1a1e; color:#e5e5e5; text-align:center; padding:60px 20px; }
a.btn { display:inline-block; background:#e5a00d; color:#111; font-weight:600; padding:12px 28px; border-radius:6px; text-decoration:none; margin-top:20px; }
#status { margin-top:24px; font-size:14px; color:#9a9a9a; }
</style>
</head>
<body>
    <h2>Plex-Account verknüpfen</h2>
    <p>Klicke auf den Button, melde dich bei Plex an und autorisiere den Zugriff. Diese Seite prüft danach automatisch, ob die Verknüpfung erfolgreich war.</p>
    <a class="btn" href="<?= $esc($authUrl) ?>" target="_blank" rel="noopener">Bei Plex anmelden</a>
    <div id="status">Warte auf Anmeldung…</div>

    <script>
    (function () {
        var token = <?= json_encode($token) ?>;
        var attempts = 0;
        function check() {
            attempts++;
            fetch(location.pathname, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: 'token=' + encodeURIComponent(token),
            }).then(function (r) { return r.json(); }).then(function (d) {
                var el = document.getElementById('status');
                if (d.ok && d.linked) {
                    el.textContent = '✅ Erfolgreich verknüpft als ' + (d.username || 'Plex-User') + ' — du kannst dieses Fenster schließen.';
                    return;
                }
                if (!d.ok) {
                    el.textContent = '❌ ' + (d.error === 'invalid_or_expired' ? 'Link abgelaufen — bitte /link erneut ausführen.' : 'Fehler beim Verknüpfen.');
                    return;
                }
                if (attempts < 90) setTimeout(check, 2000);
                else el.textContent = 'Zeitüberschreitung — bitte /link erneut ausführen.';
            }).catch(function () {
                if (attempts < 90) setTimeout(check, 2000);
            });
        }
        setTimeout(check, 3000);
    }());
    </script>
</body>
</html>
