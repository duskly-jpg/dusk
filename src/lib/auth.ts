// PBKDF2 口令哈希 + HMAC 会话令牌（Workers WebCrypto）
const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function randomHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

export async function pbkdf2Hash(password: string, saltHex: string): Promise<string> {
  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// token = b64url(json{uid,exp}).hmacHex
export async function signToken(secret: string, uid: number, days = 7): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ uid, exp: Date.now() + days * 86400000 })));
  const key = await hmacKey(secret);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return `${payload}.${b64url(new Uint8Array(mac))}`;
}

export async function verifyToken(secret: string, token: string): Promise<number | null> {
  const idx = token.lastIndexOf('.');
  if (idx < 0) return null;
  const payload = token.slice(0, idx), mac = token.slice(idx + 1);
  const key = await hmacKey(secret);
  const expect = b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload))));
  if (mac !== expect) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    if (Date.now() > data.exp) return null;
    return data.uid;
  } catch { return null; }
}
