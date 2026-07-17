<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'Minesweeper',
    'icon'    => 'bomb',
    'route'   => '/dashboard/plugins/minesweeper-plugin/config',
    'section' => 'PLUGINS',
    'order'   => 140,
]);

$bh->dashboard->page->register('config', [
    'title'  => 'Minesweeper — Einstellungen',
    'icon'   => 'bomb',
    'render' => 'pages/config.php',
]);

$bh->dashboard->page->register('commands', [
    'title'  => 'Minesweeper — Commands',
    'icon'   => 'terminal-2',
    'render' => 'pages/commands.php',
]);
