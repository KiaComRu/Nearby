import https from 'node:https';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { certificateFingerprint } from './device-identity.mjs';

const fail = (message, code = 'identity-changed') => Object.assign(new Error(message), { status: 409, code });
export function pinnedTls(identity, certificate) {
  const expected = certificateFingerprint(certificate);
  return { key: identity.key, cert: identity.cert, ca: certificate, rejectUnauthorized: true, minVersion: 'TLSv1.3', servername: 'nearby-device', agent: false,
    checkServerIdentity: (_hostname, actual) => actual.raw && certificateFingerprint(actual.raw) === expected ? undefined : fail('Ключ другого ПК изменился. Подключение остановлено; проверьте устройство перед новым сопряжением.') };
}
export function peerCertificate(req) {
  const raw = req.socket.getPeerCertificate()?.raw;
  if (!raw || raw.length > 8192) throw Object.assign(new Error('Нужен сертификат устройства.'), { status: 403 });
  const certificate = new X509Certificate(raw);
  if (Date.parse(certificate.validTo) <= Date.now() || Date.parse(certificate.validFrom) > Date.now()) throw Object.assign(new Error('Сертификат устройства недействителен.'), { status: 403 });
  return { cert: certificate.toString(), fingerprint: certificateFingerprint(raw) };
}
// Initial untrusted probe retrieves only the public certificate, never a PIN,
// token, metadata or files. Subsequent requests always use exact certificate pinning.
export function probeCertificate(origin) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: url.hostname, port: Number(url.port), minVersion: 'TLSv1.3', rejectUnauthorized: false, servername: 'nearby-device' });
    const timer = setTimeout(() => socket.destroy(new Error('Проверка сертификата не завершилась вовремя.')), 5000);
    socket.once('secureConnect', () => {
      try { const raw = socket.getPeerCertificate().raw; if (!raw || raw.length > 8192) throw new Error('Нет сертификата устройства.'); resolve(new X509Certificate(raw).toString()); }
      catch (error) { reject(error); } finally { clearTimeout(timer); socket.destroy(); }
    });
    socket.once('error', error => { clearTimeout(timer); reject(error); });
  });
}
export function tlsJson(origin, route, tlsOptions, body, { timeout = 5000, requests } = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(origin + route, { ...tlsOptions, method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : { 'Content-Type': 'application/json' } }, response => {
      const chunks = []; let size = 0;
      response.on('data', bytes => { size += bytes.length; if (size > 1048576) request.destroy(new Error('Слишком большой ответ другого ПК.')); else chunks.push(bytes); });
      response.on('error', reject);
      response.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (response.statusCode < 200 || response.statusCode >= 300) throw Object.assign(new Error(data.error || 'Другое устройство отклонило запрос.'), { status: response.statusCode, code: data.code });
          resolve(data);
        } catch (error) { reject(error); }
      });
    });
    requests?.add(request);
    const timer = setTimeout(() => request.destroy(new Error('Другой ПК не отвечает. Проверьте сеть.')), timeout);
    request.once('close', () => { clearTimeout(timer); requests?.delete(request); });
    request.once('error', error => {
      if (/CERT|TLS_CERT|SELF_SIGNED/.test(error.code || '')) reject(fail('Не удалось проверить ключ другого ПК. Подключение остановлено без перехода на HTTP.'));
      else reject(error);
    });
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
