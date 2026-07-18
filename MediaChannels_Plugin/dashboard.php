<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'Media Channel',
    'icon'    => 'photo',
    'route'   => '/dashboard/plugins/mediachannel-plugin/channels',
    'section' => 'PLUGINS',
    'order'   => 168,
]);

$bh->dashboard->page->register('channels', [
    'title'  => 'Media Channel — Channels',
    'icon'   => 'photo',
    'render' => 'pages/channels.php',
]);
