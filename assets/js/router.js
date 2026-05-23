/**
 * Stockdity IMS — Hash-Based SPA Router
 * Handles all client-side navigation, route matching, permission checking,
 * module lifecycle (init/destroy), breadcrumb updates, and sidebar state.
 */

import AppConfig from '../../config.js';
import { getSession, hasRole } from './auth.js';
import { showToast } from './ui.js';

// ─── ROUTE PERMISSIONS MAP ────────────────────────────────────────────────────
/**
 * Maps route patterns to the minimum role required to access them.
 * Roles in ascending privilege: 'staff' < 'manager' < 'admin'
 *
 * The key is a regex-compatible route pattern string.
 * Values: 'staff' | 'manager' | 'admin'
 */
const ROUTE_PERMISSIONS = {
  '/dashboard':           'staff',
  '/products':            'manager',
  '/products/add':        'manager',
  '/products/:id':        'manager',
  '/products/:id/edit':   'manager',
  '/categories':          'manager',
  '/suppliers':           'manager',
  '/suppliers/:id':       'manager',
  '/stock/in':            'manager',
  '/stock/out':           'manager',
  '/stock/adjust':        'manager',
  '/stock/history':       'staff',
  '/sales/new':           'staff',
  '/sales':               'manager',
  '/sales/:id':           'manager',
  '/sales/:id/receipt':   'staff',
  '/reports':             'manager',
  '/notifications':       'staff',
  '/users':               'admin',
  '/settings':            'admin',
  '/audit':               'admin',
  '/unauthorized':        'staff',
  '/change-password':     'staff'
};

// ─── BREADCRUMB LABELS ────────────────────────────────────────────────────────
const BREADCRUMB_LABELS = {
  '/dashboard':           ['Dashboard'],
  '/products':            ['Inventory', 'Products'],
  '/products/add':        ['Inventory', 'Products', 'Add Product'],
  '/products/:id':        ['Inventory', 'Products', 'Product Detail'],
  '/products/:id/edit':   ['Inventory', 'Products', 'Edit Product'],
  '/categories':          ['Inventory', 'Categories'],
  '/suppliers':           ['Inventory', 'Suppliers'],
  '/suppliers/:id':       ['Inventory', 'Suppliers', 'Supplier Profile'],
  '/stock/in':            ['Stock', 'Stock In'],
  '/stock/out':           ['Stock', 'Stock Out'],
  '/stock/adjust':        ['Stock', 'Adjustment'],
  '/stock/history':       ['Stock', 'Movement History'],
  '/sales/new':           ['Sales', 'New Sale'],
  '/sales':               ['Sales', 'Sales History'],
  '/sales/:id':           ['Sales', 'Sale Detail'],
  '/sales/:id/receipt':   ['Sales', 'Receipt'],
  '/reports':             ['Analytics', 'Reports'],
  '/notifications':       ['Notifications'],
  '/users':               ['System', 'User Management'],
  '/settings':            ['System', 'Settings'],
  '/audit':               ['System', 'Audit Log'],
  '/unauthorized':        ['Access Denied'],
  '/change-password':     ['Change Password']
};

// ─── ROUTE → MODULE MAPPING ───────────────────────────────────────────────────
/**
 * Each route entry maps a pattern to a lazy-loaded module.
 * The module must export: init(params), destroy()
 */
const ROUTES = [
  {
    pattern:  /^\/dashboard$/,
    key:      '/dashboard',
    module:   () => import('./dashboard.js')
  },
  {
    pattern:  /^\/products\/add$/,
    key:      '/products/add',
    module:   () => import('./products.js'),
    params:   { action: 'add' }
  },
  {
    pattern:  /^\/products\/(\d+)\/edit$/,
    key:      '/products/:id/edit',
    module:   () => import('./products.js'),
    extract:  (m) => ({ action: 'edit', id: Number(m[1]) })
  },
  {
    pattern:  /^\/products\/(\d+)$/,
    key:      '/products/:id',
    module:   () => import('./products.js'),
    extract:  (m) => ({ action: 'detail', id: Number(m[1]) })
  },
  {
    pattern:  /^\/products$/,
    key:      '/products',
    module:   () => import('./products.js'),
    params:   { action: 'list' }
  },
  {
    pattern:  /^\/categories$/,
    key:      '/categories',
    module:   () => import('./categories.js')
  },
  {
    pattern:  /^\/suppliers\/(\d+)$/,
    key:      '/suppliers/:id',
    module:   () => import('./suppliers.js'),
    extract:  (m) => ({ action: 'detail', id: Number(m[1]) })
  },
  {
    pattern:  /^\/suppliers$/,
    key:      '/suppliers',
    module:   () => import('./suppliers.js'),
    params:   { action: 'list' }
  },
  {
    pattern:  /^\/stock\/in$/,
    key:      '/stock/in',
    module:   () => import('./stock.js'),
    params:   { action: 'in' }
  },
  {
    pattern:  /^\/stock\/out$/,
    key:      '/stock/out',
    module:   () => import('./stock.js'),
    params:   { action: 'out' }
  },
  {
    pattern:  /^\/stock\/adjust$/,
    key:      '/stock/adjust',
    module:   () => import('./stock.js'),
    params:   { action: 'adjust' }
  },
  {
    pattern:  /^\/stock\/history$/,
    key:      '/stock/history',
    module:   () => import('./stock.js'),
    params:   { action: 'history' }
  },
  {
    pattern:  /^\/sales\/new$/,
    key:      '/sales/new',
    module:   () => import('./sales.js'),
    params:   { action: 'new' }
  },
  {
    pattern:  /^\/sales\/(\d+)\/receipt$/,
    key:      '/sales/:id/receipt',
    module:   () => import('./sales.js'),
    extract:  (m) => ({ action: 'receipt', id: Number(m[1]) })
  },
  {
    pattern:  /^\/sales\/(\d+)$/,
    key:      '/sales/:id',
    module:   () => import('./sales.js'),
    extract:  (m) => ({ action: 'detail', id: Number(m[1]) })
  },
  {
    pattern:  /^\/sales$/,
    key:      '/sales',
    module:   () => import('./sales.js'),
    params:   { action: 'list' }
  },
  {
    pattern:  /^\/reports$/,
    key:      '/reports',
    module:   () => import('./reports.js')
  },
  {
    pattern:  /^\/notifications$/,
    key:      '/notifications',
    module:   () => import('./notifications.js')
  },
  {
    pattern:  /^\/users$/,
    key:      '/users',
    module:   () => import('./users.js')
  },
  {
    pattern:  /^\/settings$/,
    key:      '/settings',
    module:   () => import('./settings.js')
  },
  {
    pattern:  /^\/audit$/,
    key:      '/audit',
    module:   () => import('./audit.js')
  },
  {
    pattern:  /^\/change-password$/,
    key:      '/change-password',
    module:   () => import('./settings.js'),
    params:   { action: 'change-password' }
  },
  {
    pattern:  /^\/unauthorized$/,
    key:      '/unauthorized',
    module:   null  // Rendered inline, no module needed
  }
];

// ─── ROUTER STATE ─────────────────────────────────────────────────────────────
let currentRoute     = null;
let currentModule    = null;
let currentModuleKey = null;
let isNavigating     = false;

// Query string params parsed from the hash
let currentQueryParams = {};

// ─── INITIALISE ROUTER ────────────────────────────────────────────────────────
/**
 * Set up hash change listener and handle the initial page load.
 * Called once from app.js after authentication is confirmed.
 */
function initRouter() {
  window.addEventListener('hashchange', handleHashChange);
  window.addEventListener('popstate',   handleHashChange);
  handleHashChange();
}

// ─── HASH CHANGE HANDLER ──────────────────────────────────────────────────────
async function handleHashChange() {
  if (isNavigating) return;
  isNavigating = true;

  try {
    const hash = window.location.hash || '#/dashboard';
    const { path, query } = parseHash(hash);

    currentQueryParams = query;

    // Check authentication on every navigation
    const user = getSession();
    if (!user) {
      // Not authenticated — let app.js handle showing the login screen
      window.dispatchEvent(new CustomEvent('auth:required'));
      isNavigating = false;
      return;
    }

    // Forced password change check — block all navigation
    if (user.force_password_change && path !== '/change-password') {
      navigateTo('/change-password');
      isNavigating = false;
      return;
    }

    // Find matching route
    const matched = matchRoute(path);

    if (!matched) {
      renderNotFound();
      updateSidebarActive(null);
      updateBreadcrumb([]);
      isNavigating = false;
      return;
    }

    // Permission check
    const requiredRole = ROUTE_PERMISSIONS[matched.route.key] || 'admin';
    if (!hasRole(user.role, requiredRole)) {
      renderUnauthorized(requiredRole);
      updateSidebarActive(null);
      updateBreadcrumb([{ label: 'Access Denied', href: null }]);
      isNavigating = false;
      return;
    }

    // Destroy the current module if navigating away
    if (currentModule && typeof currentModule.destroy === 'function') {
      try {
        currentModule.destroy();
      } catch (err) {
        console.warn('[Router] destroy() error:', err);
      }
    }
    currentModule    = null;
    currentModuleKey = null;

    // Update sidebar active state and breadcrumb
    updateSidebarActive(matched.route.key);
    updateBreadcrumb(getBreadcrumbItems(matched.route.key));

    // Update current route tracking
    currentRoute = matched.route.key;

    // Scroll to top of content area
    const appContent = document.getElementById('app-content');
    if (appContent) appContent.scrollTop = 0;

    // Handle routes with no module (unauthorized, etc.)
    if (!matched.route.module) {
      isNavigating = false;
      return;
    }

    // Load the module and call init()
    const modExports = await matched.route.module();
    currentModule    = modExports;
    currentModuleKey = matched.route.key;

    const params = {
      ...(matched.route.params  || {}),
      ...(matched.extracted     || {}),
      query: currentQueryParams
    };

    if (typeof modExports.init === 'function') {
      await modExports.init(params);
    }

  } catch (err) {
    console.error('[Router] Navigation error:', err);
    showToast('Navigation failed. Please try again.', 'error');
  } finally {
    isNavigating = false;
  }
}

// ─── PARSE HASH ───────────────────────────────────────────────────────────────
/**
 * Parse a hash string like '#/products?category=3&status=low'
 * into { path: '/products', query: { category: '3', status: 'low' } }
 * @param {string} hash
 * @returns {{ path: string, query: Object }}
 */
function parseHash(hash) {
  // Remove leading '#'
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;

  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart || '/dashboard';

  const query = {};
  if (queryPart) {
    queryPart.split('&').forEach(pair => {
      const [key, val] = pair.split('=');
      if (key) query[decodeURIComponent(key)] = decodeURIComponent(val || '');
    });
  }

  return { path, query };
}

// ─── MATCH ROUTE ──────────────────────────────────────────────────────────────
/**
 * Find the first ROUTES entry whose pattern matches the given path.
 * @param {string} path
 * @returns {{ route: Object, extracted: Object }|null}
 */
function matchRoute(path) {
  // Strip trailing slash for consistency (except root '/')
  const normPath = path.length > 1 ? path.replace(/\/$/, '') : path;

  for (const route of ROUTES) {
    const match = normPath.match(route.pattern);
    if (match) {
      const extracted = route.extract ? route.extract(match) : {};
      return { route, extracted };
    }
  }
  return null;
}

// ─── NAVIGATE TO ──────────────────────────────────────────────────────────────
/**
 * Programmatic navigation. Updates the hash, which triggers hashchange.
 * @param {string} path   - e.g. '/products' or '/products/42/edit'
 * @param {Object} [query={}] - Query params to append
 */
function navigateTo(path, query = {}) {
  const queryStr = buildQueryString(query);
  const newHash  = `#${path}${queryStr ? '?' + queryStr : ''}`;

  if (window.location.hash === newHash) {
    // Same route — force re-render
    handleHashChange();
    return;
  }

  window.location.hash = newHash;
}

/**
 * Build a query string from a plain object.
 * @param {Object} params
 * @returns {string}
 */
function buildQueryString(params) {
  const pairs = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return pairs.join('&');
}

/**
 * Get the current query params parsed from the hash.
 * @returns {Object}
 */
function getQueryParams() {
  return { ...currentQueryParams };
}

/**
 * Get the current route key.
 * @returns {string|null}
 */
function getCurrentRoute() {
  return currentRoute;
}

// ─── SIDEBAR ACTIVE STATE ─────────────────────────────────────────────────────
/**
 * Mark the correct sidebar nav item as active based on the current route key.
 * Fixes double-highlighting of /sales/new and /sales by preferring exact matches.
 * @param {string|null} routeKey
 */
function updateSidebarActive(routeKey) {
  const items = document.querySelectorAll('.sidebar-nav-item');

  // Remove all active states first
  items.forEach(item => item.classList.remove('active'));

  if (!routeKey) return;

  let bestMatch = null;
  let bestLength = 0;

  items.forEach(item => {
    const itemRoute = item.dataset.route;
    if (!itemRoute) return;

    // Exact match always wins
    if (routeKey === itemRoute) {
      bestMatch = item;
      bestLength = Infinity;
    }
    // Prefix match only when it's a full path segment boundary
    else if (
      bestLength < Infinity &&
      routeKey.startsWith(itemRoute + '/')
    ) {
      if (itemRoute.length > bestLength) {
        bestMatch = item;
        bestLength = itemRoute.length;
      }
    }
  });

  if (bestMatch) {
    bestMatch.classList.add('active');
  }
}

// ─── BREADCRUMB ───────────────────────────────────────────────────────────────
/**
 * Build breadcrumb items array for a given route key.
 * @param {string} routeKey
 * @returns {Array<{label:string, href:string|null}>}
 */
function getBreadcrumbItems(routeKey) {
  const labels = BREADCRUMB_LABELS[routeKey] || [];
  return labels.map((label, index) => ({
    label,
    href: index < labels.length - 1 ? null : null
  }));
}

/**
 * Render breadcrumb items into the topbar breadcrumb element.
 * @param {Array<{label:string, href:string|null}>} items
 */
function updateBreadcrumb(items) {
  const list = document.getElementById('breadcrumb-list');
  if (!list) return;

  if (!items.length) {
    list.innerHTML = '<li class="breadcrumb-item">Home</li>';
    return;
  }

  const allItems = [{ label: 'Home', href: '#/dashboard' }, ...items];

  list.innerHTML = allItems.map((item, index) => {
    const isLast = index === allItems.length - 1;
    if (isLast) {
      return `<li class="breadcrumb-item">${sanitizeText(item.label)}</li>`;
    }
    const href = item.href || '#/dashboard';
    return `<li class="breadcrumb-item"><a href="${href}">${sanitizeText(item.label)}</a></li>`;
  }).join('');
}

// ─── SPECIAL PAGE RENDERERS ───────────────────────────────────────────────────
/**
 * Render the 404 Not Found page into the main content area.
 */
function renderNotFound() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="unauthorized-page">
      <div class="unauthorized-code">404</div>
      <h2 class="unauthorized-title">Page Not Found</h2>
      <p class="unauthorized-text">
        The page you are looking for does not exist or may have been moved.
      </p>
      <a href="#/dashboard" class="btn btn-primary">
        <i class="fa-solid fa-house"></i> Back to Dashboard
      </a>
    </div>
  `;

  updateBreadcrumb([{ label: 'Not Found', href: null }]);
}

/**
 * Render the Access Denied page into the main content area.
 * @param {string} requiredRole
 */
function renderUnauthorized(requiredRole) {
  const content = document.getElementById('app-content');
  if (!content) return;

  const roleLabels = { staff: 'Staff', manager: 'Manager', admin: 'Administrator' };

  content.innerHTML = `
    <div class="unauthorized-page">
      <div class="unauthorized-code" style="color:var(--color-danger-light);">403</div>
      <h2 class="unauthorized-title">Access Denied</h2>
      <p class="unauthorized-text">
        You don't have permission to view this page.
        This area requires <strong>${roleLabels[requiredRole] || requiredRole}</strong>
        access or higher.
      </p>
      <div style="display:flex;gap:var(--space-md);">
        <a href="#/dashboard" class="btn btn-primary">
          <i class="fa-solid fa-house"></i> Dashboard
        </a>
        <button class="btn btn-secondary" onclick="history.back()">
          <i class="fa-solid fa-arrow-left"></i> Go Back
        </button>
      </div>
    </div>
  `;
}

// ─── ROLE HIERARCHY HELPERS ───────────────────────────────────────────────────
/**
 * Simple text sanitiser — replaces HTML entities.
 * @param {string} str
 * @returns {string}
 */
function sanitizeText(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── SIDEBAR ROLE FILTERING ───────────────────────────────────────────────────
/**
 * Hide sidebar nav items the current user doesn't have access to.
 * Called from app.js after login.
 * @param {string} userRole - 'admin' | 'manager' | 'staff'
 */
function filterSidebarByRole(userRole) {
  const items = document.querySelectorAll('.sidebar-nav-item[data-roles]');
  const roleHierarchy = AppConfig.ROLE_HIERARCHY;
  const userLevel = roleHierarchy.indexOf(userRole);

  items.forEach(item => {
    const allowedRoles = (item.dataset.roles || '').split(',').map(r => r.trim());
    const hasAccess = allowedRoles.some(role => {
      const roleLevel = roleHierarchy.indexOf(role);
      return userLevel >= roleLevel;
    });

    item.style.display = hasAccess ? '' : 'none';
  });
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export {
  initRouter,
  navigateTo,
  getCurrentRoute,
  getQueryParams,
  buildQueryString,
  filterSidebarByRole,
  updateBreadcrumb,
  updateSidebarActive,
  ROUTE_PERMISSIONS
};
  
