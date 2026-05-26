/**
 * Stockdity IMS — Authentication Module
 * Handles: password hashing (SHA-256 + salt), session management,
 * login rate limiting, role checking, licence validation,
 * and forced password change enforcement.
 */

import AppConfig from '../../config.js';
import db from './db.js';
import { showToast } from './ui.js';
import { writeAuditLog } from './audit.js';
import { deriveKey, generateSalt, setEncryptionKey, exportKeyToJwk } from './crypto.js';

// ─── SESSION MANAGEMENT ───────────────────────────────────────────────────────
/**
 * Store the authenticated user in sessionStorage.
 * Only safe, non-sensitive fields are stored.
 * @param {Object} user
 */
function setSession(user) {
  const safeUser = {
    id:                    user.id,
    name:                  user.name,
    email:                 user.email,
    role:                  user.role,
    avatar_initials:       user.avatar_initials,
    force_password_change: user.force_password_change || false
  };
  sessionStorage.setItem(AppConfig.SESSION_KEYS.AUTH_USER, JSON.stringify(safeUser));
}

/**
 * Retrieve the current session user from sessionStorage.
 * @returns {Object|null}
 */
function getSession() {
  try {
    const raw = sessionStorage.getItem(AppConfig.SESSION_KEYS.AUTH_USER);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Clear the session and redirect to login.
 */
function clearSession() {
  sessionStorage.removeItem(AppConfig.SESSION_KEYS.AUTH_USER);
  sessionStorage.removeItem(AppConfig.SESSION_KEYS.SALES_CART);
}

/**
 * Update a specific field in the current session without a full re-login.
 * @param {string} field
 * @param {any} value
 */
function updateSessionField(field, value) {
  const user = getSession();
  if (!user) return;
  user[field] = value;
  sessionStorage.setItem(AppConfig.SESSION_KEYS.AUTH_USER, JSON.stringify(user));
}

// ─── PASSWORD HASHING ─────────────────────────────────────────────────────────
/**
 * Generate a cryptographically random 16-byte salt as a hex string.
 * @returns {string} 32-character hex string
 */
function generatePasswordSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash a password string with SHA-256 using the Web Crypto API.
 * @param {string} password
 * @param {string} [salt] - If omitted, a new random salt is generated.
 * @returns {Promise<{ hash: string, salt: string }>}
 */
async function hashPassword(password, salt = null) {
  const usedSalt = salt || generatePasswordSalt();
  const combined = usedSalt + password;

  const encoder    = new TextEncoder();
  const data       = encoder.encode(combined);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray  = Array.from(new Uint8Array(hashBuffer));
  const hashHex    = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return { hash: hashHex, salt: usedSalt };
}

/**
 * Timing-safe string comparison.
 * Prevents early-exit timing attacks by always comparing all characters.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    // Still iterate to prevent length-based timing leaks
    let diff = 0;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    }
    return false; // Always false for different lengths, but ran the loop
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify a plaintext password against a stored hash and salt.
 * @param {string} plaintext
 * @param {string} storedHash
 * @param {string} storedSalt
 * @returns {Promise<boolean>}
 */
async function verifyPassword(plaintext, storedHash, storedSalt) {
  const { hash } = await hashPassword(plaintext, storedSalt);
  return timingSafeEqual(hash, storedHash);
}

// ─── LICENCE VALIDATION ───────────────────────────────────────────────────────
/**
 * Validate a licence key entered during activation.
 * Checks ECDSA signature, key match, and expiry (with 3-day grace period).
 * Supports: payload system → legacy ECDSA → legacy SHA-256.
 * @param {string} key — the raw key entered by the user
 * @returns {Promise<{valid: boolean, maxUsers: number}>}
 */
async function validateLicenceKey(key) {
  // System 1: ECDSA + Payload (plan‑aware, expiry‑enforced, includes maxUsers)
  if (AppConfig.ECDSA_PUBLIC_KEY_JWK && AppConfig.LICENSE_PAYLOAD_B64 && AppConfig.LICENSE_SIGNATURE) {
    try {
      const payloadStr = atob(AppConfig.LICENSE_PAYLOAD_B64);
      const parts = payloadStr.split('|');
      // Format: licenceKey|plan|issued|expiry|customer|email|maxUsers
      if (parts.length < 7) return { valid: false, maxUsers: 1 };
      const [payloadKey, plan, issued, expiry, customer, email, maxUsersStr] = parts;
      const maxUsers = parseInt(maxUsersStr, 10) || 1;

      const publicKey = await crypto.subtle.importKey(
        'jwk', AppConfig.ECDSA_PUBLIC_KEY_JWK,
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
      );
      const sigBytes = Uint8Array.from(atob(AppConfig.LICENSE_SIGNATURE), c => c.charCodeAt(0));
      const datBytes = new TextEncoder().encode(payloadStr);
      const sigOK = await crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } }, publicKey, sigBytes, datBytes
      );
      if (!sigOK) return { valid: false, maxUsers: 1 };

      if (key.trim() !== payloadKey.trim()) return { valid: false, maxUsers: 1 };

      const diffDays = Math.floor((new Date(expiry) - new Date()) / 86400000);
      if (diffDays < -3) return { valid: false, maxUsers: 1 };

      return { valid: true, maxUsers };
    } catch (err) {
      console.error('[Auth] Payload validation error:', err);
      return { valid: false, maxUsers: 1 };
    }
  }

  // System 2: ECDSA signature only (no payload/expiry — previous system)
  if (AppConfig.ECDSA_PUBLIC_KEY_JWK && AppConfig.LICENSE_SIGNATURE && !AppConfig.LICENSE_PAYLOAD_B64) {
    try {
      const publicKey = await crypto.subtle.importKey(
        'jwk', AppConfig.ECDSA_PUBLIC_KEY_JWK,
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
      );
      const sigBytes = Uint8Array.from(atob(AppConfig.LICENSE_SIGNATURE), c => c.charCodeAt(0));
      const keyBytes = new TextEncoder().encode(key.trim());
      const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } }, publicKey, sigBytes, keyBytes
      );
      return { valid, maxUsers: 1 };
    } catch { return { valid: false, maxUsers: 1 }; }
  }

  // System 3: SHA-256 hash (legacy)
  if (AppConfig.LICENCE_KEY_HASH) {
    try {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key.trim()));
      const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      const valid = timingSafeEqual(hex, AppConfig.LICENCE_KEY_HASH);
      return { valid, maxUsers: 1 };
    } catch { return { valid: false, maxUsers: 1 }; }
  }

  return { valid: false, maxUsers: 1 };
}

/**
 * Decode and return the full licence status from config.js without
 * requiring the user to enter their key.
 * Called on every app load to enforce expiry.
 *
 * @returns {Promise<{
 *   configured:     boolean,
 *   signatureValid: boolean,
 *   keyInPayload:   string,
 *   plan:           string,
 *   planLabel:      string,
 *   issued:         string,
 *   expiry:         string,
 *   customer:       string,
 *   email:          string,
 *   daysRemaining:  number,
 *   isExpired:      boolean,
 *   isInGrace:      boolean,
 *   isWarning:      boolean,
 *   isHealthy:      boolean
 * }>}
 */
async function getLicenceStatus() {
  const GRACE_DAYS   = 3;
  const WARNING_DAYS = 30;
  const PLAN_LABELS  = {
    monthly: 'Monthly', quarterly: 'Quarterly',
    biannual: 'Bi-Annual', annual: 'Annual'
  };

  const fail = (reason = '') => ({
    configured: false, signatureValid: false,
    keyInPayload: '', plan: 'unknown', planLabel: 'Unknown',
    issued: '', expiry: '', customer: '', email: '',
    daysRemaining: -9999, isExpired: true, isInGrace: false,
    isWarning: false, isHealthy: false, _reason: reason
  });

  if (!AppConfig.LICENSE_PAYLOAD_B64 || !AppConfig.LICENSE_SIGNATURE || !AppConfig.ECDSA_PUBLIC_KEY_JWK) {
    return fail('not_configured');
  }

  let payloadStr;
  try { payloadStr = atob(AppConfig.LICENSE_PAYLOAD_B64); }
  catch { return fail('payload_decode_error'); }

  const parts = payloadStr.split('|');
  if (parts.length < 4) return fail('payload_format_error');
  const [keyInPayload, plan, issued, expiry, customer = '', email = ''] = parts;
  const planLabel = PLAN_LABELS[plan] || plan;

  // Verify signature
  let signatureValid = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      'jwk', AppConfig.ECDSA_PUBLIC_KEY_JWK,
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(atob(AppConfig.LICENSE_SIGNATURE), c => c.charCodeAt(0));
    const datBytes = new TextEncoder().encode(payloadStr);
    signatureValid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } }, publicKey, sigBytes, datBytes
    );
  } catch { signatureValid = false; }

  // Calculate days remaining
  const daysRemaining = Math.floor((new Date(expiry) - new Date()) / 86400000);
  const isExpired     = daysRemaining < -GRACE_DAYS;
  const isInGrace     = daysRemaining < 0 && !isExpired;
  const isWarning     = daysRemaining >= 0 && daysRemaining <= WARNING_DAYS;
  const isHealthy     = daysRemaining > WARNING_DAYS;

  return {
    configured: true, signatureValid,
    keyInPayload, plan, planLabel, issued, expiry, customer, email,
    daysRemaining, isExpired, isInGrace, isWarning, isHealthy
  };
}

/**
 * Called once on every app startup (in initApp / after login).
 * Checks expiry and returns whether the app should be accessible.
 * @returns {Promise<{ allowed: boolean, status: object }>}
 */
async function checkLicenceExpiry() {
  const status = await getLicenceStatus();

  // No payload configured → legacy system, no expiry enforcement
  if (!status.configured) return { allowed: true, status };

  // Tampered payload (signature mismatch) → block
  if (!status.signatureValid) return { allowed: false, status };

  // Past grace period → block and show renewal screen
  if (status.isExpired) return { allowed: false, status };

  // In grace, warning, or healthy → allow (UI banners handled separately)
  return { allowed: true, status };
}

/**
 * Store an activation record in localStorage.
 * @param {string} businessName
 * @param {string} keyHash
 * @param {number} maxUsers
 * @param {string} companyHash
 * @param {object} encryptionKeyJwk
 */
function storeActivationRecord(businessName, keyHash, maxUsers, companyHash, encryptionKeyJwk) {
  const record = {
    business_name: businessName,
    activated_at:  new Date().toISOString(),
    key_hash:      keyHash,
    max_users:     maxUsers,
    company_hash:  companyHash,
    encryption_key_jwk: encryptionKeyJwk   // store the AES key (exported as JWK)
  };
  localStorage.setItem(AppConfig.STORAGE_KEYS.ACTIVATION, JSON.stringify(record));
}

/**
 * Clear the activation record (deactivate the licence).
 */
function clearActivationRecord() {
  localStorage.removeItem(AppConfig.STORAGE_KEYS.ACTIVATION);
}

// ─── LOGIN RATE LIMITING ──────────────────────────────────────────────────────
/**
 * Retrieve the login attempt record for a given email.
 * @param {string} email
 * @returns {{ count: number, first_attempt: number, locked_until: number|null }}
 */
function getLoginAttempts(email) {
  try {
    const key = `${AppConfig.STORAGE_KEYS.LOGIN_ATTEMPTS}_${btoa(email)}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : { count: 0, first_attempt: Date.now(), locked_until: null };
  } catch {
    return { count: 0, first_attempt: Date.now(), locked_until: null };
  }
}

/**
 * Record a failed login attempt for a given email.
 * @param {string} email
 * @returns {{ locked: boolean, lockRemainingMs: number }}
 */
function recordFailedAttempt(email) {
  const key      = `${AppConfig.STORAGE_KEYS.LOGIN_ATTEMPTS}_${btoa(email)}`;
  const attempts = getLoginAttempts(email);
  const now      = Date.now();

  // Reset window if first_attempt is outside the window
  if (now - attempts.first_attempt > AppConfig.LOGIN_ATTEMPT_WINDOW_MS) {
    attempts.count         = 0;
    attempts.first_attempt = now;
    attempts.locked_until  = null;
  }

  attempts.count++;

  if (attempts.count >= AppConfig.MAX_LOGIN_ATTEMPTS) {
    attempts.locked_until = now + AppConfig.LOCKOUT_DURATION_MS;
  }

  localStorage.setItem(key, JSON.stringify(attempts));

  const locked          = !!attempts.locked_until && now < attempts.locked_until;
  const lockRemainingMs = locked ? attempts.locked_until - now : 0;

  return { locked, lockRemainingMs };
}

/**
 * Check if a login for this email is currently locked out.
 * @param {string} email
 * @returns {{ locked: boolean, lockRemainingMs: number }}
 */
function checkLoginLock(email) {
  const attempts = getLoginAttempts(email);
  const now      = Date.now();

  if (attempts.locked_until && now < attempts.locked_until) {
    return { locked: true, lockRemainingMs: attempts.locked_until - now };
  }

  return { locked: false, lockRemainingMs: 0 };
}

/**
 * Clear the login attempt record for a given email (on successful login).
 * @param {string} email
 */
function clearLoginAttempts(email) {
  const key = `${AppConfig.STORAGE_KEYS.LOGIN_ATTEMPTS}_${btoa(email)}`;
  localStorage.removeItem(key);
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────
/**
 * Attempt to log in with email and password.
 * Handles rate limiting, password verification, last_login update,
 * session creation, and audit logging.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ success: boolean, user?: Object, error?: string, locked?: boolean, lockRemainingMs?: number }>}
 */
async function login(email, password) {
  // ── 1. Check rate limiting ────────────────────────────────────────────────
  const lockStatus = checkLoginLock(email.trim().toLowerCase());
  if (lockStatus.locked) {
    return {
      success:         false,
      locked:          true,
      lockRemainingMs: lockStatus.lockRemainingMs,
      error:           'Account temporarily locked due to too many failed attempts.'
    };
  }

  try {
    // ── 2. Find user by email ──────────────────────────────────────────────
    const user = await db.users
      .where('email')
      .equals(email.trim().toLowerCase())
      .first();

    if (!user) {
      const result = recordFailedAttempt(email);
      return {
        success:         false,
        locked:          result.locked,
        lockRemainingMs: result.lockRemainingMs,
        error:           'Invalid email address or password.'
      };
    }

    // ── 3. Check account is active ─────────────────────────────────────────
    if (!user.is_active) {
      return {
        success: false,
        error:   'This account has been deactivated. Please contact your administrator.'
      };
    }

    // ── 4. Verify password ─────────────────────────────────────────────────
    const passwordValid = await verifyPassword(password, user.password_hash, user.password_salt);

    if (!passwordValid) {
      const result = recordFailedAttempt(email);
      return {
        success:         false,
        locked:          result.locked,
        lockRemainingMs: result.lockRemainingMs,
        error:           'Invalid email address or password.'
      };
    }

    // ── 5. Successful login ────────────────────────────────────────────────
    clearLoginAttempts(email);

    // Update last_login timestamp
    await db.users.update(user.id, { last_login: new Date().toISOString() });

    // Create session
    setSession(user);

    // Write audit log
    await writeAuditLog({
      action:      'login',
      entity_type: 'users',
      entity_id:   user.id,
      new_values:  { email: user.email, role: user.role }
    });

    return { success: true, user };

  } catch (err) {
    console.error('[Auth] Login error:', err);
    return {
      success: false,
      error:   'A system error occurred. Please try again.'
    };
  }
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────────
/**
 * Log out the current user.
 * Writes an audit log, clears the session, and dispatches a logout event.
 */
async function logout() {
  const user = getSession();

  if (user) {
    try {
      await writeAuditLog({
        action:      'logout',
        entity_type: 'users',
        entity_id:   user.id,
        new_values:  { email: user.email }
      });
    } catch (err) {
      console.warn('[Auth] Audit log on logout failed:', err);
    }
  }

  clearSession();
  window.dispatchEvent(new CustomEvent('auth:logout'));
}

// ─── CHANGE PASSWORD ──────────────────────────────────────────────────────────
/**
 * Change the password for the currently authenticated user.
 * Verifies the current password before proceeding.
 *
 * @param {string} currentPassword
 * @param {string} newPassword
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function changePassword(currentPassword, newPassword) {
  const sessionUser = getSession();
  if (!sessionUser) return { success: false, error: 'Not authenticated.' };

  try {
    // Fetch full user record from DB
    const user = await db.users.get(sessionUser.id);
    if (!user) return { success: false, error: 'User record not found.' };

    // Verify current password
    const valid = await verifyPassword(currentPassword, user.password_hash, user.password_salt);
    if (!valid) {
      return { success: false, error: 'Current password is incorrect.' };
    }

    // Validate new password strength
    const strengthResult = validatePasswordStrength(newPassword);
    if (!strengthResult.valid) {
      return { success: false, error: strengthResult.message };
    }

    // Hash new password with a fresh salt
    const { hash, salt } = await hashPassword(newPassword);

    // Update DB record
    await db.users.update(user.id, {
      password_hash:         hash,
      password_salt:         salt,
      force_password_change: false
    });

    // Update session to clear the forced-change flag
    updateSessionField('force_password_change', false);

    // Audit log
    await writeAuditLog({
      action:      'update',
      entity_type: 'users',
      entity_id:   user.id,
      new_values:  { changed_field: 'password' }
    });

    return { success: true };

  } catch (err) {
    console.error('[Auth] Change password error:', err);
    return { success: false, error: 'A system error occurred. Please try again.' };
  }
}

/**
 * Admin resets another user's password directly.
 * Sets force_password_change = true on the target account.
 *
 * @param {number} userId
 * @param {string} newPassword
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function adminResetPassword(userId, newPassword) {
  const sessionUser = getSession();
  if (!sessionUser || sessionUser.role !== 'admin') {
    return { success: false, error: 'Administrator access required.' };
  }

  const strengthResult = validatePasswordStrength(newPassword);
  if (!strengthResult.valid) {
    return { success: false, error: strengthResult.message };
  }

  try {
    const { hash, salt } = await hashPassword(newPassword);

    await db.users.update(Number(userId), {
      password_hash:         hash,
      password_salt:         salt,
      force_password_change: true
    });

    await writeAuditLog({
      action:      'update',
      entity_type: 'users',
      entity_id:   Number(userId),
      new_values:  { changed_field: 'password_by_admin' }
    });

    return { success: true };

  } catch (err) {
    console.error('[Auth] Admin reset password error:', err);
    return { success: false, error: 'A system error occurred.' };
  }
}

// ─── PASSWORD STRENGTH VALIDATION ────────────────────────────────────────────
/**
 * Validate password strength.
 * Rules: min 8 chars, at least one uppercase, one number, one special char.
 * @param {string} password
 * @returns {{ valid: boolean, score: number, level: string, message: string }}
 */
function validatePasswordStrength(password) {
  const rules = [
    { test: /.{8,}/,              label: 'at least 8 characters' },
    { test: /[A-Z]/,              label: 'at least one uppercase letter' },
    { test: /[0-9]/,              label: 'at least one number' },
    { test: /[^A-Za-z0-9]/,      label: 'at least one special character (!@#$% etc.)' }
  ];

  const passed = rules.filter(r => r.test.test(password));
  const score  = passed.length; // 0–4

  const levels = ['', 'weak', 'fair', 'good', 'strong'];
  const level  = levels[score] || '';

  const failed = rules.filter(r => !r.test.test(password));
  const valid  = score === 4;

  return {
    valid,
    score,
    level,
    message: valid
      ? 'Password is strong.'
      : `Password must include ${failed.map(r => r.label).join(', ')}.`
  };
}

// ─── ROLE CHECKING ────────────────────────────────────────────────────────────
/**
 * Check if a given role meets or exceeds the required minimum role.
 * Role hierarchy (ascending): staff < manager < admin
 * @param {string} userRole
 * @param {string} requiredRole
 * @returns {boolean}
 */
function hasRole(userRole, requiredRole) {
  const hierarchy = AppConfig.ROLE_HIERARCHY; // ['staff','manager','admin']
  const userLevel     = hierarchy.indexOf(userRole);
  const requiredLevel = hierarchy.indexOf(requiredRole);

  if (userLevel === -1 || requiredLevel === -1) return false;
  return userLevel >= requiredLevel;
}

/**
 * Quick check: is the current session user an admin?
 * @returns {boolean}
 */
function isAdmin() {
  const user = getSession();
  return user?.role === 'admin';
}

/**
 * Quick check: is the current session user a manager or admin?
 * @returns {boolean}
 */
function isManagerOrAbove() {
  const user = getSession();
  return user ? hasRole(user.role, 'manager') : false;
}

// ─── UI HANDLERS ─────────────────────────────────────────────────────────────
/**
 * Initialise the activation overlay event handlers.
 * @param {Function} onSuccess - Called when activation succeeds.
 */
function initActivationUI(onSuccess) {
  const overlay  = document.getElementById('activation-overlay');
  const form     = document.getElementById('activation-form');
  const btnText  = document.querySelector('#activate-btn .btn-text');
  const btnSpinner = document.querySelector('#activate-btn .btn-spinner');
  const nameInput  = document.getElementById('act-business-name');
  const keyInput   = document.getElementById('act-licence-key');
  const nameErr    = document.getElementById('act-business-name-err');
  const keyErr     = document.getElementById('act-licence-key-err');
  const errBox     = document.getElementById('activation-error');

  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Clear errors
    nameErr.textContent  = '';
    keyErr.textContent   = '';
    errBox.textContent   = '';
    errBox.classList.add('hidden');

    const businessName = nameInput.value.trim();
    const licenceKey   = keyInput.value.trim();
    let   hasError     = false;

    if (!businessName) {
      nameErr.textContent = 'Business name is required.';
      hasError = true;
    }
    if (!licenceKey) {
      keyErr.textContent = 'Licence key is required.';
      hasError = true;
    }
    if (hasError) return;

    // Show spinner
    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');

    try {
      const { valid, maxUsers } = await validateLicenceKey(licenceKey);
      if (!valid) {
        keyErr.textContent = 'Invalid licence key. Please check and try again.';
        return;
      }

      // Generate company hash and tenant‑specific encryption
      const companyHash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(businessName.trim().toLowerCase())
      ).then(buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));

      const passphrase = businessName.trim() + '|' + licenceKey.trim();
      const saltKey = `stockdity_salt_${companyHash}`;
      let salt = localStorage.getItem(saltKey);
      if (!salt) {
        salt = generateSalt();  // from crypto.js (base64 32-byte)
        localStorage.setItem(saltKey, salt);
      }
      const encryptionKey = await deriveKey(passphrase, salt);
      setEncryptionKey(encryptionKey);

      // Export the key as JWK and store it in the activation record
      const encryptionKeyJwk = await exportKeyToJwk(encryptionKey);

      const encoder = new TextEncoder();
      const data = encoder.encode(licenceKey.trim());
      const buf = await crypto.subtle.digest('SHA-256', data);
      const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

      storeActivationRecord(businessName, hash, maxUsers, companyHash, encryptionKeyJwk);

      // Register the device
      const deviceReg = await registerDevice(companyHash, maxUsers);
      if (!deviceReg.success) {
        keyErr.textContent = deviceReg.error;
        return;
      }

      // Update business name in DB settings if DB is ready
      try {
        const { setSetting } = await import('./db.js');
        await setSetting('business_name', businessName);
      } catch { /* DB may not be seeded yet — settings will be set during seed */ }

      overlay.classList.add('hidden');
      onSuccess(businessName);

    } catch (err) {
      console.error('[Auth] Activation error:', err);
      errBox.textContent = 'Activation failed due to a system error. Please try again.';
      errBox.classList.remove('hidden');
    } finally {
      btnText.classList.remove('hidden');
      btnSpinner.classList.add('hidden');
    }
  });
}

// ─── DEVICE REGISTRY (user limit enforcement) ──────────────────────────────

async function getDeviceFingerprint() {
  let deviceId = localStorage.getItem('stockdity_device_id');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem('stockdity_device_id', deviceId);
  }
  return deviceId;
}

async function registerDevice(companyHash, maxUsers) {
  const deviceId = await getDeviceFingerprint();
  const existing = await db.device_registry.where('device_id').equals(deviceId).first();
  if (existing) return { success: true };

  const count = await db.device_registry.where('company_hash').equals(companyHash).count();
  if (count >= maxUsers) {
    return { success: false, error: `Licence limit (${maxUsers} device(s)) exceeded.` };
  }

  await db.device_registry.add({
    device_id: deviceId,
    company_hash: companyHash,
    registered_at: new Date().toISOString()
  });
  return { success: true };
}

async function checkDeviceAllowed(companyHash, maxUsers) {
  const deviceId = await getDeviceFingerprint();
  const registered = await db.device_registry.where('device_id').equals(deviceId).first();
  if (registered) return { allowed: true };

  const count = await db.device_registry.where('company_hash').equals(companyHash).count();
  if (count >= maxUsers) {
    return { allowed: false, error: `This licence is already active on ${count} device(s).` };
  }
  return { allowed: true };
}

/**
 * Initialise the login form event handlers.
 * @param {Function} onSuccess - Called with the user object on successful login.
 */
function initLoginUI(onSuccess) {
  const form         = document.getElementById('login-form');
  const emailInput   = document.getElementById('login-email');
  const pwdInput     = document.getElementById('login-password');
  const pwdToggle    = document.getElementById('login-pwd-toggle');
  const emailErr     = document.getElementById('login-email-err');
  const pwdErr       = document.getElementById('login-password-err');
  const errBox       = document.getElementById('login-error');
  const blockedMsg   = document.getElementById('login-blocked-msg');
  const countdown    = document.getElementById('lockout-countdown');
  const btnText      = document.querySelector('#login-btn .btn-text');
  const btnSpinner   = document.querySelector('#login-btn .btn-spinner');
  const loginBtn     = document.getElementById('login-btn');

  if (!form) return;

  let lockoutTimer = null;

  // Password visibility toggle
  if (pwdToggle) {
    pwdToggle.addEventListener('click', () => {
      const isText = pwdInput.type === 'text';
      pwdInput.type = isText ? 'password' : 'text';
      pwdToggle.querySelector('i').className = isText
        ? 'fa-solid fa-eye'
        : 'fa-solid fa-eye-slash';
    });
  }

  // Check if the email field already has a value (pre-fill check)
  if (emailInput.value) {
    checkAndShowLockout(emailInput.value);
  }

  emailInput.addEventListener('blur', () => {
    checkAndShowLockout(emailInput.value.trim().toLowerCase());
  });

  function checkAndShowLockout(email) {
    if (!email) return;
    const lock = checkLoginLock(email);
    if (lock.locked) {
      showLockout(lock.lockRemainingMs);
    }
  }

  function showLockout(remainingMs) {
    if (lockoutTimer) clearInterval(lockoutTimer);

    blockedMsg.classList.remove('hidden');
    loginBtn.disabled = true;
    emailInput.disabled = true;
    pwdInput.disabled   = true;

    let remaining = Math.ceil(remainingMs / 1000);

    function updateCountdown() {
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      if (countdown) countdown.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }

    updateCountdown();

    lockoutTimer = setInterval(() => {
      remaining--;
      updateCountdown();
      if (remaining <= 0) {
        clearInterval(lockoutTimer);
        blockedMsg.classList.add('hidden');
        loginBtn.disabled   = false;
        emailInput.disabled = false;
        pwdInput.disabled   = false;
      }
    }, 1000);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Clear previous errors
    emailErr.textContent = '';
    pwdErr.textContent   = '';
    errBox.textContent   = '';
    errBox.classList.add('hidden');

    const email    = emailInput.value.trim().toLowerCase();
    const password = pwdInput.value;
    let   hasError = false;

    if (!email) {
      emailErr.textContent = 'Email address is required.';
      hasError = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      emailErr.textContent = 'Please enter a valid email address.';
      hasError = true;
    }

    if (!password) {
      pwdErr.textContent = 'Password is required.';
      hasError = true;
    }

    if (hasError) return;

    // Show spinner
    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');
    loginBtn.disabled = true;

    try {
      const result = await login(email, password);

      if (result.success) {
        onSuccess(result.user);
      } else if (result.locked) {
        showLockout(result.lockRemainingMs);
      } else {
        errBox.textContent = result.error || 'Login failed. Please try again.';
        errBox.classList.remove('hidden');
        pwdInput.value = '';
        pwdInput.focus();
      }

    } finally {
      btnText.classList.remove('hidden');
      btnSpinner.classList.add('hidden');
      if (!loginBtn.disabled || !checkLoginLock(email).locked) {
        loginBtn.disabled = false;
      }
    }
  });
}

/**
 * Initialise the forced password change form.
 * @param {Function} onSuccess - Called when password change succeeds.
 */
function initForceChangePasswordUI(onSuccess) {
  const form        = document.getElementById('force-change-password-form');
  const currentInput = document.getElementById('fcp-current');
  const newInput    = document.getElementById('fcp-new');
  const confirmInput = document.getElementById('fcp-confirm');
  const newToggle   = document.getElementById('fcp-new-toggle');
  const strengthBar = document.getElementById('fcp-strength-bar');
  const strengthLbl = document.getElementById('fcp-strength-label');
  const currentErr  = document.getElementById('fcp-current-err');
  const newErr      = document.getElementById('fcp-new-err');
  const confirmErr  = document.getElementById('fcp-confirm-err');
  const errBox      = document.getElementById('fcp-error');
  const btnText     = document.querySelector('#fcp-submit-btn .btn-text');
  const btnSpinner  = document.querySelector('#fcp-submit-btn .btn-spinner');
  const submitBtn   = document.getElementById('fcp-submit-btn');

  if (!form) return;

  // Password visibility toggle
  if (newToggle) {
    newToggle.addEventListener('click', () => {
      const isText = newInput.type === 'text';
      newInput.type = isText ? 'password' : 'text';
      newToggle.querySelector('i').className = isText
        ? 'fa-solid fa-eye'
        : 'fa-solid fa-eye-slash';
    });
  }

  // Real-time strength meter
  newInput.addEventListener('input', () => {
    const val = newInput.value;
    if (!val) {
      strengthBar.className = 'progress-bar';
      strengthBar.style.width = '0%';
      strengthLbl.textContent = '';
      return;
    }
    const result = validatePasswordStrength(val);
    strengthBar.className = `progress-bar strength-${result.level}`;
    const labels = { weak: 'Weak', fair: 'Fair', good: 'Good', strong: 'Strong' };
    strengthLbl.textContent = labels[result.level] || '';
    strengthLbl.style.color = result.level === 'strong'
      ? 'var(--color-success)' : result.level === 'good'
      ? 'var(--color-info)' : 'var(--color-warning)';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    currentErr.textContent = '';
    newErr.textContent     = '';
    confirmErr.textContent = '';
    errBox.textContent     = '';
    errBox.classList.add('hidden');

    const currentPwd = currentInput.value;
    const newPwd     = newInput.value;
    const confirmPwd = confirmInput.value;
    let   hasError   = false;

    if (!currentPwd) {
      currentErr.textContent = 'Current password is required.';
      hasError = true;
    }

    if (!newPwd) {
      newErr.textContent = 'New password is required.';
      hasError = true;
    } else {
      const strength = validatePasswordStrength(newPwd);
      if (!strength.valid) {
        newErr.textContent = strength.message;
        hasError = true;
      }
    }

    if (newPwd && confirmPwd !== newPwd) {
      confirmErr.textContent = 'Passwords do not match.';
      hasError = true;
    }

    if (hasError) return;

    btnText.classList.add('hidden');
    btnSpinner.classList.remove('hidden');
    submitBtn.disabled = true;

    try {
      const result = await changePassword(currentPwd, newPwd);

      if (result.success) {
        showToast('Password changed successfully!', 'success');
        onSuccess();
      } else {
        errBox.textContent = result.error || 'Failed to change password.';
        errBox.classList.remove('hidden');
        currentInput.value = '';
        currentInput.focus();
      }
    } finally {
      btnText.classList.remove('hidden');
      btnSpinner.classList.add('hidden');
      submitBtn.disabled = false;
    }
  });
}

// ─── AVATAR COLOUR HELPER ─────────────────────────────────────────────────────
/**
 * Generate a deterministic avatar colour class from a user's name.
 * Returns a CSS class name like 'avatar-color-3'.
 * @param {string} name
 * @returns {string}
 */
function getAvatarColorClass(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const index = Math.abs(hash) % 8;
  return `avatar-color-${index}`;
}

/**
 * Generate avatar initials from a full name.
 * @param {string} name
 * @returns {string} 1–2 uppercase characters
 */
function generateInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Check localStorage for a stored activation record.
 * @returns {{ business_name: string, activated_at: string, expires: string }|null}
 */
function getActivationRecord() {
  try {
    const raw = localStorage.getItem(AppConfig.STORAGE_KEYS.ACTIVATION);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export {
  // Session
  setSession,
  getSession,
  clearSession,
  updateSessionField,

  // Password
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  generatePasswordSalt,        // renamed local salt generator

  // Licence
  validateLicenceKey,
  getActivationRecord,
  storeActivationRecord,
  clearActivationRecord,
  getLicenceStatus,
  checkLicenceExpiry,

  // Rate limiting
  getLoginAttempts,
  recordFailedAttempt,
  checkLoginLock,
  clearLoginAttempts,

  // Core auth
  login,
  logout,
  changePassword,
  adminResetPassword,

  // Role checks
  hasRole,
  isAdmin,
  isManagerOrAbove,

  // UI initialisers
  initActivationUI,
  initLoginUI,
  initForceChangePasswordUI,

  // Avatar helpers
  getAvatarColorClass,
  generateInitials
};
