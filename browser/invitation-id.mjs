// 128 random bits; the server receives only domain-separated digests, never the ID.
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
  const code = String(value).trim().toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(code)) throw new Error('Проверьте ID: нужны все 26 букв и цифр.');
  return code;
}
export function formatInvitationId(value) { return normalizeInvitationId(value).match(/.{1,4}/g).join('-'); }
export async function invitationCredentials(value) {
  const code = normalizeInvitationId(value);
  const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), byte => byte.toString(16).padStart(2, '0')).join('');
  const derive = purpose => digest(`nearby-invitation-id:v1:${purpose}:${code}`);
  const [lookup, token, relaySecret] = await Promise.all(['lookup', 'invite', 'relay'].map(derive));
  return { lookup, token, inviteDigest: await digest(token), relaySecret };
}
