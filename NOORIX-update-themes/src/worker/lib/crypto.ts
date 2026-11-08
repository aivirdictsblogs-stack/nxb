const enc = new TextEncoder();
const b64 = (b: ArrayBuffer | Uint8Array) => { const a = b instanceof Uint8Array ? b : new Uint8Array(b); let s = ''; for (const x of a) s += String.fromCharCode(x); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const randomToken = (bytes = 32) => b64(crypto.getRandomValues(new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export async function sha256Hex(s: string) {
  const h = await crypto.subtle.digest('SHA-256', enc.encode(s));
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// PBKDF2-SHA256 (Workers cap iterations at 100000)
const ITER = 100000;
async function pbkdf2(pw: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
export async function hashPassword(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(await pbkdf2(pw, salt, ITER))}`;
}
export async function verifyPassword(pw: string, stored: string | null) {
  if (!stored) return false;
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2') return false;
  const got = await pbkdf2(pw, unb64(salt), Number(iter));
  const exp = unb64(hash);
  let d = got.length ^ exp.length;
  for (let i = 0; i < got.length; i++) d |= got[i] ^ (exp[i] ?? 0);
  return d === 0;
}
async function aesKey(keyB64: string) {
  const raw = unb64(keyB64);
  if (raw.length !== 32) throw new Error('DELIVERY_KEY must be 32 bytes base64');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptText(plain: string, keyB64: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), enc.encode(plain));
  return `v1.${b64(iv)}.${b64(ct)}`;
}
export async function decryptText(blob: string, keyB64: string) {
  const [v, iv, ct] = blob.split('.');
  if (v !== 'v1') throw new Error('bad ciphertext');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(keyB64), unb64(ct));
  return new TextDecoder().decode(pt);
}
