/**
 * Stockdity IMS — Client‑side encryption & per‑tenant salt
 * Uses AES‑GCM 256‑bit with PBKDF2 key derivation.
 */

let _encryptionKey = null;

export async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  const saltBytes = Uint8Array.from(atob(salt), c => c.charCodeAt(0));
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export function generateSalt() {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...salt));
}

export async function encrypt(data) {
  if (!_encryptionKey) throw new Error('Encryption key not set');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    _encryptionKey,
    encoded
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(ciphertextB64) {
  if (!_encryptionKey) throw new Error('Encryption key not set');
  const combined = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    _encryptionKey,
    ciphertext
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export function setEncryptionKey(key) {
  _encryptionKey = key;
}

export function isEncryptionReady() {
  return _encryptionKey !== null;
}

export async function exportKeyToJwk(key) {
  return crypto.subtle.exportKey('jwk', key);
}

export async function importKeyFromJwk(jwk) {
  return crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}
