/**
 * Stockdity IMS — Application Bootstrap
 * Entry point loaded by index.html via <script type="module">.
 * Orchestrates: licence check → DB init → seed → auth → router → UI setup.
 */

import AppConfig from '../../config.js';
import db, { seedDatabase, migrateIsActiveValues, getAllSettings, getSetting } from './db.js';
import {
  getActivationRecord,
  getSession,
  setSession,
  clearSession,
  logout,
  initActivationUI,
  initLoginUI,
  initForceChangePasswordUI,
  getAvatarColorClass,
  generateInitials
} from './auth.js';
import {
  updateUserUI,
  applyPrimaryColor,
  initSidebarToggle,
  initTopbarDropdowns,
  initScrollToTop,
  initOfflineBanner,
  updateNotificationBadge,
  showToast,
  showSpinner,
  hideSpinner
} from './ui.js';
import { initRouter, navigateTo, filterSidebarByRole } from './router.js';
import { getUnreadNotificationCount } from './db.js';

// ─── GLOBAL APP STATE ─────────────────────────────────────────────────────────
/**
 * Central in-memory state object.
 * All modules read/write through window.AppState for shared state.
 */
window.AppState = {
  user:        null,   // Current authenticated user (from session)
  settings:    {},     // Loaded from app_settings store
  isReady:     false   // True after DB is open and seeded
};

// Expose auth helpers globally so ui.js can call them without circular imports
window._authHelpers = { getAvatarColorClass, generateInitials };

// ─── MAIN ENTRY POINT ─────────────────────────────────────────────────────────
/**
 * initApp() — called once from index.html on page load.
 * Sequence:
 *   1. Open IndexedDB (Dexie auto-opens on first query)
 *   2. Seed database if first run
 *   3. Check licence activation
 *   4. If activated → check session → show app or login
 *   5. Initialise router and app shell UI
 */
async function initApp() {
  try {
    showSpinner();

    await db.open();
    window._db = db;

    await seedDatabase();

    // ── Run one-time migration (boolean → integer is_active) ──────────────
    await migrateIsActiveValues();

    const settings = await getAllSettings();
    window.AppState.settings = settings;
    window._appSettings      = settings;

    if (settings.primary_color) {
      applyPrimaryColor(settings.primary_color);
    }

    document.title = settings.business_name || AppConfig.APP_NAME;
    window.AppState.isReady = true;
    hideSpinner();

    dismissPreJSLoader();

    initPWAInstall();
  initLicenceExpiryCheck();

    const activation = getActivationRecord();
    if (!activation) {
      showActivationScreen();
      return;
    }

    proceedAfterActivation(activation.business_name);

  } catch (err) {
    hideSpinner();
    dismissPreJSLoader();
    console.error('[App] Fatal initialisation error:', err);
    showFatalError(err);
  }
}

/**
 * Smoothly dismiss the pre-JS loading overlay.
 * Uses a CSS fade-out transition before hiding completely.
 */
function dismissPreJSLoader() {
  const loader = document.getElementById('pre-js-loader');
  if (!loader) return;

  // If already gone, do nothing
  if (loader.classList.contains('hidden')) return;

  loader.classList.add('fade-out');

  // After the CSS transition completes, fully hide it
  loader.addEventListener('transitionend', () => {
    loader.classList.add('hidden');
  }, { once: true });

  // Safety fallback in case transitionend doesn't fire
  setTimeout(() => {
    loader.classList.add('hidden');
  }, 400);
}

// ─── LICENCE EXPIRY ENFORCEMENT ───────────────────────────────────────────────
import { checkLicenceExpiry, getLicenceStatus } from './auth.js';

async function initLicenceExpiryCheck() {
  const { allowed, status } = await checkLicenceExpiry();

  if (!allowed) {
    // Block access and show renewal overlay
    showLicenceExpiredOverlay(status);
    return;
  }

  if (status.isInGrace) {
    showLicenceBanner(
      'danger',
      `⚠️ Your ${status.planLabel} licence expired ${Math.abs(status.daysRemaining)} day(s) ago. ` +
      `You have ${3 + status.daysRemaining} grace day(s) left. ` +
      `<a href="mailto:ascendiacore@gmail.com" style="color:inherit;font-weight:700;text-decoration:underline;">Renew now</a>`
    );
    return;
  }

  if (status.isWarning) {
    showLicenceBanner(
      'warning',
      `🔔 Your ${status.planLabel} licence expires in <strong>${status.daysRemaining} day(s)</strong> ` +
      `(${new Date(status.expiry).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}). ` +
      `<a href="mailto:ascendiacore@gmail.com" style="color:inherit;font-weight:700;text-decoration:underline;">Contact us to renew</a>`
    );
  }
}

function showLicenceBanner(type, html) {
  const existing = document.getElementById('licence-banner');
  if (existing) existing.remove();

  const colors = {
    warning: { bg: '#FEF3C7', border: '#D97706', text: '#92400E' },
    danger:  { bg: '#FEE2E2', border: '#DC2626', text: '#991B1B' }
  };
  const c = colors[type] || colors.warning;

  const banner = document.createElement('div');
  banner.id = 'licence-banner';
  banner.style.cssText = `
    position:fixed; top:0; left:0; right:0; z-index:2000;
    background:${c.bg}; border-bottom:2px solid ${c.border};
    color:${c.text}; padding:10px 20px;
    display:flex; align-items:center; justify-content:space-between;
    font-size:0.85rem; font-weight:500; gap:12px;
    box-shadow:0 2px 8px rgba(0,0,0,0.1);
  `;
  banner.innerHTML = `
    <span>${html}</span>
    <button onclick="this.parentElement.remove()"
      style="background:none;border:none;cursor:pointer;font-size:1.1rem;color:${c.text};padding:0 4px;flex-shrink:0;"
      aria-label="Dismiss">✕</button>
  `;

  document.body.prepend(banner);

  // Offset topbar to account for banner
  const topbar = document.getElementById('topbar');
  if (topbar) topbar.style.top = banner.offsetHeight + 'px';
}

function showLicenceExpiredOverlay(status) {
  // Hide the main app
  document.getElementById('app-shell')?.classList.add('hidden');

  const planLabel    = status.planLabel || 'Licence';
  const expiryFormatted = status.expiry
    ? new Date(status.expiry).toLocaleDateString('en-GB',
        { weekday:'long', day:'numeric', month:'long', year:'numeric' })
    : 'Unknown';

  const overlay = document.createElement('div');
  overlay.id    = 'licence-expired-overlay';
  overlay.style.cssText = `
    position:fixed; inset:0; z-index:9999;
    background:linear-gradient(135deg,#1E1B4B 0%,#312E81 100%);
    display:flex; align-items:center; justify-content:center;
    padding:2rem; font-family:'Inter',sans-serif;
  `;
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:16px;padding:2.5rem;max-width:480px;width:100%;
                box-shadow:0 20px 40px rgba(0,0,0,0.3);text-align:center;">
      <div style="font-size:3rem;margin-bottom:1rem;">🔒</div>
      <h2 style="font-size:1.5rem;font-weight:700;color:#111827;margin-bottom:.5rem;">
        Licence Expired
      </h2>
      <p style="color:#6B7280;font-size:.9rem;margin-bottom:1.5rem;line-height:1.6;">
        Your <strong>${escHtml(planLabel)}</strong> licence for
        <strong>${escHtml(status.customer || 'this installation')}</strong>
        expired on <strong>${escHtml(expiryFormatted)}</strong>.
        <br><br>
        To restore access, please renew your subscription with Ascendia Core Ltd.
      </p>

      <!-- Pricing tiers -->
      <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;
                  padding:1rem;margin-bottom:1.5rem;text-align:left;">
        <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;
                    letter-spacing:.05em;color:#6B7280;margin-bottom:.75rem;">
          Renewal Options
        </div>
        ${[
          ['Monthly',   '₦5,000',  '$3',   '30 days'],
          ['Quarterly', '₦12,000', '$7.50','91 days — save 20%'],
          ['Bi-Annual', '₦20,000', '$12.50','182 days — save 33%'],
          ['Annual',    '₦32,000', '$20',  '365 days — save 47%']
        ].map(([plan, ngn, usd, note]) => `
          <div style="display:flex;justify-content:space-between;align-items:center;
                      padding:.5rem 0;border-bottom:1px solid #E5E7EB;font-size:.85rem;">
            <div>
              <strong>${plan}</strong>
              <span style="color:#6B7280;font-size:.75rem;margin-left:.5rem;">${note}</span>
            </div>
            <div style="text-align:right;">
              <strong style="color:#4F46E5;">${ngn}</strong>
              <span style="color:#9CA3AF;font-size:.75rem;"> / ${usd}</span>
            </div>
          </div>
        `).join('')}
      </div>

      <a href="https://wa.me/2348XXXXXXXXXX?text=Stockdity+IMS+renewal+request"
         target="_blank"
         style="display:block;background:#25D366;color:#fff;border-radius:10px;
                padding:.875rem;font-weight:600;font-size:.95rem;
                text-decoration:none;margin-bottom:.75rem;">
        💬 Renew via WhatsApp
      </a>
      <a href="mailto:ascendiacore@gmail.com?subject=Stockdity IMS Renewal Request"
         style="display:block;background:#4F46E5;color:#fff;border-radius:10px;
                padding:.875rem;font-weight:600;font-size:.95rem;
                text-decoration:none;">
        📧 Email Ascendia Core Ltd
      </a>
      <p style="font-size:.75rem;color:#9CA3AF;margin-top:1rem;">
        Ascendia Core Ltd — CAC Registered | ascendiacore@gmail.com
      </p>
    </div>
  `;

  document.body.appendChild(overlay);
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ─── PWA INSTALL HANDLER ──────────────────────────────────────────────────────
function initPWAInstall() {
  let _deferredPrompt = null;
  const installBtn    = document.getElementById('install-app-btn');

  // Browser fires this when the app is installable
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();               // prevent automatic mini-infobar
    _deferredPrompt = e;
    if (installBtn) installBtn.classList.remove('hidden');
  });

  // User clicks our custom Install button
  installBtn?.addEventListener('click', async () => {
    if (!_deferredPrompt) return;
    _deferredPrompt.prompt();
    const { outcome } = await _deferredPrompt.userChoice;
    _deferredPrompt = null;
    if (outcome === 'accepted') {
      installBtn.classList.add('hidden');
      showToast('App installed successfully!', 'success');
    }
  });

  // Hide button once already installed
  window.addEventListener('appinstalled', () => {
    installBtn?.classList.add('hidden');
    _deferredPrompt = null;
  });
}

// ─── ACTIVATION SCREEN ───────────────────────────────────────────────────────
function showActivationScreen() {
  const overlay = document.getElementById('activation-overlay');
  if (overlay) overlay.classList.remove('hidden');

  // Set app name on activation screen
  const titleEl = document.getElementById('activation-title');
  if (titleEl) titleEl.textContent = `Activate ${AppConfig.APP_NAME}`;

  initActivationUI((businessName) => {
    proceedAfterActivation(businessName);
  });
}

// ─── POST-ACTIVATION FLOW ─────────────────────────────────────────────────────
/**
 * Called after licence is confirmed (either on first run or returning visit).
 * Checks for an existing session; if present, loads the app shell.
 * If not, shows the login screen.
 * @param {string} businessName
 */
function proceedAfterActivation(businessName) {
  // Update business name display elements
  const nameEls = document.querySelectorAll('#login-business-name-display, #sidebar-app-name');
  nameEls.forEach(el => { if (el) el.textContent = businessName; });

  // Check for existing valid session
  const existingUser = getSession();

  if (existingUser) {
    // Session exists — load app shell directly
    loadAppShell(existingUser);
  } else {
    // No session — show login
    showLoginScreen();
  }
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function showLoginScreen() {
  // Hide everything else
  hideAllScreens();

  const loginPage = document.getElementById('login-page');
  if (loginPage) loginPage.classList.remove('hidden');

  // Update the login title with app name / business name
  const appNameEl  = document.getElementById('login-app-name');
  const bizNameEl  = document.getElementById('login-business-name-display');
  const activation = getActivationRecord();

  if (appNameEl)  appNameEl.textContent  = window.AppState.settings.business_name || AppConfig.APP_NAME;
  if (bizNameEl)  bizNameEl.textContent  = activation?.business_name || '';

  // Update logo
  const logoB64   = window.AppState.settings.business_logo_base64;
  const loginLogo = document.getElementById('login-logo-img');
  if (loginLogo && logoB64) loginLogo.src = logoB64;

  initLoginUI((user) => {
    loadAppShell(user);
  });
}

// ─── FORCE PASSWORD CHANGE SCREEN ─────────────────────────────────────────────
function showForceChangePasswordScreen() {
  hideAllScreens();
  const page = document.getElementById('change-password-page');
  if (page) page.classList.remove('hidden');

  initForceChangePasswordUI(async () => {
    const user = getSession();
    if (user) {
      user.force_password_change = false;
      setSession(user);
      window.AppState.user = user;
    }

    page.classList.add('hidden');
    document.getElementById('app-shell')?.classList.remove('hidden');

    initRouter();
    initSidebarLinks();
    navigateTo('/dashboard');
  });
}

/**
 * Attach programmatic click handlers to every sidebar nav link.
 * This is the definitive fix for sidebar navigation — it bypasses
 * native href="#/..." behaviour (which can be swallowed by overlay
 * event handlers or collapsed-sidebar pointer-event issues) and calls
 * the router's navigateTo() directly.
 */
function initSidebarLinks() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');

  // Use event delegation on the sidebar nav — handles both
  // expanded and collapsed states, and survives re-renders.
  sidebar?.addEventListener('click', (e) => {
    // Find the closest sidebar-nav-link ancestor (or self)
    const link = e.target.closest('.sidebar-nav-link');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || !href.startsWith('#/')) return;

    // Prevent the browser's native hash navigation — we handle it
    e.preventDefault();
    e.stopPropagation();

    const path = href.slice(1); // "#/products" → "/products"

    // Close sidebar on mobile before navigating
    if (window.innerWidth <= 768) {
      sidebar.classList.remove('mobile-open');
      overlay?.classList.add('hidden');
      document.body.style.overflow = '';
    }

    // Navigate via the router (handles auth check, permissions,
    // module lifecycle, breadcrumb, active state update)
    navigateTo(path);
  });
}

// ─── LOAD APP SHELL ───────────────────────────────────────────────────────────
/**
 * Show the main application shell and initialise all shell components.
 * @param {Object} user
 */
async function loadAppShell(user) {
  hideAllScreens();

  // Update global state
  window.AppState.user = user;

  // Re-load settings (may have changed)
  const settings = await getAllSettings();
  window.AppState.settings = settings;
  window._appSettings      = settings;

  // Show the app shell
  const shell = document.getElementById('app-shell');
  if (shell) shell.classList.remove('hidden');

  // ── Initialise shell components ───────────────────────────────────────
  updateUserUI(user, settings);
  filterSidebarByRole(user.role);
  initSidebarToggle();
  initTopbarDropdowns();
  initScrollToTop();
  initOfflineBanner();
  initLogoutButton();
  initMarkAllReadButton();

  // ── INSTALL PROMPT ──────────────────────────────────────────────────────
let deferredPrompt;
const installBtn = document.getElementById('install-app-btn');

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();           // don't show the mini‑infobar automatically
  deferredPrompt = e;
  if (installBtn) installBtn.classList.remove('hidden');
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`Install: ${outcome}`);
    deferredPrompt = null;
    installBtn.classList.add('hidden');
  });
}

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  if (installBtn) installBtn.classList.add('hidden');
});

// iOS – native prompt doesn't exist, show a manual guide
if (/iphone|ipad|ipod/.test(navigator.userAgent.toLowerCase()) && installBtn) {
  installBtn.innerHTML = '<i class="fa-solid fa-share-square"></i> Add to Home Screen';
  installBtn.classList.remove('hidden');
  installBtn.addEventListener('click', () => {
    showToast('To install: tap Share → "Add to Home Screen".', 'info', '', 6000);
  });
}
  
  // Apply saved sidebar collapsed state
  const collapsed = settings.sidebar_collapsed === 'true';
  if (collapsed && window.innerWidth > 768) {
    document.getElementById('sidebar')?.classList.add('collapsed');
    document.getElementById('main-wrapper')?.classList.add('sidebar-collapsed');
  }

  // Apply primary colour
  if (settings.primary_color) {
    applyPrimaryColor(settings.primary_color);
  }

  // Update notification badge
  await refreshNotificationBadge();

  // ── Listen for auth events ────────────────────────────────────────────
  window.addEventListener('auth:required', handleAuthRequired);
  window.addEventListener('auth:logout',   handleLogout);

  // ── Notification dropdown open ────────────────────────────────────────
  window.addEventListener('notif:dropdown-open', loadNotificationDropdown);

  // ── Settings updated event ────────────────────────────────────────────
  window.addEventListener('settings:updated', handleSettingsUpdated);

  // ── Handle forced password change ─────────────────────────────────────
  if (user.force_password_change) {
    shell.classList.add('hidden');
    showForceChangePasswordScreen();
    return;
  }

  // ── Start the router ──────────────────────────────────────────────────
  initRouter();
  initSidebarLinks();

  // If no hash, navigate to dashboard
  if (!window.location.hash || window.location.hash === '#') {
    navigateTo('/dashboard');
  }
}

// ─── EVENT HANDLERS ───────────────────────────────────────────────────────────
function handleAuthRequired() {
  window.AppState.user = null;
  document.getElementById('app-shell')?.classList.add('hidden');
  showLoginScreen();
}

function handleLogout() {
  window.AppState.user = null;
  document.getElementById('app-shell')?.classList.add('hidden');
  showLoginScreen();
}

async function handleSettingsUpdated() {
  const settings = await getAllSettings();
  window.AppState.settings = settings;
  window._appSettings      = settings;

  // Re-apply colour and name
  if (settings.primary_color) applyPrimaryColor(settings.primary_color);

  const bizNameEls = document.querySelectorAll('#sidebar-app-name');
  bizNameEls.forEach(el => {
    el.textContent = settings.business_name || AppConfig.APP_NAME;
  });

  document.title = settings.business_name || AppConfig.APP_NAME;

  // Re-update user UI with new settings (logo may have changed)
  const user = getSession();
  if (user) updateUserUI(user, settings);
}

// ─── LOGOUT BUTTON ────────────────────────────────────────────────────────────
function initLogoutButton() {
  const logoutBtn = document.getElementById('logout-btn');
  if (!logoutBtn) return;

  logoutBtn.addEventListener('click', async () => {
    try {
      await logout();
    } catch (err) {
      console.error('[App] Logout error:', err);
      clearSession();
      window.dispatchEvent(new CustomEvent('auth:logout'));
    }
  });
}

// ─── NOTIFICATION BADGE ───────────────────────────────────────────────────────
/**
 * Fetch unread notification count and update the badge.
 */
async function refreshNotificationBadge() {
  try {
    const count = await getUnreadNotificationCount();
    updateNotificationBadge(count);
  } catch (err) {
    console.warn('[App] Notification badge refresh error:', err);
  }
}

// Auto-refresh notification badge every 60 seconds
setInterval(refreshNotificationBadge, 60000);

// ─── NOTIFICATION DROPDOWN ────────────────────────────────────────────────────
/**
 * Load the 5 most recent unread notifications into the topbar dropdown.
 */
async function loadNotificationDropdown() {
  const list = document.getElementById('notif-list');
  if (!list) return;

  try {
    const notifications = await db.notifications
      .orderBy('created_at')
      .reverse()
      .limit(AppConfig.TOPBAR_NOTIF_LIMIT)
      .toArray();

    if (!notifications.length) {
      list.innerHTML = '<li class="notif-empty">No notifications</li>';
      return;
    }

    const { timeSince } = await import('./utils.js');
    const { sanitize }  = await import('./ui.js');

    const typeIcons = {
      low_stock: { icon: 'fa-triangle-exclamation', cls: 'low-stock' },
      expiry:    { icon: 'fa-clock',               cls: 'expiry'    },
      system:    { icon: 'fa-circle-info',          cls: 'system'    }
    };

    list.innerHTML = notifications.map(n => {
      const { icon, cls } = typeIcons[n.type] || typeIcons.system;
      const unreadClass   = n.is_read ? '' : 'unread';

      return `
        <li class="notif-item ${unreadClass}" data-id="${n.id}">
          <div class="notif-item-icon ${cls}">
            <i class="fa-solid ${icon}"></i>
          </div>
          <div class="notif-item-body">
            <p class="notif-item-msg">${sanitize(n.message)}</p>
            <span class="notif-item-time">${timeSince(n.created_at)}</span>
          </div>
        </li>
      `;
    }).join('');

    // Mark as read on click
    list.addEventListener('click', async (e) => {
      const item = e.target.closest('.notif-item[data-id]');
      if (!item) return;

      const id = parseInt(item.dataset.id, 10);
      await db.notifications.update(id, { is_read: 1 });
      item.classList.remove('unread');
      await refreshNotificationBadge();
    }, { once: false });

  } catch (err) {
    console.error('[App] Notification dropdown error:', err);
    list.innerHTML = '<li class="notif-empty">Failed to load notifications.</li>';
  }
}

// ─── MARK ALL READ BUTTON ─────────────────────────────────────────────────────
function initMarkAllReadButton() {
  const btn = document.getElementById('mark-all-read-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    try {
      await db.notifications
        .where('is_read').equals(0)
        .modify({ is_read: 1 });

      await refreshNotificationBadge();
      await loadNotificationDropdown();
      showToast('All notifications marked as read.', 'success');
    } catch (err) {
      console.error('[App] Mark all read error:', err);
    }
  });
}

// ─── HIDE ALL SCREENS ─────────────────────────────────────────────────────────
function hideAllScreens() {
  document.getElementById('activation-overlay')?.classList.add('hidden');
  document.getElementById('login-page')?.classList.add('hidden');
  document.getElementById('change-password-page')?.classList.add('hidden');
  // Don't hide app-shell here — loadAppShell handles it
}

// ─── FATAL ERROR DISPLAY ──────────────────────────────────────────────────────
function showFatalError(err) {
  document.body.innerHTML = `
    <div style="
      display:flex;align-items:center;justify-content:center;
      min-height:100vh;background:#F8FAFC;font-family:Inter,sans-serif;
      padding:2rem;
    ">
      <div style="
        background:#fff;border:1px solid #E2E8F0;border-radius:12px;
        padding:3rem;max-width:480px;width:100%;text-align:center;
        box-shadow:0 10px 15px rgba(0,0,0,0.08);
      ">
        <div style="font-size:3rem;margin-bottom:1rem;">⚠️</div>
        <h1 style="font-size:1.5rem;font-weight:700;color:#0F172A;margin-bottom:0.5rem;">
          Startup Error
        </h1>
        <p style="color:#475569;margin-bottom:1.5rem;line-height:1.6;">
          The application failed to start. This may be caused by a browser
          storage issue or corrupted data.
        </p>
        <details style="text-align:left;margin-bottom:1.5rem;">
          <summary style="cursor:pointer;color:#475569;font-size:0.875rem;">Technical details</summary>
          <pre style="
            background:#F1F5F9;border-radius:6px;padding:1rem;
            font-size:0.75rem;overflow:auto;margin-top:0.5rem;color:#DC2626;
          ">${err?.message || String(err)}</pre>
        </details>
        <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;">
          <button
            onclick="window.location.reload()"
            style="
              background:#4F46E5;color:#fff;border:none;padding:0.75rem 1.5rem;
              border-radius:8px;font-size:1rem;cursor:pointer;font-weight:500;
            "
          >
            Reload Page
          </button>
          <button
            onclick="clearStorageAndReload()"
            style="
              background:#fff;color:#DC2626;border:1px solid #DC2626;
              padding:0.75rem 1.5rem;border-radius:8px;font-size:1rem;
              cursor:pointer;font-weight:500;
            "
          >
            Clear & Reset
          </button>
        </div>
      </div>
    </div>
  `;

  window.clearStorageAndReload = async () => {
    if (!confirm('This will delete ALL application data. Are you sure?')) return;
    try {
      // Delete the IndexedDB database entirely
      await Dexie.delete(AppConfig.DB_NAME);
    } catch { /* ignore */ }
    localStorage.clear();
    sessionStorage.clear();
    window.location.reload();
  };
}

// ─── GLOBAL ERROR HANDLER ─────────────────────────────────────────────────────
window.addEventListener('unhandledrejection', (event) => {
  console.error('[App] Unhandled promise rejection:', event.reason);
  // Don't show a toast for every unhandled rejection — only log it.
  // Individual modules handle their own errors with user-facing toasts.
});

window.addEventListener('error', (event) => {
  console.error('[App] Uncaught error:', event.error || event.message);
});

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export {
  initApp,
  refreshNotificationBadge,
  loadNotificationDropdown,
  dismissPreJSLoader
};
