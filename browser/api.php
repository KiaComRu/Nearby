<?php
declare(strict_types=1);
umask(0077);
ini_set('display_errors', '0');
require_once __DIR__ . '/statistics.php';
require_once __DIR__ . '/relay.php';
require_once __DIR__ . '/automatic.php';
// LAN signaling or bounded, opaque encrypted frames in the explicit internet mode.
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

function reply(int $status, array $body): never {
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function fail(int $status, string $message): never { reply($status, ['error' => $message]); }
function hexToken(int $bytes = 32): string { return bin2hex(random_bytes($bytes)); }
function nameValue(mixed $value): string {
    if (!is_string($value) || !preg_match('//u', $value)) return 'Устройство';
    $clean = preg_replace('/[\x00-\x1f\x7f]/u', '', $value);
    preg_match('/^.{0,40}/us', $clean, $match);
    return $match[0] ?: 'Устройство';
}
function writeState($handle, array $state): void {
    rewind($handle); ftruncate($handle, 0);
    if (fwrite($handle, json_encode($state, JSON_THROW_ON_ERROR)) === false) throw new RuntimeException('State write failed');
    fflush($handle);
}

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'Используйте POST.');
    if (isset($_SERVER['HTTP_ORIGIN'])) {
        $origin = parse_url($_SERVER['HTTP_ORIGIN']);
        $host = $_SERVER['HTTP_HOST'] ?? '';
        $originHost = ($origin['host'] ?? '') . (isset($origin['port']) ? ':' . $origin['port'] : '');
        if ($originHost !== $host || !in_array($origin['scheme'] ?? '', ['http', 'https'], true)) fail(403, 'Другой источник запроса.');
    }
    if (strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0])) !== 'application/json') fail(415, 'Нужен JSON.');
    $bodyLimit = ($_GET['transport'] ?? '') === 'relay' ? 786432 : 49152;
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > $bodyLimit) fail(413, 'Слишком большой запрос.');
    $raw = file_get_contents('php://input', false, null, 0, $bodyLimit + 1);
    if (strlen($raw) > $bodyLimit) fail(413, 'Слишком большой запрос.');
    try { $input = json_decode($raw, true, 16, JSON_THROW_ON_ERROR); }
    catch (JsonException $e) { fail(400, 'Некорректный JSON.'); }
    if (!is_array($input)) fail(400, 'Некорректный запрос.');
    $action = $input['action'] ?? '';
    $relayRequest = in_array($action, ['relay-push', 'relay-pull'], true);
    if (!$relayRequest && strlen($raw) > 49152) fail(413, 'Слишком большой запрос.');
    $now = time();
    $config = is_file(__DIR__ . '/config.private.php') ? require __DIR__ . '/config.private.php' : [];
    $base = getenv('NEARBY_WEB_STATE_DIR') ?: ($config['stateDirectory'] ?? sys_get_temp_dir() . '/nearby-web-' . substr(hash('sha256', __DIR__), 0, 16));
    if (!is_dir($base) && !mkdir($base, 0700, true) && !is_dir($base)) throw new RuntimeException('State directory unavailable');
    $base = realpath($base);
    if (!$base || str_starts_with($base . '/', realpath(__DIR__) . '/')) throw new RuntimeException('Unsafe state path');
    relayCleanup($base, $now);

    // Per-address budget and bounded state, with lock shared by PHP workers.
    $budgetKey = hash('sha256', $_SERVER['REMOTE_ADDR'] ?? 'unknown');
    $budget = fopen($base . '/budget-' . $budgetKey . '.json', 'c+');
    if (!$budget || !flock($budget, LOCK_EX)) throw new RuntimeException('Rate limit lock failed');
    $rate = json_decode(stream_get_contents($budget), true) ?: ['window' => $now, 'requests' => 0, 'creates' => 0, 'relay' => 0];
    if ($now - $rate['window'] >= 60) $rate = ['window' => $now, 'requests' => 0, 'creates' => 0, 'relay' => 0];
    if ($relayRequest) $rate['relay'] = ($rate['relay'] ?? 0) + 1; else $rate['requests']++;
    if (in_array($action, ['create', 'local-session'], true)) $rate['creates']++;
    if ($action === 'resolve-id') $rate['idLookups'] = ($rate['idLookups'] ?? 0) + 1;
    writeState($budget, $rate); flock($budget, LOCK_UN); fclose($budget);
    if ($rate['requests'] > 240 || $rate['creates'] > 10 || ($rate['relay'] ?? 0) > 1800) fail(429, 'Слишком много запросов. Подождите минуту.');
    if ($action === 'resolve-id' && ($rate['idLookups'] ?? 0) > 12) fail(429, 'Слишком много попыток ввода ID. Подождите минуту.');

    if ($action === 'stats') reply(200, transferStatistics($base));
    if ($action === 'local-session') reply(201, ['token' => localStatisticsToken($base)]);
    if (in_array($action, ['record-local-transfer', 'record-local-usage'], true)) {
        $usage = $action === 'record-local-usage';
        if (!verifyLocalStatisticsToken($base, $input['token'] ?? null)) fail(403, 'Недействительный ключ статистики.');
        $id = $input['id'] ?? null; $size = $usage ? 0 : ($input['size'] ?? null); $completedAt = $input['completedAt'] ?? null;
        if (!is_string($id) || !preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/D', $id) ||
            !is_int($size) || $size < 0 || $size > 100 * 1024 ** 3 || !is_int($completedAt) ||
            !in_array($input['source'] ?? null, ['windows', 'local'], true)) fail(400, 'Некорректная передача.');
        if ($completedAt < $now - 7 * 86400 || $completedAt > $now + 60) fail(410, 'Срок отчёта истёк или время устройства некорректно.');
        $day = intdiv($completedAt, 86400);
        reply(200, transferStatistics($base, ['room' => ($usage ? 'local-usage-' : 'local-') . $day, 'id' => $id, 'size' => $size, 'kind' => $usage ? 'usage' : 'transfer',
            'expires' => ($day + 8) * 86400 + 60, 'limit' => 50000]));
    }

    if ($action === 'create') {
        $mode = $input['mode'] ?? 'lan';
        if (!in_array($mode, ['lan', 'internet', 'auto'], true)) fail(400, 'Некорректный режим соединения.');
        $idLookup = $input['idLookup'] ?? null;
        $idInviteDigest = $input['idInviteDigest'] ?? null;
        if ($idLookup !== null || $idInviteDigest !== null) {
            if (!is_string($idLookup) || !preg_match('/^[a-f0-9]{64}$/D', $idLookup) ||
                !is_string($idInviteDigest) || !preg_match('/^[a-f0-9]{64}$/D', $idInviteDigest)) fail(400, 'Некорректный ID приглашения.');
        }
        $global = fopen($base . '/create.lock', 'c+');
        if (!$global || !flock($global, LOCK_EX)) throw new RuntimeException('Creation lock failed');
        $active = 0; $internetActive = 0;
        foreach (glob($base . '/room-*.json') ?: [] as $path) {
            $f = fopen($path, 'r+');
            if (!$f) continue;
            if (flock($f, LOCK_EX | LOCK_NB)) {
                $old = json_decode(stream_get_contents($f), true);
                if (!$old || ($old['expires'] ?? 0) < $now || ($old['closed'] ?? false)) unlink($path); else {
                    if ($idLookup !== null && ($old['idLookup'] ?? null) === $idLookup) fail(409, 'Этот ID уже используется. Создайте новое подключение.');
                    $active++; if (usesRelay($old)) $internetActive++;
                }
                flock($f, LOCK_UN);
            } else { $active++; $internetActive++; }
            fclose($f);
        }
        foreach (glob($base . '/budget-*.json') ?: [] as $path) {
            if (filemtime($path) < $now - 3600) @unlink($path);
        }
        if ($active >= 200) { flock($global, LOCK_UN); fclose($global); fail(503, 'Сервис занят. Попробуйте позже.'); }
        if ($mode === 'internet' && $internetActive >= 20) fail(503, 'Интернет-режим сейчас занят. Попробуйте позже.');
        $room = hexToken(16); $host = hexToken(); $invite = $idLookup === null ? hexToken() : null;
        $state = ['host' => hash('sha256', $host), 'invite' => $idInviteDigest ?? hash('sha256', $invite), 'guest' => null,
            'hostName' => nameValue($input['name'] ?? ''), 'guestName' => null, 'approved' => false,
            'expires' => $now + ($mode === 'internet' ? 7200 : 900), 'created' => $now, 'seq' => 0, 'messages' => [], 'closed' => false, 'mode' => $mode];
        if ($idLookup !== null) { $state['idLookup'] = $idLookup; $state['inviteExpires'] = $now + 900; }
        if ($mode === 'auto') $state['transport'] = 'probing';
        if ($mode === 'internet') {
            $empty = ['seq' => 0, 'ack' => 0, 'frames' => [], 'recent' => []];
            $state['relay'] = ['host' => $empty, 'guest' => $empty]; $state['relayLast'] = ['host' => $now, 'guest' => $now];
        }
        $f = fopen($base . '/room-' . $room . '.json', 'x+');
        if (!$f) throw new RuntimeException('Room creation failed');
        chmod($base . '/room-' . $room . '.json', 0600); writeState($f, $state); fclose($f);
        flock($global, LOCK_UN); fclose($global);
        reply(201, ['room' => $room, 'token' => $host, 'invite' => $invite, 'expires' => $state['expires'], 'mode' => $mode,
            'idEnabled' => $idLookup !== null, 'inviteExpires' => $state['inviteExpires'] ?? $state['expires']]);
    }
    if ($action === 'resolve-id') {
        $lookup = $input['lookup'] ?? null;
        if (!is_string($lookup) || !preg_match('/^[a-f0-9]{64}$/D', $lookup)) fail(400, 'Некорректный ID приглашения.');
        // At most 200 rooms exist; no separate ID index or plaintext secret is stored.
        foreach (glob($base . '/room-*.json') ?: [] as $candidate) {
            $handle = @fopen($candidate, 'r');
            if (!$handle) continue;
            if (!flock($handle, LOCK_SH)) { fclose($handle); continue; }
            $candidateState = json_decode(stream_get_contents($handle), true);
            flock($handle, LOCK_UN); fclose($handle);
            if (!is_array($candidateState) || !isset($candidateState['idLookup']) || !hash_equals($candidateState['idLookup'], $lookup)) continue;
            if (($candidateState['inviteExpires'] ?? 0) < $now || $candidateState['expires'] < $now ||
                $candidateState['closed'] || $candidateState['guest'] !== null) break;
            reply(200, ['room' => substr(basename($candidate), 5, 32), 'mode' => $candidateState['mode'] ?? 'lan', 'expires' => $candidateState['inviteExpires']]);
        }
        fail(404, 'ID не найден, истёк или уже использован. Создайте новое приглашение.');
    }
    $room = $input['room'] ?? '';
    if (!is_string($room) || !preg_match('/^[a-f0-9]{32}$/D', $room)) fail(400, 'Некорректная комната.');
    $path = $base . '/room-' . $room . '.json';
    $f = @fopen($path, 'r+');
    if (!$f) fail(404, 'Приглашение не найдено или истекло.');
    if (!flock($f, LOCK_EX)) throw new RuntimeException('Room lock failed');
    $state = json_decode(stream_get_contents($f), true, 32, JSON_THROW_ON_ERROR);
    if ($state['expires'] < $now || $state['closed']) { flock($f, LOCK_UN); fclose($f); fail(410, 'Комната закрыта или время подключения истекло.'); }
    $token = $input['token'] ?? '';
    if (!is_string($token) || !preg_match('/^[a-f0-9]{64}$/D', $token)) fail(403, 'Недействительный ключ.');
    $digest = hash('sha256', $token);
    if ($action === 'join') {
        if (($state['inviteExpires'] ?? $state['expires']) < $now) fail(410, 'Срок приглашения истёк. Создайте новое подключение.');
        if (!hash_equals($state['invite'], $digest)) fail(403, 'Недействительное приглашение.');
        if ($state['guest'] !== null) fail(409, 'Приглашение уже использовано. Создайте новое.');
        $guest = hexToken(); $state['guest'] = hash('sha256', $guest);
        $state['guestName'] = nameValue($input['name'] ?? '');
        writeState($f, $state); flock($f, LOCK_UN); fclose($f);
        reply(200, ['token' => $guest, 'hostName' => $state['hostName'], 'expires' => $state['expires'], 'mode' => $state['mode'] ?? 'lan']);
    }
    $role = hash_equals($state['host'], $digest) ? 'host' : (($state['guest'] && hash_equals($state['guest'], $digest)) ? 'guest' : null);
    if (!$role) fail(403, 'Недействительный ключ.');
    if ($relayRequest) {
        $result = relayAction($action, $input, $state, $role, $base, $now, $config['relayDailyBytes'] ?? 5 * 1024 ** 3);
        writeState($f, $state); flock($f, LOCK_UN); fclose($f); reply(200, $result);
    }
    if ($action === 'record-usage') {
        if (!$state['approved']) fail(403, 'Сначала подтвердите устройство.');
        // Both endpoints report protocol readiness; a room identifies one connection.
        // Do not store session tokens or device identities in the statistics ledger.
        $result = transferStatistics($base, ['room' => $room, 'id' => 'connection', 'kind' => 'usage', 'expires' => $state['expires']]);
        flock($f, LOCK_UN); fclose($f); reply(200, $result);
    }
    if ($action === 'record-transfer') {
        if (!$state['approved']) fail(403, 'Сначала подтвердите устройство.');
        $id = $input['id'] ?? null; $size = $input['size'] ?? null;
        if (!is_string($id) || !preg_match('/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/D', $id) ||
            !is_int($size) || $size < 0 || $size > 10 * 1024 ** 3) fail(400, 'Некорректная передача.');
        $report = ['room' => $room, 'id' => $id, 'size' => $size, 'expires' => $state['expires']];
        $result = transferStatistics($base, $report);
        flock($f, LOCK_UN); fclose($f);
        reply(200, $result);
    }
    if ($action === 'approve') {
        if ($role !== 'host' || !$state['guest']) fail(403, 'Подтверждение недоступно.');
        if (!$state['approved'] && ($state['mode'] ?? '') === 'auto') $state['probeDeadline'] = $now + 12;
        $state['approved'] = true;
        if (($state['mode'] ?? 'lan') === 'internet') $state['relayLast'] = ['host' => $now, 'guest' => $now];
    } elseif ($action === 'transport') {
        if (($state['mode'] ?? '') !== 'auto' || !$state['approved']) fail(403, 'Сначала подтвердите устройство.');
        $event = $input['event'] ?? 'status';
        if (!is_string($event) || !in_array($event, ['status', 'direct-ready', 'fallback'], true)) fail(400, 'Некорректный способ подключения.');
        automaticTransport($state, $base, $room, $role, $now, $f, $event);
    } elseif ($action === 'close') {
        $state['closed'] = true; $state['messages'] = [];
        unset($state['relay']);
    } elseif ($action === 'signal') {
        if (!$state['approved']) fail(403, 'Сначала подтвердите устройство.');
        $message = $input['message'] ?? null;
        if (!is_array($message) || !in_array($message['type'] ?? '', ['offer', 'answer', 'candidate'], true)) fail(400, 'Некорректное сообщение.');
        if (in_array($message['type'], ['offer', 'answer'], true)) {
            if (!is_string($message['sdp'] ?? null) || strlen($message['sdp']) > 32768) fail(400, 'Некорректное описание соединения.');
            if (($message['type'] === 'offer' && $role !== 'host') || ($message['type'] === 'answer' && $role !== 'guest')) fail(403, 'Неверная роль.');
        } else {
            if (!is_array($message['candidate'] ?? null) || strlen(json_encode($message)) > 4096) fail(400, 'Некорректный адрес соединения.');
        }
        if (count($state['messages']) >= 128) fail(429, 'Слишком много сообщений соединения.');
        if (($state['transport'] ?? '') !== 'relay') $state['messages'][] = ['id' => ++$state['seq'], 'from' => $role, 'body' => $message];
    } elseif ($action !== 'poll') fail(400, 'Неизвестная операция.');
    if ($action === 'poll') automaticTransport($state, $base, $room, $role, $now, $f);
    $after = $input['after'] ?? 0;
    if (!is_int($after) || $after < 0) fail(400, 'Некорректный курсор.');
    $messages = array_values(array_filter($state['messages'], fn($m) => $m['from'] !== $role && $m['id'] > $after));
    // Absolute lifetime; internet mode has a bounded, temporary ciphertext queue.
    writeState($f, $state); flock($f, LOCK_UN); fclose($f);
    reply(200, ['approved' => $state['approved'], 'guestName' => $state['guestName'], 'hostName' => $state['hostName'], 'messages' => $messages, 'cursor' => $state['seq'], 'expires' => $state['expires'], 'transport' => $state['transport'] ?? null]);
} catch (Throwable $e) {
    error_log('Nearby signaling: ' . get_class($e));
    fail(500, 'Не удалось обработать запрос. Попробуйте позже.');
}
