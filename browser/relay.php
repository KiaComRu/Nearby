<?php
declare(strict_types=1);
require_once __DIR__ . '/automatic.php';

const RELAY_FRAME_MAX = 262200;
const RELAY_QUEUE_MAX = 1048576;

function relayTraffic(string $base, int $bytes, int $limit): void {
    $file = fopen($base . '/relay-traffic.json', 'c+');
    if (!$file || !flock($file, LOCK_EX)) throw new RuntimeException('Relay budget lock failed');
    try {
        $raw = stream_get_contents($file);
        $budget = $raw === '' ? ['day' => gmdate('Y-m-d'), 'bytes' => 0] : json_decode($raw, true, 8, JSON_THROW_ON_ERROR);
        if (($budget['day'] ?? null) !== gmdate('Y-m-d')) $budget = ['day' => gmdate('Y-m-d'), 'bytes' => 0];
        if (!is_int($budget['bytes'] ?? null) || $bytes < 0) throw new RuntimeException('Invalid relay budget');
        if ($budget['bytes'] + $bytes > $limit) fail(429, 'Дневной лимит интернет-режима исчерпан. Попробуйте завтра или используйте локальную сеть.');
        $budget['bytes'] += $bytes; writeState($file, $budget);
    } finally { flock($file, LOCK_UN); fclose($file); }
}

// Opportunistic janitor: frames are inaccessible after timeout; stale files are
// removed on the next API request, at most once per minute across PHP workers.
function relayCleanup(string $base, int $now): void {
    $lock = fopen($base . '/relay-cleanup.lock', 'c+');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) { if ($lock) fclose($lock); return; }
    try {
        $last = (int)stream_get_contents($lock);
        if ($now - $last < 60) return;
        rewind($lock); ftruncate($lock, 0); fwrite($lock, (string)$now); fflush($lock);
        foreach (glob($base . '/room-*.json') ?: [] as $path) {
            if (filemtime($path) > $now - 120) continue;
            $file = @fopen($path, 'r+');
            if (!$file) continue;
            if (flock($file, LOCK_EX | LOCK_NB)) {
                if (fstat($file)['mtime'] > $now - 120) { flock($file, LOCK_UN); fclose($file); continue; }
                $state = json_decode(stream_get_contents($file), true);
                if ($state && (usesRelay($state) || ($state['expires'] ?? 0) < $now)) {
                    // Remove ciphertext while the inode remains locked, then unlink.
                    ftruncate($file, 0); fflush($file); @unlink($path);
                }
                flock($file, LOCK_UN);
            }
            fclose($file);
        }
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}

function relayAction(string $action, array $input, array &$state, string $role, string $base, int $now, int $dailyLimit): array {
    if (!usesRelay($state) || !$state['approved']) fail(403, 'Интернет-передача доступна после подтверждения устройства.');
    if ($now - ($state['relayLast'][$role] ?? $now) > 120) fail(410, 'Интернет-подключение прервано. Создайте новое приглашение.');
    $state['relayLast'][$role] = $now;
    $other = $role === 'host' ? 'guest' : 'host';
    foreach ($state['relay'] as $direction) foreach ($direction['frames'] as $frame) {
        if ($now - $frame['created'] > 90) fail(410, 'Устройство долго не отвечает. Создайте новое подключение.');
    }
    if ($action === 'relay-pull') {
        $after = $input['after'] ?? null;
        if (!is_int($after) || $after < 0 || $after > $state['relay'][$other]['seq']) fail(400, 'Некорректное подтверждение интернет-передачи.');
        $direction = &$state['relay'][$other];
        $direction['frames'] = array_values(array_filter($direction['frames'], fn($frame) => $frame['seq'] > $after));
        $direction['ack'] = max($direction['ack'], $after);
        return ['frames' => array_map(fn($frame) => ['seq' => $frame['seq'], 'data' => $frame['data']], $direction['frames']), 'ack' => $direction['ack']];
    }
    $frames = $input['frames'] ?? null;
    if (!is_array($frames) || count($frames) < 1 || count($frames) > 8 || !array_is_list($frames)) fail(400, 'Некорректный пакет интернет-передачи.');
    $direction = $state['relay'][$role];
    $queued = array_sum(array_column($direction['frames'], 'size')); $added = 0;
    foreach ($frames as $frame) {
        if (!is_array($frame) || !is_int($frame['seq'] ?? null) || $frame['seq'] < 1 || $frame['seq'] > 9007199254740991 ||
            !is_string($frame['data'] ?? null) || strlen($frame['data']) > 349600) fail(400, 'Некорректная зашифрованная часть.');
        $bytes = base64_decode($frame['data'], true);
        if ($bytes === false || strlen($bytes) < 17 || strlen($bytes) > RELAY_FRAME_MAX || base64_encode($bytes) !== $frame['data']) fail(400, 'Некорректная зашифрованная часть.');
        $hash = hash('sha256', $frame['data']);
        if ($frame['seq'] <= $direction['seq']) {
            if (!isset($direction['recent'][$frame['seq']]) || !hash_equals($direction['recent'][$frame['seq']], $hash)) fail(409, 'Повторная часть отличается от исходной.');
            continue;
        }
        if ($frame['seq'] !== $direction['seq'] + 1) fail(409, 'Нарушен порядок частей интернет-передачи.');
        $size = strlen($bytes); $queued += $size; $added += $size;
        if ($queued > RELAY_QUEUE_MAX || count($direction['frames']) >= 32) fail(429, 'Получатель не успевает принимать данные. Оставьте оба устройства открытыми.');
        $direction['seq'] = $frame['seq'];
        $direction['recent'][$frame['seq']] = $hash;
        if (count($direction['recent']) > 16) unset($direction['recent'][array_key_first($direction['recent'])]);
        $direction['frames'][] = ['seq' => $frame['seq'], 'data' => $frame['data'], 'size' => $size, 'created' => $now];
    }
    if ($added > 0) relayTraffic($base, $added, $dailyLimit);
    $state['relay'][$role] = $direction;
    return ['seq' => $direction['seq']];
}
