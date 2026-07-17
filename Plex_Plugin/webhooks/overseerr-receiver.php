<?php
declare(strict_types=1);
if (!defined('BH_ROOT')) exit;

/**
 * Overseerr webhook relay — same purpose as media-receiver.php, for Overseerr's
 * "Webhook Notification Agent". The payload is forwarded unwrapped (no clientId):
 * plugins/plex/lib/webhook-handlers.js resolves the target user via the globally
 * unique overseerr request_id, not per bot, since a single Overseerr instance is
 * shared bot-wide by design (see context/plex-plugin.md decision 8).
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
if (!$stmt->fetch()) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'Invalid webhook secret']);
    exit;
}

$rawBody = file_get_contents('php://input') ?: '';
$payload = json_decode($rawBody, true);
if (!is_array($payload)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'Invalid payload']);
    exit;
}

$coreUpstream = getenv('CORE_UPSTREAM') ?: 'core:3000';

$ctx = stream_context_create(['http' => [
    'method'        => 'POST',
    'header'        => "Authorization: Bearer " . BH_APP_KEY . "\r\nContent-Type: application/json\r\n",
    'content'       => $rawBody,
    'timeout'       => 8,
    'ignore_errors' => true,
]]);
@file_get_contents("http://{$coreUpstream}/webhooks/plex/overseerr", false, $ctx);

echo json_encode(['ok' => true]);
