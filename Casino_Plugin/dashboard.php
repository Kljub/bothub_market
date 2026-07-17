<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'Casino',
    'icon'    => 'coin',
    'route'   => '/dashboard/plugins/casino-plugin/games',
    'section' => 'PLUGINS',
    'order'   => 130,
]);

$bh->dashboard->page->register('games', [
    'title'  => 'Casino — Spiele',
    'icon'   => 'coin',
    'render' => 'pages/games.php',
]);

$bh->dashboard->page->register('commands', [
    'title'  => 'Casino — Commands',
    'icon'   => 'terminal-2',
    'render' => 'pages/commands.php',
]);
