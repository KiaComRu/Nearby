// Legacy 26-character invitations remain compatible. New nine-digit IDs are
// allocated by PHP and use a separate ephemeral ECDH key exchange.
const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newInvitationId() {
  let value = 0, bits = 0, code = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(16))) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; code += alphabet[(value >>> bits) & 31]; }
  }
  if (bits) code += alphabet[(value << (5 - bits)) & 31];
  return code;
}
export function normalizeInvitationId(value) {
  const compact = String(value).trim().toUpperCase().replace(/[\s-]/g, '');
  if (/^\d{9}$/.test(compact)) return compact;
  const code = compact.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(code)) throw new Error('Проверьте ID: нужны все 9 цифр.');
  return code;
}
export function formatInvitationId(value) { const code = normalizeInvitationId(value); return code.match(code.length === 9 ? /.{3}/g : /.{1,4}/g).join('-'); }
export async function invitationCredentials(value) {
  const code = normalizeInvitationId(value);
  if (code.length === 9) throw new Error('Короткий ID не используется как ключ шифрования.');
  const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
  const derive = purpose => digest(`nearby-invitation-id:v1:${purpose}:${code}`);
  const [lookup, token, relaySecret] = await Promise.all(['lookup', 'invite', 'relay'].map(derive));
  return { lookup, token, inviteDigest: await digest(token), relaySecret };
}

const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export async function shortInvitationLookup(value) {
  const code = normalizeInvitationId(value);
  if (code.length !== 9) throw new Error('Проверьте ID: нужны все 9 цифр.');
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode('nearby-short-id:v1:lookup:' + code))));
}
export async function invitationKeyExchange() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  return { privateKey: keys.privateKey, publicKey: hex(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))) };
}
export async function sharedInvitationSecret(privateKey, publicKey, room) {
  if (!/^04[a-f0-9]{128}$/.test(publicKey || '') || !/^[a-f0-9]{32}$/.test(room || '')) throw new Error('Некорректный ключ устройства. Создайте новое приглашение.');
  const peer = await crypto.subtle.importKey('raw', Uint8Array.from(publicKey.match(/../g), value => parseInt(value, 16)), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, privateKey, 256);
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(room), info: encoder.encode('nearby-short-id:v1:relay') }, material, 256)));
}
