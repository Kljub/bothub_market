<?php
declare(strict_types=1);

// Auto-discovered by web/routes/router.php (glob over plugins/*/plugin-routes.php).
// Both routes are intentionally public (no 'guard' key): the link page is opened
// from a Discord message before the user is necessarily logged into the
// dashboard, and the webhook receivers are hit by Plex/Overseerr directly.

return [
    'exact' => [
        '/plex/discord-link' => ['file' => '/../plugins/plex/web/discord-link.php'],
    ],
    'prefix' => [
        '/webhooks/plex/media/'     => ['file' => '/../plugins/plex/webhooks/media-receiver.php'],
        '/webhooks/plex/overseerr/' => ['file' => '/../plugins/plex/webhooks/overseerr-receiver.php'],
    ],
];
