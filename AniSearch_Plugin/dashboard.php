<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'AniSearch',
    'icon'    => 'movie',
    'route'   => '/dashboard/plugins/anisearch-plugin/config',
    'section' => 'PLUGINS',
    'order'   => 168,
]);

$bh->dashboard->page->register('config', [
    'title'  => 'AniSearch — Einstellungen',
    'icon'   => 'movie',
    'render' => 'pages/config.php',
]);
