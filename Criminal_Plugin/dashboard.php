<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'Criminal',
    'icon'    => 'user-exclamation',
    'route'   => '/dashboard/plugins/criminal-plugin/config',
    'section' => 'PLUGINS',
    'order'   => 135,
]);

$bh->dashboard->page->register('config', [
    'title'  => 'Criminal — Einstellungen',
    'icon'   => 'user-exclamation',
    'render' => 'pages/config.php',
]);

$bh->dashboard->page->register('commands', [
    'title'  => 'Criminal — Commands',
    'icon'   => 'terminal-2',
    'render' => 'pages/commands.php',
]);
