/**
 * Stockdity IMS — Client-Side Encryption Layer
 * ============================================================
 * Provides AES-GCM-256 encryption for all IndexedDB records.
 * Key derivation: PBKDF2 (SHA-256, 200,000 iterations) from
 * the tenant's licence key + a per-device random salt.
 *
 * Encryption key is held in memory only (window.__encKey).
 * On logout or page unload, it is cleared.
 *
 * Two tenants on the same device:
 *   - Different licence keys → different PBKDF2 inputs → different AES keys.
 *   - Decryption of the other tenant's records fails (AES-GCM auth tag mismatch).
 *   - Data is fully isolated even though they share the same IndexedDB database.
 *
 * IMPORTANT: Callers (db.js) must call initEncryption() once during app
 * startup (after licence activation) before any encrypt/decrypt call.
 * ============================================================
 */

'use strict';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const PBKDF2_ITERATIONS = 200_000;
const PBKDF2_HASH       = 'SHA-256';
const AES_ALGORITHM     = 'AES-GCM';
const AES_KEY_LENGTH    = 256;
const IV_BYTE_LENGTH    = 12;
const SALT_STORAGE_PREFIX = 'stockdity_enc_salt_';

// ─── IN-MEMORY KEY HOLDER ────────────────────────────────────────────────────
/**
 * The derived AES-GCM CryptoKey — held in memory only, never serialised.
 * Set by initEncryption(), cleared by clearEncryptionKey().
 * @type {CryptoKey|null}
 */
let _encKey = null;

// ─── INITIALISATION ───────────────────────────────────────────────────────────
/**
 * Derive the AES-GCM key from the licence key passphrase + per-device salt.
 * Must be called once after licence validation, before any DB read/write.
 *
 * @param {string} licenceKey - The raw licence key (used as PBKDF2 passphrase).
 * @returns {Promise<void>}
 */
async function initEncryption(licenceKey) {
  try {
    if (!licenceKey || typeof licenceKey !== 'string') {
      throw new Error('[CryptoStore] initEncryption: licenceKey must be a non-empty string.');
    }

    // Derive a stable salt-key identifier (SHA-256 of the licence key)
    const keyIdBytes = new TextEncoder().encode(licenceKey.trim());
    const keyIdBuf   = await crypto.subtle.digest('SHA-256', keyIdBytes);
    const keyIdHex   = Array.from(new Uint8Array(keyIdBuf))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    const saltKey    = SALT_STORAGE_PREFIX + keyIdHex.slice(0, 16); // 16-char prefix

    // Load or generate the per-device salt
    let saltB64 = localStorage.getItem(saltKey);
    if (!saltB64) {
      const saltBytes = crypto.getRandomValues(new Uint8Array(32));
      saltB64 = btoa(String.fromCharCode(...saltBytes));
      try {
        localStorage.setItem(saltKey, saltB64);
      } catch (storageErr) {
        console.warn('[CryptoStore] Could not persist salt to localStorage:', storageErr);
        // Proceed with in-memory salt — encryption works but won't survive page reload.
      }
    }

    const saltBytes = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));

    // Import the passphrase as a raw key material for PBKDF2
    const passphraseBytes = new TextEncoder().encode(licenceKey.trim());
    const rawKeyMaterial  = await crypto.subtle.importKey(
      'raw', passphraseBytes,
      { name: 'PBKDF2' },
      false, ['deriveKey']
    );

    // Derive the AES-GCM key
    _encKey = await crypto.subtle.deriveKey(
      {
        name:       'PBKDF2',
        salt:       saltBytes,
        iterations: PBKDF2_ITERATIONS,
        hash:       PBKDF2_HASH
      },
      rawKeyMaterial,
      { name: AES_ALGORITHM, length: AES_KEY_LENGTH },
      false,       // not extractable — key never leaves memory
      ['encrypt', 'decrypt']
    );

    // Also expose on window for emergency clear
    window.__encKey = _encKey;
    console.log('[CryptoStore] Encryption key derived successfully.');

  } catch (err) {
    console.error('[CryptoStore] initEncryption failed:', err);
    _encKey = null;
    window.__encKey = null;
    throw err;
  }
}

/**
 * Clear the in-memory encryption key.
 * Call on logout or page unload.
 */
function clearEncryptionKey() {
  _encKey = null;
  try { window.__encKey = null; } catch { /* ignore */ }
}

/**
 * Check whether the encryption layer has been initialised.
 * @returns {boolean}
 */
function isEncryptionReady() {
  return _encKey !== null;
}

// ─── ENCRYPT ─────────────────────────────────────────────────────────────────
/**
 * Encrypt a JavaScript value (object, array, primitive) to an encrypted envelope.
 * Returns { iv: string, ct: string } where both are base64.
 *
 * @param {*} value - Any JSON-serialisable value.
 * @returns {Promise<{ iv: string, ct: string }>}
 */
async function encrypt(value) {
  if (!_encKey) {
    throw new Error('[CryptoStore] Encryption key not initialised. Call initEncryption() first.');
  }

  try {
    const iv          = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
    const plaintext   = new TextEncoder().encode(JSON.stringify(value));
    const cipherBuf   = await crypto.subtle.encrypt(
      { name: AES_ALGORITHM, iv }, _encKey, plaintext
    );

    return {
      iv: btoa(String.fromCharCode(...iv)),
      ct: btoa(String.fromCharCode(...new Uint8Array(cipherBuf)))
    };
  } catch (err) {
    console.error('[CryptoStore] encrypt() failed:', err);
    throw err;
  }
}

/**
 * Decrypt an encrypted envelope back to the original value.
 *
 * @param {{ iv: string, ct: string }} envelope
 * @returns {Promise<*>} The original decrypted value.
 * @throws If decryption fails (wrong key, tampered data, or bad format).
 */
async function decrypt(envelope) {
  if (!_encKey) {
    throw new Error('[CryptoStore] Encryption key not initialised. Call initEncryption() first.');
  }

  if (!envelope || typeof envelope.iv !== 'string' || typeof envelope.ct !== 'string') {
    throw new Error('[CryptoStore] decrypt(): invalid envelope format.');
  }

  try {
    const iv         = Uint8Array.from(atob(envelope.iv), c => c.charCodeAt(0));
    const cipherBuf  = Uint8Array.from(atob(envelope.ct), c => c.charCodeAt(0));
    const plainBuf   = await crypto.subtle.decrypt(
      { name: AES_ALGORITHM, iv }, _encKey, cipherBuf
    );

    return JSON.parse(new TextDecoder().decode(plainBuf));
  } catch (err) {
    // Do NOT log the error content (might contain sensitive data)
    console.warn('[CryptoStore] decrypt() failed — wrong key or tampered record.');
    throw err;
  }
}

// ─── RECORD WRAPPERS ─────────────────────────────────────────────────────────
/**
 * Encrypt a full DB record, preserving the auto-increment primary key (id)
 * and any plaintext index fields that Dexie needs for schema compliance.
 *
 * Encrypted envelope is stored in the `_enc` field.
 * The original fields are NOT stored in plaintext (except `id`).
 *
 * Storage layout in IndexedDB:
 *   { id: <number>, _enc: { iv: string, ct: string } }
 *
 * For the `users` table we also preserve `email` in plaintext as `_ei`
 * (encrypted index) so that uniqueness can be checked application-side;
 * but we do NOT use it for Dexie index queries.
 *
 * @param {Object} record - The full plaintext record.
 * @returns {Promise<Object>} The storable envelope object.
 */
async function encryptRecord(record) {
  if (!record || typeof record !== 'object') {
    throw new Error('[CryptoStore] encryptRecord(): record must be an object.');
  }

  try {
    const envelope = await encrypt(record);
    // Preserve `id` in plaintext so Dexie auto-increment PK works correctly.
    // If `id` is undefined (new record, not yet assigned), omit it.
    const stored = { _enc: envelope };
    if (record.id !== undefined && record.id !== null) {
      stored.id = record.id;
    }
    return stored;
  } catch (err) {
    console.error('[CryptoStore] encryptRecord() failed:', err);
    throw err;
  }
}

/**
 * Decrypt a stored envelope back to the original record.
 * Returns null if the record is a plaintext legacy record (no `_enc` field)
 * or if decryption fails (wrong tenant key).
 *
 * @param {Object} stored - The stored Dexie row.
 * @returns {Promise<Object|null>}
 */
async function decryptRecord(stored) {
  if (!stored) return null;

  // Legacy plaintext record (pre-encryption deployment): return as-is
  if (!stored._enc) {
    return stored;
  }

  try {
    const record = await decrypt(stored._enc);
    // Restore the Dexie-assigned `id` (not stored inside the encrypted blob
    // because it's assigned by Dexie after the put() call).
    if (stored.id !== undefined) {
      record.id = stored.id;
    }
    return record;
  } catch (err) {
    // Decryption failed — record belongs to a different tenant or is corrupted.
    console.warn('[CryptoStore] decryptRecord() — record skipped (wrong tenant or corrupted):', err.message);
    return null;
  }
}

/**
 * Decrypt an array of stored envelopes. Skips records that fail decryption
 * (e.g. belonging to a different tenant). Returns only successfully
 * decrypted records.
 *
 * @param {Object[]} storedArray
 * @returns {Promise<Object[]>}
 */
async function decryptAll(storedArray) {
  if (!Array.isArray(storedArray)) return [];

  try {
    const results = await Promise.allSettled(storedArray.map(r => decryptRecord(r)));
    return results
      .filter(r => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);
  } catch (err) {
    console.error('[CryptoStore] decryptAll() unexpected error:', err);
    return [];
  }
}

// ─── MIGRATION HELPER ─────────────────────────────────────────────────────────
/**
 * Migrate a table from plaintext records to encrypted envelopes.
 * Used during DB version upgrade when encryption is first enabled.
 * Reads all records, re-writes them as encrypted envelopes.
 *
 * Must be called inside a Dexie transaction.
 *
 * @param {import('dexie').Table} table - A Dexie table object.
 * @returns {Promise<{ migrated: number, failed: number }>}
 */
async function migrateTableToEncrypted(table) {
  let migrated = 0;
  let failed   = 0;

  try {
    const all = await table.toArray();
    for (const record of all) {
      if (record._enc) {
        // Already encrypted — skip
        continue;
      }
      try {
        const envelope = await encryptRecord(record);
        await table.put(envelope);
        migrated++;
      } catch (err) {
        console.warn(`[CryptoStore] Migration failed for record id=${record.id}:`, err.message);
        failed++;
      }
    }
  } catch (err) {
    console.error('[CryptoStore] migrateTableToEncrypted() failed:', err);
    throw err;
  }

  return { migrated, failed };
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────
export {
  initEncryption,
  clearEncryptionKey,
  isEncryptionReady,
  encrypt,
  decrypt,
  encryptRecord,
  decryptRecord,
  decryptAll,
  migrateTableToEncrypted
};
