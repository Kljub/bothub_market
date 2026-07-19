<?php
declare(strict_types=1);

$bh->dashboard->sidebar->addItem([
    'label'   => 'Soundboard',
    'icon'    => 'volume',
    'route'   => '/dashboard/plugins/soundboard-plugin/sounds',
    'section' => 'PLUGINS',
    'order'   => 166,
]);

$bh->dashboard->page->register('sounds', [
    'title'  => 'Soundboard',
    'icon'   => 'volume',
    'render' => 'pages/sounds.php',
]);
