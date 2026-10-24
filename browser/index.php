<?php
declare(strict_types=1);

// Only a public language code selects a fixed, generated HTML document.
// Invitations and encryption keys remain in URL fragments in the browser.
$requested = $_GET['lang'] ?? 'ru';
$language = is_string($requested) ? $requested : 'ru';
if ($language === 'zh-cn' || $language === 'zh-Hans') $language = 'zh-CN';
if (!in_array($language, ['ru', 'en', 'hi', 'zh-CN', 'es'], true)) $language = 'ru';
$document = $language === 'ru' ? __DIR__ . '/index.html' : __DIR__ . '/locales/' . $language . '.html';
header('Content-Type: text/html; charset=UTF-8');
header('Content-Language: ' . $language);
header('Cache-Control: no-cache');
readfile($document);
