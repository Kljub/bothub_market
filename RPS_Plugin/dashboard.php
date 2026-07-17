<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'RPS',
    'icon'    => 'scissors',
    'route'   => '/dashboard/plugins/rps-plugin/commands',
    'section' => 'PLUGINS',
    'order'   => 170,
]);

$bh->dashboard->page->register('commands', [
    'title'  => 'RPS — Commands',
    'icon'   => 'scissors',
    'render' => 'pages/commands.php',
]);
