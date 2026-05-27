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
 *   1. Open keygen.html in Chrome or Edge.
 *   2. Generate (or load) your ECDSA P-256 key pair.
 *   3. Enter the licence key, plan, and customer details.
 *   4. Click "Sign Licence Key" then "Auto-Update config.js File".
 *   5. The tool writes ECDSA_PUBLIC_KEY_JWK, LICENSE_PAYLOAD_B64,
 *      and LICENSE_SIGNATURE directly into this file.
 *   6. NEVER share keygen.html or your private key with the customer.
 *
 * SECURITY NOTE:
 *   The ECDSA private key never appears here. Forging a valid signature
 *   without the private key requires breaking P-256 discrete logarithm
 *   — computationally infeasible with current technology.
 *
 * ============================================================
 */

const AppConfig = Object.freeze({

  // ── ECDSA Licence — Customer: Ascendia Pharmacy | Plan: Annual (365 days)
  // ─────────────────────────────────────────────────────────────────────────
  // All three values below are written by keygen.html. Do NOT edit manually.
  // Having any of these keys appear MORE THAN ONCE in this object causes the
  // last value to silently overwrite the first, breaking licence validation.
  // ─────────────────────────────────────────────────────────────────────────

  ECDSA_PUBLIC_KEY_JWK: {
    "crv":     "P-256",
    "ext":     true,
    "key_ops": ["verify"],
    "kty":     "EC",
    "x":       "lEkY1SXmjgjFBwGx4aNAoaztlMlex6MxYMafb2nzb10",
    "y":       "Ed9uGojUezDmjWMlAbAqjdVkLPX7IVi0ISzOwjjml4w"
  },

  // Signed payload: licenceKey|plan|issued|expiry|customer|email  (base64)
  LICENSE_PAYLOAD_B64: 'U1MtMjAyNi1FOVJOLU5SNlotUURNWC1UWTg5LUFNUFZ8YW5udWFsfDIwMjYtMDUtMjN8MjAyNy0wNS0yM3xBc2NlbmRpYSBQaGFybWFjeXxhc2NlbmRpYUBnbWFpbC5jb20=',

  // ECDSA P-256 raw signature of the decoded payload bytes
  LICENSE_SIGNATURE: '5Pcav1QVkmzjteFuRG7Bs3JE+yfbhB2Jrn0hlGb8ud7bhZiWQQe5GTzi0ZNM9NT+ewcr151k3xxzm0UPcsIv0g==',

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
  DB_VERSION: 2,

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
  DASHBOARD_TREND_DAYS: 30

  // ─────────────────────────────────────────────────────────────────────────
  // NOTE: Do NOT add any properties after this line.
  // The ECDSA licence fields at the TOP of this object are the only ones
  // that change between customer deployments. Adding a second ECDSA block
  // anywhere below will silently overwrite them and break activation.
  // ─────────────────────────────────────────────────────────────────────────

});

window.AppConfig = AppConfig;
export default AppConfig;
