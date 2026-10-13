import { X509Certificate, createPrivateKey, createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { discoveryName } from './lan-discovery.mjs';

export const certificateFingerprint = certificate => createHash('sha256').update(new X509Certificate(certificate).raw).digest('hex');
export const validFingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validDeviceName(value) { return typeof value === 'string' && value.trim() && Buffer.byteLength(value) <= 100 && !/[\x00-\x1f\x7f]/u.test(value); }
export async function atomicJson(file, data) {
  const temporary = file + '.' + randomUUID() + '.tmp';
  try { await writeFile(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600 }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
export async function windowsProtect(value, decrypt = false) {
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = `try { Add-Type -AssemblyName System.Security; $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $entropy=[Text.Encoding]::UTF8.GetBytes('Nearby device identity v1'); $result=[Security.Cryptography.ProtectedData]::${operation}($inputBytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result)) } catch { exit 1 }`;
  const input = decrypt ? value : Buffer.from(value).toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = []; let size = 0;
    const timer = setTimeout(() => child.kill(), 10000);
    child.stdout.on('data', bytes => { size += bytes.length; if (size > 65536) child.kill(); else chunks.push(bytes); });
    child.once('error', () => { clearTimeout(timer); reject(new Error('Защита ключа Windows недоступна.')); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0 || !size || size > 65536) { reject(new Error('Не удалось открыть защищённый ключ Nearby для этого пользователя Windows.')); return; }
      const result = Buffer.concat(chunks).toString('ascii');
      resolve(decrypt ? Buffer.from(result, 'base64').toString('utf8') : result);
    });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
export async function loadDeviceIdentity(storage, { protection = process.platform === 'win32' ? 'dpapi' : 'file', name = discoveryName() } = {}) {
  const file = path.join(storage, 'device-identity.json');
  let stored;
  try { stored = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Хранилище ключа Nearby повреждено. Оно сохранено без изменений.'); }
  let identity;
  if (stored) {
    if (stored.version !== 1 || !['dpapi', 'file'].includes(stored.protection)) throw new Error('Неизвестный формат ключа Nearby.');
    if (stored.protection === 'file' && protection === 'dpapi') throw new Error('Незащищённый ключ не подходит для Windows. Перенос ключей требует отдельного подтверждённого восстановления.');
    identity = stored.protection === 'dpapi' ? JSON.parse(await windowsProtect(stored.data, true)) : stored.data;
  } else {
    const { generate } = await import('selfsigned');
    const notBeforeDate = new Date(Date.now() - 5 * 60_000), notAfterDate = new Date(Date.now() + 5 * 365 * 86400_000);
    const pems = await generate([{ name: 'commonName', value: 'nearby-device' }], { keyType: 'ec', curve: 'P-256', algorithm: 'sha256', notBeforeDate, notAfterDate,
      extensions: [{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', digitalSignature: true, keyCertSign: true }, { name: 'extKeyUsage', serverAuth: true, clientAuth: true }] });
    identity = { name, key: pems.private, cert: pems.cert };
    await atomicJson(file, { version: 1, protection, data: protection === 'dpapi' ? await windowsProtect(JSON.stringify(identity)) : identity });
  }
  const certificate = new X509Certificate(identity.cert);
  if (!validDeviceName(identity.name) || !certificate.checkPrivateKey(createPrivateKey(identity.key)) || Date.parse(certificate.validTo) <= Date.now()) throw new Error('Ключ или сертификат Nearby недействителен. Хранилище не изменено.');
  return { ...identity, fingerprint: certificateFingerprint(identity.cert) };
}
