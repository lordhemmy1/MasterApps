/**
 * Stockdity IMS — Client‑side encryption & per‑tenant salt
 * Uses AES‑GCM 256‑bit with PBKDF2 key derivation.
 */

// Global key – set only after successful tenant passphrase verification
let _encryptionKey = null;

/**
 * Derive a 256‑bit AES‑GCM key from a passphrase and a random salt.
 * @param {string} passphrase - The tenant's passphrase (e.g. business name + secret)
 * @param {string} salt       - Base64 encoded salt (32 bytes recommended)
 * @returns {Promise<CryptoKey>}
 */
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

/**
 * Generate a new random salt (32 bytes) for key derivation.
 * @returns {string} Base64 encoded salt.
 */
export function generateSalt() {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...salt));
}

/**
 * Encrypt a JavaScript object (or any serializable value) using the current encryption key.
 * @param {any} data - Value to encrypt (will be JSON.stringify‑ed)
 * @returns {Promise<string>} Base64 encoded ciphertext (includes IV).
 */
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

/**
 * Decrypt a Base64 string (produced by encrypt()) and return the original object.
 * @param {string} ciphertextB64 - Base64 string containing IV + ciphertext.
 * @returns {Promise<any>}
 */
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

/**
 * Set the global encryption key – called after successful passphrase verification.
 * @param {CryptoKey} key
 */
export function setEncryptionKey(key) {
  _encryptionKey = key;
}

/**
 * Check whether encryption is ready.
 * @returns {boolean}
 */
export function isEncryptionReady() {
  return _encryptionKey !== null;
}
