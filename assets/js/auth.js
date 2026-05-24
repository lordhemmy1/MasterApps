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
function generateSalt() {
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
  const usedSalt = salt || generateSalt();
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
 * Validate a licence key using ECDSA P-256 digital signature verification.
 * Falls back to SHA-256 hash comparison for legacy deployments.
 * @param {string} key
 * @returns {Promise<boolean>}
 */
/**
 * Validate a licence key using ECDSA P-256 digital signature verification.
 * Falls back to SHA-256 hash comparison for legacy deployments.
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function validateLicenceKey(key) {
  // ── Primary: ECDSA P-256 Signature Verification ───────────────────────────
  // This system is cryptographically unforgeable without the seller's private key.
  if (AppConfig.ECDSA_PUBLIC_KEY_JWK && AppConfig.LICENSE_SIGNATURE) {
    try {
      // Import the public key from config.js
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        AppConfig.ECDSA_PUBLIC_KEY_JWK,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,           // non-extractable
        ['verify']
      );

      // Decode the stored base64 signature to raw bytes
      const signatureBytes = Uint8Array.from(
        atob(AppConfig.LICENSE_SIGNATURE),
        c => c.charCodeAt(0)
      );

      // Encode the entered key to bytes (must match exactly what was signed)
      const keyBytes = new TextEncoder().encode(key.trim());

      // Verify: did the private key (matching publicKey) sign keyBytes → signatureBytes?
      const isValid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        publicKey,
        signatureBytes,
        keyBytes
      );

      return isValid;
    } catch (err) {
      console.error('[Auth] ECDSA verification failed:', err);
      return false;
    }
  }

  // ── Fallback: SHA-256 Hash Comparison (legacy deployments only) ───────────
  if (AppConfig.LICENCE_KEY_HASH) {
    try {
      const encoder    = new TextEncoder();
      const data       = encoder.encode(key.trim());
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray  = Array.from(new Uint8Array(hashBuffer));
      const hashHex    = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return timingSafeEqual(hashHex, AppConfig.LICENCE_KEY_HASH);
    } catch (err) {
      console.error('[Auth] SHA-256 fallback failed:', err);
      return false;
    }
  }

  // No validation method configured — deny all
  console.error('[Auth] No licence validation method configured in AppConfig.');
  return false;
}

  // ── Fallback: SHA-256 Hash Comparison (legacy deployments only) ───────────
  if (AppConfig.LICENCE_KEY_HASH) {
    try {
      const encoder    = new TextEncoder();
      const data       = encoder.encode(key.trim());
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray  = Array.from(new Uint8Array(hashBuffer));
      const hashHex    = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return timingSafeEqual(hashHex, AppConfig.LICENCE_KEY_HASH);
    } catch (err) {
      console.error('[Auth] SHA-256 fallback failed:', err);
      return false;
    }
  }

  // No validation method configured — deny all
  console.error('[Auth] No licence validation method configured in AppConfig.');
  return false;
}

/**
 * Store an activation record in localStorage.
 * @param {string} businessName
 * @param {string} keyHash
 */
function storeActivationRecord(businessName, keyHash) {
  const record = {
    business_name: businessName,
    activated_at:  new Date().toISOString(),
    key_hash:      keyHash
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
      const valid = await validateLicenceKey(licenceKey);

      if (!valid) {
        keyErr.textContent = 'Invalid licence key. Please check and try again.';
        return;
      }

      // Store activation
      const encoder = new TextEncoder();
      const data    = encoder.encode(licenceKey.trim());
      const buf     = await crypto.subtle.digest('SHA-256', data);
      const hash    = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

      storeActivationRecord(businessName, hash);

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
  generateSalt,

  // Licence
  validateLicenceKey,
  getActivationRecord,
  storeActivationRecord,
  clearActivationRecord,

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
