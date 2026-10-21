<?php
declare(strict_types=1);

function usesRelay(array $state): bool {
    return ($state['mode'] ?? 'lan') === 'internet' || (($state['mode'] ?? '') === 'auto' && ($state['transport'] ?? '') === 'relay');
}

// Called while holding this room's exclusive lock. Creation uses nonblocking
// room locks, so taking create.lock here cannot deadlock another PHP worker.
function selectRelay(array &$state, string $base, string $room, int $now, $roomHandle): void {
    $global = fopen($base . '/create.lock', 'c+');
    if (!$global || !flock($global, LOCK_EX)) throw new RuntimeException('Transport lock failed');
    try {
        $active = 0;
        foreach (glob($base . '/room-*.json') ?: [] as $path) {
            if (basename($path) === 'room-' . $room . '.json') continue;
            $handle = @fopen($path, 'r');
            if (!$handle) continue;
            if (flock($handle, LOCK_SH | LOCK_NB)) {
                $other = json_decode(stream_get_contents($handle), true);
                if ($other && !($other['closed'] ?? false) && ($other['expires'] ?? 0) >= $now && usesRelay($other)) $active++;
                flock($handle, LOCK_UN);
            } else $active++; // Conservatively reserve capacity for a busy room.
            fclose($handle);
        }
        if ($active >= 20) fail(503, 'Интернет-режим сейчас занят. Попробуйте позже.');
        $empty = ['seq' => 0, 'ack' => 0, 'frames' => [], 'recent' => []];
        $state['relay'] = ['host' => $empty, 'guest' => $empty];
        $state['relayLast'] = ['host' => $now, 'guest' => $now];
        $state['transport'] = 'relay'; $state['messages'] = [];
        $state['expires'] = $now + 7200;
        // Persist the reservation before releasing the global capacity lock.
        writeState($roomHandle, $state);
    } finally { flock($global, LOCK_UN); fclose($global); }
}

function automaticTransport(array &$state, string $base, string $room, string $role, int $now, $roomHandle, string $event = 'status'): void {
    if (($state['mode'] ?? '') !== 'auto' || !$state['approved']) return;
    // A failed established direct channel may move to relay once. Late probe
    // votes cannot undo the choice or reinitialize an existing encrypted queue.
    if (($state['transport'] ?? '') === 'direct' && $event === 'direct-failed') { selectRelay($state, $base, $room, $now, $roomHandle); return; }
    if (($state['transport'] ?? '') !== 'probing') return;
    if (in_array($event, ['fallback', 'direct-failed'], true) || $now >= $state['probeDeadline']) { selectRelay($state, $base, $room, $now, $roomHandle); return; }
    if ($event === 'direct-ready') $state['directReady'][$role] = true;
    if (($state['directReady']['host'] ?? false) && ($state['directReady']['guest'] ?? false)) {
        $state['transport'] = 'direct'; $state['expires'] = $now + 7200;
    }
}
