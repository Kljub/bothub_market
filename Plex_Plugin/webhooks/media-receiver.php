<?php
declare(strict_types=1);
if (!defined('BH_ROOT')) exit;

/**
 * Plex media webhook relay — Core is not reachable from the public internet, so
 * this PHP endpoint (public per plugin-routes.php) receives the real Plex Pass
 * webhook, verifies the per-bot secret (URL path segment, set via /webhooks/plex/media/{secret}),
 * and forwards the payload to Core's internal /webhooks/plex/media route.
 * See plugins/plex/lib/webhook-handlers.js for the Core-side handler + payload contract.
 */

header('Content-Type: application/json');

$secret = trim((string)($matched['_suffix'] ?? ''), '/');
if ($secret === '') {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Missing webhook secret']);
    exit;
}

$db   = bh_db();
$stmt = $db->prepare('SELECT client_id FROM plugin_plex_settings WHERE webhook_secret = ? LIMIT 1');
$stmt->execute([$secret]);
$row = $stmt->fetch();
if (!$row) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Invalid webhook secret']);
    exit;
}
$clientId = (string)$row['client_id'];

// Plex sends multipart/form-data with a JSON-encoded 'payload' field (thumbnails, if
// any, arrive as a separate 'thumb' file field which we don't forward) — plain
// application/json bodies are supported too, in case a proxy/test client sends one.
$rawBody     = file_get_contents('php://input') ?: '';
$plexPayload = json_decode($rawBody, true);
if (!is_array($plexPayload) && isset($_POST['payload'])) {
    $plexPayload = json_decode((string)$_POST['payload'], true);
}
if (!is_array($plexPayload)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid payload']);
    exit;
}

$coreUpstream = getenv('CORE_UPSTREAM') ?: 'core:3000';
$body         = json_encode(['clientId' => $clientId, 'plex' => $plexPayload]);

$ctx = stream_context_create(['http' => [
    'method'        => 'POST',
    'header'        => "Authorization: Bearer " . BH_APP_KEY . "\r\nContent-Type: application/json\r\n",
    'content'       => $body,
    'timeout'       => 8,
    'ignore_errors' => true,
]]);
@file_get_contents("http://{$coreUpstream}/webhooks/plex/media", false, $ctx);

// Always 200 regardless of forwarding outcome — Plex retries aggressively on non-2xx,
// and a transient Core hiccup shouldn't cause Plex to hammer this endpoint.
echo json_encode(['ok' => true]);
