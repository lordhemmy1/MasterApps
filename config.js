/**
 * ============================================================
 * Stockdity IMS — Configuration File
 * ============================================================
 *
 * PURPOSE:
 *   This is the ONLY file that changes between customer deployments.
 *   The seller customises these values for each buyer before delivery.
 *
 * LICENCE KEY SETUP (for sellers):
 *   1. Choose a unique licence key for the customer, e.g.:
 *        SS-2024-XKQP-8823-MNVZ
 *   2. Generate its SHA-256 hash. You can do this with the included
 *      keygen utility (keygen.html) or via any SHA-256 tool:
 *        - Online: https://emn178.github.io/online-tools/sha256.html
 *        - Node.js: require('crypto').createHash('sha256').update('YOUR-KEY').digest('hex')
 *        - PowerShell: (Get-FileHash -InputStream ([System.IO.MemoryStream]::new(
 *            [System.Text.Encoding]::UTF8.GetBytes('YOUR-KEY'))) -Algorithm SHA256).Hash
 *   3. Paste the resulting hex string (64 characters) into LICENCE_KEY_HASH below.
 *   4. NEVER put the raw key itself anywhere in this file or any other file.
 *      Only the hash goes here. The original key is given to the buyer separately
 *      (e.g., in their purchase confirmation email).
 *
 * SECURITY NOTE:
 *   Because this is a client-side application, a determined user who inspects
 *   the source could attempt to brute-force the key. Use long, random keys
 *   (e.g., UUID + random suffix, minimum 20 characters) to make this
 *   computationally infeasible. See README.md for full security guidance.
 *
 * ============================================================
 */

const AppConfig = Object.freeze({

  // ── LICENCE ──────────────────────────────────────────────────────────────
  /**
   * ECDSA P-256 Public Key (JWK format).
   * Generated once by keygen.html. Auto-populated — do not edit manually.
   */
            // ── ECDSA Licence — Customer: Ascendia Pharmacy | Plan: Bi-Annual (182 days)
  ECDSA_PUBLIC_KEY_JWK: {
      "crv": "P-256",
      "ext": true,
      "key_ops": [
          "verify"
      ],
      "kty": "EC",
      "x": "lEkY1SXmjgjFBwGx4aNAoaztlMlex6MxYMafb2nzb10",
      "y": "Ed9uGojUezDmjWMlAbAqjdVkLPX7IVi0ISzOwjjml4w"
  },

  // Signed payload: licenceKey|plan|issued|expiry|customer|email (base64)
  LICENSE_PAYLOAD_B64: 'U1MtMjAyNi1YN1dHLTRDVzgtTkU1Qy1VS0s1LU1LVld8Ymlhbm51YWx8MjAyNi0wNS0yM3wyMDI2LTExLTIxfEFzY2VuZGlhIFBoYXJtYWN5fGluZm9AYXNjZW5kaWEuY29t',

  // ECDSA P-256 signature of the decoded payload bytes
  LICENSE_SIGNATURE: 'WCPRODqhwxXKaU9eq9IvYpEyT8J6OQaS9HshczRu/f82QJZ4hlKx+D5zVrzPwhBHWdUFjpKbQ3FdO6/TuOf9BA==',

  // ── APPLICATION IDENTITY ─────────────────────────────────────────────────
  APP_NAME:               'Stockdity IMS',
  APP_TAGLINE:            'Inventory. Simplified.',
  APP_VERSION:            '1.0.0',
  APP_RELEASE_DATE:       '2025-01-01',

  // ── LOCALISATION ─────────────────────────────────────────────────────────
  DEFAULT_CURRENCY_SYMBOL: '₦',
  DEFAULT_TIMEZONE:        'Africa/Lagos',
  DEFAULT_DATE_FORMAT:     'DD/MM/YYYY',

  // ── DEFAULTS ─────────────────────────────────────────────────────────────
  DEFAULT_LOW_STOCK_THRESHOLD: 10,
  DEFAULT_PAGE_SIZE:           20,
  MAX_IMAGE_SIZE_BYTES:        2097152,
  MAX_LOGO_SIZE_BYTES:         1048576,
  ALLOWED_IMAGE_TYPES:         ['image/jpeg', 'image/png', 'image/webp'],

  // ── SECURITY ─────────────────────────────────────────────────────────────
  MAX_LOGIN_ATTEMPTS:        5,
  LOGIN_ATTEMPT_WINDOW_MS:   600000,
  LOCKOUT_DURATION_MS:       900000,

  // ── NOTIFICATIONS ────────────────────────────────────────────────────────
  EXPIRY_WARNING_DAYS:   30,
  TOPBAR_NOTIF_LIMIT:    5,

  // ── PERFORMANCE ──────────────────────────────────────────────────────────
  SEARCH_DEBOUNCE_MS:        300,
  SCROLL_TOP_THRESHOLD_PX:   300,

  // ── DATABASE ─────────────────────────────────────────────────────────────
  DB_NAME:    'StockdityIMS',
  DB_VERSION: 1,

  // ── SEED ─────────────────────────────────────────────────────────────────
  SEED_ADMIN_EMAIL:    'admin@app.com',
  SEED_ADMIN_PASSWORD: 'Admin@1234',
  SEED_ADMIN_NAME:     'System Administrator',

  // ── STORAGE KEYS ─────────────────────────────────────────────────────────
  STORAGE_KEYS: Object.freeze({
    ACTIVATION:     'stockdity_activation',
    LOGIN_ATTEMPTS: 'stockdity_login_attempts',
    SIDEBAR_STATE:  'stockdity_sidebar_collapsed'
  }),

  SESSION_KEYS: Object.freeze({
    AUTH_USER:   'auth_user',
    SALES_CART:  'sales_cart'
  }),

  // ── ROLE HIERARCHY ───────────────────────────────────────────────────────
  ROLE_HIERARCHY: ['staff', 'manager', 'admin'],

  // ── UI THEME ─────────────────────────────────────────────────────────────
  DEFAULT_PRIMARY_COLOR: '#4F46E5',

  // ── REPORT DEFAULTS ──────────────────────────────────────────────────────
  TOP_PRODUCTS_LIMIT:   20,
  DASHBOARD_TREND_DAYS: 30,

  // ── LICENCE ──────────────────────────────────────────────────────────────
  ECDSA_PUBLIC_KEY_JWK: {
      "crv": "P-256",
      "ext": true,
      "key_ops": ["verify"],
      "kty": "EC",
      "x": "lEkY1SXmjgjFBwGx4aNAoaztlMlex6MxYMafb2nzb10",
      "y": "Ed9uGojUezDmjWMlAbAqjdVkLPX7IVi0ISzOwjjml4w"
  },

  LICENSE_SIGNATURE: 'VQWXSbdqymKDCnwn6o9+L8TqTM0XJIa2GPacZfRXnh/lJ5qEis0SsDnqMfV2qHOr6UbQnX/PW1WbIXaDFO3N0A==',

});

window.AppConfig = AppConfig;
export default AppConfig;
