/**
 * Stockdity IMS — Shared UI Utilities
 * toast(), showModal(), closeModal(), showSpinner(), hideSpinner(),
 * renderTable(), renderPagination(), renderSortableHeaders(),
 * renderEmptyState(), skeleton loaders, and all shared DOM helpers.
 */

import AppConfig from '../../config.js';

// ─── TOAST NOTIFICATIONS ──────────────────────────────────────────────────────
const TOAST_DURATION_MS = 4000;
let toastQueue = [];

/**
 * Display a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} [type='info']
 * @param {string} [title=''] - Optional bold title above the message
 * @param {number} [duration] - Override default duration in ms
 */
function showToast(message, type = 'info', title = '', duration = TOAST_DURATION_MS) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = {
    success: 'fa-solid fa-circle-check',
    error:   'fa-solid fa-circle-xmark',
    warning: 'fa-solid fa-triangle-exclamation',
    info:    'fa-solid fa-circle-info'
  };

  const defaultTitles = {
    success: 'Success',
    error:   'Error',
    warning: 'Warning',
    info:    'Info'
  };

  const displayTitle = title || defaultTitles[type] || '';
  const iconClass    = icons[type] || icons.info;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'alert');
  toast.innerHTML = `
    <i class="${iconClass} toast-icon"></i>
    <div class="toast-content">
      ${displayTitle ? `<div class="toast-title">${sanitize(displayTitle)}</div>` : ''}
      <div class="toast-message">${sanitize(message)}</div>
    </div>
    <button class="toast-close" aria-label="Dismiss notification">
      <i class="fa-solid fa-xmark"></i>
    </button>
    <div class="toast-progress" style="animation-duration:${duration}ms;"></div>
  `;

  container.appendChild(toast);

  // Dismiss on close button click
  toast.querySelector('.toast-close').addEventListener('click', () => removeToast(toast));

  // Auto-dismiss
  const timer = setTimeout(() => removeToast(toast), duration);

  // Store timer reference so manual close can cancel it
  toast._timer = timer;

  // Limit visible toasts to 5
  const allToasts = container.querySelectorAll('.toast');
  if (allToasts.length > 5) {
    removeToast(allToasts[0]);
  }
}

/**
 * Remove a toast element with the slide-out animation.
 * @param {HTMLElement} toast
 */
function removeToast(toast) {
  if (!toast || !toast.parentNode) return;
  if (toast._timer) clearTimeout(toast._timer);
  toast.classList.add('removing');
  toast.addEventListener('animationend', () => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, { once: true });
}

// ─── MODAL MANAGEMENT ─────────────────────────────────────────────────────────
let modalStack    = [];
let modalKeydownHandler = null;

/**
 * Show the global modal with dynamic content.
 * @param {Object} options
 * @param {string}   options.title
 * @param {string}   options.body       - HTML string for modal body
 * @param {string}   [options.footer]   - HTML string for modal footer buttons
 * @param {string}   [options.size]     - 'sm' | '' | 'lg' | 'xl'
 * @param {boolean}  [options.closable] - Whether clicking overlay/X closes it (default true)
 * @param {Function} [options.onOpen]   - Called after modal is shown (for setting up events)
 * @param {Function} [options.onClose]  - Called when modal is closed
 */
function showModal(options = {}) {
  const {
    title    = '',
    body     = '',
    footer   = '',
    size     = '',
    closable = true,
    onOpen   = null,
    onClose  = null
  } = options;

  const overlay   = document.getElementById('modal-overlay');
  const modal     = document.getElementById('modal');
  const titleEl   = document.getElementById('modal-title');
  const bodyEl    = document.getElementById('modal-body');
  const footerEl  = document.getElementById('modal-footer');
  const closeBtn  = document.getElementById('modal-close-btn');

  if (!overlay || !modal) return;

  // Set size class
  modal.className = 'modal';
  if (size) modal.classList.add(`modal-${size}`);

  // Set content
  titleEl.textContent = title;
  bodyEl.innerHTML    = body;
  footerEl.innerHTML  = footer;

  // Show or hide close button
  closeBtn.style.display = closable ? '' : 'none';

  // Show modal
  overlay.classList.remove('hidden');
  modal.focus();

  // Push to stack
  modalStack.push({ onClose, closable });

  // Trap focus within modal
  if (modalKeydownHandler) {
    document.removeEventListener('keydown', modalKeydownHandler);
  }
  modalKeydownHandler = (e) => {
    if (e.key === 'Escape' && closable) {
      closeModal();
    }
    if (e.key === 'Tab') {
      trapFocus(e, modal);
    }
  };
  document.addEventListener('keydown', modalKeydownHandler);

  // Close on overlay click
  overlay._clickHandler = (e) => {
    if (e.target === overlay && closable) closeModal();
  };
  overlay.addEventListener('click', overlay._clickHandler);

  // Close button
  closeBtn._clickHandler = () => closeModal();
  closeBtn.addEventListener('click', closeBtn._clickHandler);

  // Callback
  if (typeof onOpen === 'function') {
    // Defer to next tick to allow DOM to render
    setTimeout(onOpen, 0);
  }
}

/**
 * Close the currently visible modal.
 */
function closeModal() {
  const overlay  = document.getElementById('modal-overlay');
  const closeBtn = document.getElementById('modal-close-btn');

  if (!overlay) return;

  overlay.classList.add('hidden');

  // Clean up listeners
  if (overlay._clickHandler) {
    overlay.removeEventListener('click', overlay._clickHandler);
    overlay._clickHandler = null;
  }
  if (closeBtn && closeBtn._clickHandler) {
    closeBtn.removeEventListener('click', closeBtn._clickHandler);
    closeBtn._clickHandler = null;
  }
  if (modalKeydownHandler) {
    document.removeEventListener('keydown', modalKeydownHandler);
    modalKeydownHandler = null;
  }

  // Pop stack and run onClose callback
  const top = modalStack.pop();
  if (top?.onClose) {
    try { top.onClose(); } catch (err) { console.warn('[UI] Modal onClose error:', err); }
  }
}

/**
 * Show a simple confirmation modal.
 * @param {Object} options
 * @param {string}   options.title
 * @param {string}   options.message
 * @param {string}   [options.confirmText]  - Label for confirm button
 * @param {string}   [options.cancelText]
 * @param {string}   [options.confirmClass] - CSS class for confirm button
 * @param {Function} options.onConfirm
 * @param {Function} [options.onCancel]
 */
function showConfirmModal(options = {}) {
  const {
    title        = 'Confirm',
    message      = 'Are you sure?',
    confirmText  = 'Confirm',
    cancelText   = 'Cancel',
    confirmClass = 'btn-danger',
    onConfirm,
    onCancel
  } = options;

  showModal({
    title,
    size: 'sm',
    body: `<p style="margin:0;line-height:1.6;">${sanitize(message)}</p>`,
    footer: `
      <button class="btn btn-secondary" id="modal-cancel-btn">${sanitize(cancelText)}</button>
      <button class="btn ${confirmClass}" id="modal-confirm-btn">${sanitize(confirmText)}</button>
    `,
    onOpen: () => {
      document.getElementById('modal-cancel-btn')?.addEventListener('click', () => {
        closeModal();
        if (typeof onCancel === 'function') onCancel();
      });
      document.getElementById('modal-confirm-btn')?.addEventListener('click', () => {
        closeModal();
        if (typeof onConfirm === 'function') onConfirm();
      });
    }
  });
}

/**
 * Show a modal requiring the user to type a confirmation word.
 * @param {Object} options
 * @param {string}   options.title
 * @param {string}   options.message
 * @param {string}   options.confirmWord  - Word that must be typed exactly
 * @param {Function} options.onConfirm
 */
function showTypedConfirmModal(options = {}) {
  const {
    title       = 'Confirm Action',
    message     = 'This action cannot be undone.',
    confirmWord = 'DELETE',
    onConfirm
  } = options;

  showModal({
    title,
    size: 'sm',
    body: `
      <p style="line-height:1.6;margin-bottom:var(--space-lg);">${sanitize(message)}</p>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label">
          Type <strong>${sanitize(confirmWord)}</strong> to confirm:
        </label>
        <input
          class="form-input"
          type="text"
          id="typed-confirm-input"
          placeholder="${sanitize(confirmWord)}"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
        />
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="modal-cancel-btn">Cancel</button>
      <button class="btn btn-danger" id="modal-confirm-btn" disabled>Confirm</button>
    `,
    onOpen: () => {
      const input   = document.getElementById('typed-confirm-input');
      const confirm = document.getElementById('modal-confirm-btn');
      const cancel  = document.getElementById('modal-cancel-btn');

      input?.addEventListener('input', () => {
        confirm.disabled = input.value !== confirmWord;
      });

      cancel?.addEventListener('click', () => closeModal());

      confirm?.addEventListener('click', () => {
        closeModal();
        if (typeof onConfirm === 'function') onConfirm();
      });

      input?.focus();
    }
  });
}

// ─── SPINNER ──────────────────────────────────────────────────────────────────
let spinnerCount = 0;

/**
 * Show the full-page loading spinner.
 * Stacks — each showSpinner() call must have a matching hideSpinner().
 */
function showSpinner() {
  spinnerCount++;
  const el = document.getElementById('spinner-overlay');
  if (el) el.classList.remove('hidden');
}

/**
 * Hide the full-page loading spinner.
 */
function hideSpinner() {
  spinnerCount = Math.max(0, spinnerCount - 1);
  if (spinnerCount === 0) {
    const el = document.getElementById('spinner-overlay');
    if (el) el.classList.add('hidden');
  }
}

// ─── TABLE RENDERING ──────────────────────────────────────────────────────────
/**
 * Render a fully featured data table into a container element.
 *
 * @param {HTMLElement} container
 * @param {Object}   options
 * @param {Array}    options.columns    - [{ key, label, sortable, render, class, style }]
 * @param {Array}    options.data       - Array of row objects
 * @param {string}   [options.emptyMsg] - Message when data is empty
 * @param {string}   [options.sortKey]  - Currently sorted column key
 * @param {string}   [options.sortDir]  - 'asc' | 'desc'
 * @param {Function} [options.onSort]   - (key, dir) => void
 * @param {string}   [options.rowClass] - Function(row) => CSS class string
 */
function renderTable(container, options = {}) {
  const {
    columns   = [],
    data      = [],
    emptyMsg  = 'No records found.',
    sortKey   = null,
    sortDir   = 'asc',
    onSort    = null,
    rowClass  = null
  } = options;

  if (!container) return;

  if (!data.length) {
    container.innerHTML = renderEmptyState(emptyMsg);
    return;
  }

  const thead = columns.map(col => {
    let cls = 'sortable-th';
    if (col.sortable && onSort) cls += ' sortable';
    if (sortKey === col.key) cls += sortDir === 'asc' ? ' sort-asc' : ' sort-desc';
    const style = col.style ? ` style="${col.style}"` : '';
    const colCls = col.class ? ` class="${col.class} ${cls}"` : ` class="${cls}"`;
    return `<th${colCls}${style} data-key="${col.key}">${sanitize(col.label)}</th>`;
  }).join('');

  const tbody = data.map(row => {
    const extraClass = typeof rowClass === 'function' ? rowClass(row) : '';
    const cells = columns.map(col => {
      const cellStyle = col.style ? ` style="${col.style}"` : '';
      const cellClass = col.class ? ` class="${col.class}"` : '';
      const value = typeof col.render === 'function'
        ? col.render(row)
        : sanitize(String(row[col.key] ?? ''));
      return `<td${cellClass}${cellStyle}>${value}</td>`;
    }).join('');
    return `<tr class="${extraClass}" data-id="${row.id || ''}">${cells}</tr>`;
  }).join('');

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead><tr>${thead}</tr></thead>
        <tbody>${tbody}</tbody>
      </table>
    </div>
  `;

  // Attach sort handlers via event delegation
  if (onSort) {
    const table = container.querySelector('table');
    table?.addEventListener('click', (e) => {
      const th = e.target.closest('th.sortable');
      if (!th) return;
      const key = th.dataset.key;
      const newDir = (sortKey === key && sortDir === 'asc') ? 'desc' : 'asc';
      onSort(key, newDir);
    });
  }
}

/**
 * Render sortable column headers only (for use with custom table HTML).
 * Attaches click handlers to all <th> elements with data-sortable="true".
 * @param {HTMLElement} tableEl
 * @param {string}      currentKey
 * @param {string}      currentDir
 * @param {Function}    onSort
 */
function renderSortableHeaders(tableEl, currentKey, currentDir, onSort) {
  if (!tableEl) return;

  const headers = tableEl.querySelectorAll('th[data-sortable="true"]');
  headers.forEach(th => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.key === currentKey) {
      th.classList.add(currentDir === 'asc' ? 'sort-asc' : 'sort-desc');
    }
    th.style.cursor = 'pointer';
    th.onclick = () => {
      const key    = th.dataset.key;
      const newDir = (currentKey === key && currentDir === 'asc') ? 'desc' : 'asc';
      onSort(key, newDir);
    };
  });
}

// ─── PAGINATION ───────────────────────────────────────────────────────────────
/**
 * Render pagination controls into a container.
 * @param {HTMLElement} container
 * @param {Object} options
 * @param {number}   options.total        - Total record count
 * @param {number}   options.page         - Current page (1-based)
 * @param {number}   options.pageSize     - Records per page
 * @param {number[]} [options.pageSizes]  - Available page size options
 * @param {Function} options.onPageChange - (newPage) => void
 * @param {Function} [options.onSizeChange] - (newSize) => void
 */
function renderPagination(container, options = {}) {
  const {
    total        = 0,
    page         = 1,
    pageSize     = AppConfig.DEFAULT_PAGE_SIZE,
    pageSizes    = [10, 20, 50],
    onPageChange,
    onSizeChange
  } = options;

  if (!container) return;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start      = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end        = Math.min(page * pageSize, total);

  // Build page number buttons with ellipsis
  const pageButtons = buildPageButtons(page, totalPages);

  const pageSizeOptions = pageSizes.map(size =>
    `<option value="${size}" ${size === pageSize ? 'selected' : ''}>${size} / page</option>`
  ).join('');

  container.innerHTML = `
    <div class="pagination-wrap">
      <div class="pagination-info">
        Showing <strong>${start}</strong>–<strong>${end}</strong> of <strong>${total}</strong> records
      </div>
      <div class="pagination-controls">
        <button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">
          <i class="fa-solid fa-chevron-left"></i>
        </button>
        ${pageButtons}
        <button class="page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} aria-label="Next page">
          <i class="fa-solid fa-chevron-right"></i>
        </button>
      </div>
      <div style="display:flex;align-items:center;gap:var(--space-sm);">
        <select class="page-size-select" id="page-size-select" aria-label="Records per page">
          ${pageSizeOptions}
        </select>
      </div>
    </div>
  `;

  // Page button clicks
  container.querySelectorAll('.page-btn[data-page]').forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      const p = parseInt(btn.dataset.page, 10);
      if (!isNaN(p) && p >= 1 && p <= totalPages && typeof onPageChange === 'function') {
        onPageChange(p);
      }
    });
  });

  // Page size change
  const sizeSelect = container.querySelector('#page-size-select');
  if (sizeSelect && typeof onSizeChange === 'function') {
    sizeSelect.addEventListener('change', () => {
      onSizeChange(parseInt(sizeSelect.value, 10));
    });
  }
}

/**
 * Build page number button HTML with ellipsis for large page counts.
 * @param {number} current
 * @param {number} total
 * @returns {string} HTML string
 */
function buildPageButtons(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => {
      const p = i + 1;
      return `<button class="page-btn ${p === current ? 'active' : ''}" data-page="${p}" aria-current="${p === current ? 'page' : 'false'}">${p}</button>`;
    }).join('');
  }

  const pages = new Set([1, total, current]);
  if (current > 1) pages.add(current - 1);
  if (current < total) pages.add(current + 1);

  const sorted = [...pages].sort((a, b) => a - b);
  let result = '';
  let prev   = 0;

  for (const p of sorted) {
    if (p - prev > 1) {
      result += `<span class="page-btn" style="cursor:default;pointer-events:none;">…</span>`;
    }
    result += `<button class="page-btn ${p === current ? 'active' : ''}" data-page="${p}" aria-current="${p === current ? 'page' : 'false'}">${p}</button>`;
    prev = p;
  }

  return result;
}

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────
/**
 * Return an empty state HTML string.
 * @param {string} [message]
 * @param {string} [icon]     - Font Awesome class
 * @param {string} [action]   - HTML for action button/link
 * @returns {string}
 */
function renderEmptyState(
  message = 'No records found.',
  icon    = 'fa-solid fa-inbox',
  action  = ''
) {
  return `
    <div class="empty-state">
      <i class="${icon} empty-state-icon"></i>
      <p class="empty-state-title">${sanitize(message)}</p>
      ${action}
    </div>
  `;
}

// ─── SKELETON LOADERS ─────────────────────────────────────────────────────────
/**
 * Render skeleton loader cards into a container.
 * @param {HTMLElement} container
 * @param {number} [count=6]
 * @param {string} [type='card'] - 'card' | 'table-row' | 'text'
 */
function renderSkeletons(container, count = 6, type = 'card') {
  if (!container) return;

  const items = Array.from({ length: count }, () => {
    if (type === 'table-row') {
      return `<div class="skeleton skeleton-table-row" style="margin-bottom:1px;border-radius:0;"></div>`;
    }
    if (type === 'text') {
      return `
        <div class="skeleton skeleton-text"></div>
        <div class="skeleton skeleton-text w-75"></div>
        <div class="skeleton skeleton-text w-50" style="margin-bottom:var(--space-lg);"></div>
      `;
    }
    // Default: card
    return `<div class="skeleton skeleton-card"></div>`;
  }).join('');

  container.innerHTML = items;
}

/**
 * Render skeleton KPI cards (for dashboard loading state).
 * @param {HTMLElement} container
 */
function renderKPISkeletons(container) {
  if (!container) return;
  container.innerHTML = Array.from({ length: 6 }, () => `
    <div class="kpi-card">
      <div class="skeleton" style="width:44px;height:44px;border-radius:var(--radius-md);margin-bottom:var(--space-sm);"></div>
      <div class="skeleton skeleton-text" style="width:60%;"></div>
      <div class="skeleton skeleton-text" style="width:40%;height:32px;"></div>
    </div>
  `).join('');
}

// ─── SIDEBAR & TOPBAR UPDATERS ────────────────────────────────────────────────
/**
 * Update all user-related UI elements in the topbar and sidebar.
 * @param {Object} user  - Session user object
 * @param {Object} settings - App settings object (from getAllSettings())
 */
function updateUserUI(user, settings = {}) {
  if (!user) return;

  const { getAvatarColorClass } = window._authHelpers || {};

  // Determine avatar color
  let colorClass = 'avatar-color-0';
  try {
    const { getAvatarColorClass: getColor } = window._authHelpers || {};
    if (getColor) colorClass = getColor(user.name);
  } catch { /* ignore */ }

  const initials = user.avatar_initials || user.name?.slice(0, 2).toUpperCase() || '??';

  // Topbar avatar
  const topbarAvatar = document.getElementById('topbar-user-avatar');
  if (topbarAvatar) {
    topbarAvatar.className = `avatar avatar-md ${colorClass}`;
    topbarAvatar.textContent = initials;
  }

  // Topbar user name & role
  setTextContent('topbar-user-name', user.name);
  setTextContent('topbar-user-role', user.role);

  // Dropdown avatar & info
  const dropdownAvatar = document.getElementById('user-dropdown-avatar');
  if (dropdownAvatar) {
    dropdownAvatar.className = `avatar avatar-lg ${colorClass}`;
    dropdownAvatar.textContent = initials;
  }
  setTextContent('user-dropdown-name',  user.name);
  setTextContent('user-dropdown-email', user.email);

  // Sidebar mini user
  const sidebarAvatar = document.getElementById('sidebar-user-avatar');
  if (sidebarAvatar) {
    sidebarAvatar.className = `avatar avatar-sm ${colorClass}`;
    sidebarAvatar.textContent = initials;
  }
  setTextContent('sidebar-user-mini-name', user.name);
  setTextContent('sidebar-user-mini-role', user.role);

  // App name in sidebar / login
  const appName = settings.business_name || AppConfig.APP_NAME;
  setTextContent('sidebar-app-name', appName);
  setTextContent('login-app-name',   appName);

  // Logo images
  const logoB64 = settings.business_logo_base64 || '';
  ['sidebar-logo-img', 'login-logo-img', 'activation-logo-img'].forEach(id => {
    const img = document.getElementById(id);
    if (img && logoB64) {
      img.src = logoB64;
    }
  });

  // Apply primary colour from settings
  if (settings.primary_color) {
    applyPrimaryColor(settings.primary_color);
  }
}

/**
 * Apply a primary colour to the CSS custom properties on :root.
 * Derives hover and light variants automatically.
 * @param {string} hexColor - e.g. '#4F46E5'
 */
function applyPrimaryColor(hexColor) {
  if (!hexColor || !hexColor.startsWith('#')) return;

  const root = document.documentElement;
  root.style.setProperty('--color-primary',       hexColor);
  root.style.setProperty('--color-primary-hover',  darkenHex(hexColor, 12));
  root.style.setProperty('--color-primary-dark',   darkenHex(hexColor, 20));
  root.style.setProperty('--color-primary-light',  lightenHex(hexColor, 90));
}

/**
 * Darken a hex colour by a percentage.
 * @param {string} hex
 * @param {number} amount - 0–100
 * @returns {string}
 */
function darkenHex(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const factor    = 1 - amount / 100;
  return rgbToHex(
    Math.max(0, Math.round(r * factor)),
    Math.max(0, Math.round(g * factor)),
    Math.max(0, Math.round(b * factor))
  );
}

/**
 * Lighten a hex colour by mixing with white.
 * @param {string} hex
 * @param {number} amount - 0–100 (100 = pure white)
 * @returns {string}
 */
function lightenHex(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const t         = amount / 100;
  return rgbToHex(
    Math.min(255, Math.round(r + (255 - r) * t)),
    Math.min(255, Math.round(g + (255 - g) * t)),
    Math.min(255, Math.round(b + (255 - b) * t))
  );
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const bigint = parseInt(clean, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ─── NOTIFICATION BELL ────────────────────────────────────────────────────────
/**
 * Update the notification bell badge count.
 * @param {number} count
 */
function updateNotificationBadge(count) {
  const badge       = document.getElementById('notif-badge');
  const sidebarBadge = document.getElementById('sidebar-notif-badge');

  if (badge) {
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  if (sidebarBadge) {
    if (count > 0) {
      sidebarBadge.textContent = count > 99 ? '99+' : String(count);
      sidebarBadge.style.display = '';
    } else {
      sidebarBadge.style.display = 'none';
    }
  }
}

// ─── SIDEBAR TOGGLE ───────────────────────────────────────────────────────────
/**
 * Initialise sidebar toggle behaviour (hamburger, close button, overlay).
 */
// ─── SIDEBAR TOGGLE ───────────────────────────────────────────────────────────
/**
 * Initialise sidebar toggle behaviour (hamburger, close button, overlay).
 */
function initSidebarToggle() {
  const sidebar     = document.getElementById('sidebar');
  const hamburger   = document.getElementById('hamburger-btn');
  const closeBtn    = document.getElementById('sidebar-close-btn');
  const overlay     = document.getElementById('sidebar-overlay');
  const mainWrapper = document.getElementById('main-wrapper');

  // Helper to get stored state
  function getStoredState() {
    try {
      return localStorage.getItem(AppConfig.STORAGE_KEYS.SIDEBAR_STATE) === 'true';
    } catch { return false; }
  }

  // Apply collapsed state to DOM & persist
  function setCollapsed(collapsed) {
    try {
      localStorage.setItem(AppConfig.STORAGE_KEYS.SIDEBAR_STATE, collapsed ? 'true' : 'false');
    } catch { /* ignore */ }
    if (collapsed) {
      sidebar.classList.add('collapsed');
      mainWrapper.classList.add('sidebar-collapsed');
    } else {
      sidebar.classList.remove('collapsed');
      mainWrapper.classList.remove('sidebar-collapsed');
    }
  }

  // Mobile helpers
  function openSidebar() {
    sidebar.classList.add('mobile-open');
    overlay?.classList.remove('hidden');
    hamburger?.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }
  function closeSidebar() {
    sidebar.classList.remove('mobile-open');
    overlay?.classList.add('hidden');
    hamburger?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  // Initialise from localStorage on desktop
  if (window.innerWidth > 768) {
    setCollapsed(getStoredState());
  }

  // Hamburger click
  hamburger?.addEventListener('click', () => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
      // Toggle open/close
      if (sidebar.classList.contains('mobile-open')) {
        closeSidebar();
      } else {
        openSidebar();
      }
    } else {
      // Toggle collapsed state
      setCollapsed(!sidebar.classList.contains('collapsed'));
    }
  });

  closeBtn?.addEventListener('click', closeSidebar);
  overlay?.addEventListener('click', closeSidebar);

  // Auto-close sidebar on hash change (mobile)
  window.addEventListener('hashchange', () => {
    if (window.innerWidth <= 768) closeSidebar();
  });
}
// ─── DROPDOWN MENUS ───────────────────────────────────────────────────────────
/**
 * Initialise topbar dropdown menus (notification bell & user menu).
 * Uses a single document click listener to close all dropdowns.
 */
function initTopbarDropdowns() {
  const bellBtn      = document.getElementById('notif-bell-btn');
  const bellDropdown = document.getElementById('notif-dropdown');
  const userBtn      = document.getElementById('user-avatar-btn');
  const userDropdown = document.getElementById('user-dropdown');

  function closeAll() {
    bellDropdown?.classList.add('hidden');
    userDropdown?.classList.add('hidden');
    bellBtn?.setAttribute('aria-expanded', 'false');
    userBtn?.setAttribute('aria-expanded', 'false');
  }

  bellBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !bellDropdown?.classList.contains('hidden');
    closeAll();
    if (!isOpen) {
      bellDropdown?.classList.remove('hidden');
      bellBtn?.setAttribute('aria-expanded', 'true');
      // Trigger notification dropdown load
      window.dispatchEvent(new CustomEvent('notif:dropdown-open'));
    }
  });

  userBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = !userDropdown?.classList.contains('hidden');
    closeAll();
    if (!isOpen) {
      userDropdown?.classList.remove('hidden');
      userBtn?.setAttribute('aria-expanded', 'true');
    }
  });

  // Close on outside click
  document.addEventListener('click', closeAll);

  // Stop propagation inside dropdowns
  bellDropdown?.addEventListener('click', e => e.stopPropagation());
  userDropdown?.addEventListener('click', e => e.stopPropagation());
}

// ─── SCROLL TO TOP ────────────────────────────────────────────────────────────
/**
 * Initialise the scroll-to-top button.
 */
function initScrollToTop() {
  const btn     = document.getElementById('scroll-top-btn');
  const content = document.getElementById('app-content');

  if (!btn || !content) return;

  let ticking = false;
  content.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        if (content.scrollTop > AppConfig.SCROLL_TOP_THRESHOLD_PX) {
          btn.classList.remove('hidden');
        } else {
          btn.classList.add('hidden');
        }
        ticking = false;
      });
      ticking = true;
    }
  });

  btn.addEventListener('click', () => {
    content.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// ─── OFFLINE BANNER ───────────────────────────────────────────────────────────
/**
 * Initialise the offline/online status banner.
 */
function initOfflineBanner() {
  const badge = document.getElementById('offline-badge');
  if (!badge) return;

  function update() {
    if (navigator.onLine) {
      badge.classList.add('hidden');
    } else {
      badge.classList.remove('hidden');
    }
  }

  update();
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
}

// ─── FOCUS TRAP ───────────────────────────────────────────────────────────────
/**
 * Trap keyboard focus within a given element (for modals).
 * @param {KeyboardEvent} e
 * @param {HTMLElement}   container
 */
function trapFocus(e, container) {
  const focusable = container.querySelectorAll(
    'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];

  if (e.shiftKey) {
    if (document.activeElement === first) {
      last?.focus();
      e.preventDefault();
    }
  } else {
    if (document.activeElement === last) {
      first?.focus();
      e.preventDefault();
    }
  }
}

// ─── FORM HELPERS ─────────────────────────────────────────────────────────────
/**
 * Set form field error state.
 * @param {string} fieldId  - ID of the input element
 * @param {string} errorId  - ID of the error span element
 * @param {string} message
 */
function setFieldError(fieldId, errorId, message) {
  const field = document.getElementById(fieldId);
  const error = document.getElementById(errorId);
  if (field) field.classList.add('is-invalid');
  if (error) error.textContent = message;
}

/**
 * Clear form field error state.
 * @param {string} fieldId
 * @param {string} errorId
 */
function clearFieldError(fieldId, errorId) {
  const field = document.getElementById(fieldId);
  const error = document.getElementById(errorId);
  if (field) { field.classList.remove('is-invalid'); field.classList.remove('is-valid'); }
  if (error) error.textContent = '';
}

/**
 * Clear all validation errors in a form element.
 * @param {HTMLElement} formEl
 */
function clearAllFieldErrors(formEl) {
  if (!formEl) return;
  formEl.querySelectorAll('.is-invalid, .is-valid').forEach(el => {
    el.classList.remove('is-invalid', 'is-valid');
  });
  formEl.querySelectorAll('.form-error-text').forEach(el => {
    el.textContent = '';
  });
}

/**
 * Apply validation errors to form fields.
 * @param {Object} errors - { fieldId: errorMessage }
 * @param {HTMLElement} [formEl] - Scope to this form element
 */
function applyValidationErrors(errors, formEl = document) {
  Object.entries(errors).forEach(([field, message]) => {
    const input = formEl.querySelector(`#${field}, [name="${field}"]`);
    const errorEl = formEl.querySelector(`#${field}-err, [data-error="${field}"]`);
    if (input) input.classList.add('is-invalid');
    if (errorEl) errorEl.textContent = message;
  });

  // Focus first invalid field
  const firstInvalid = formEl.querySelector('.is-invalid');
  firstInvalid?.focus();
}

/**
 * Collect all form field values into a plain object.
 * @param {HTMLElement} formEl
 * @returns {Object}
 */
function serializeForm(formEl) {
  if (!formEl) return {};
  const data = {};
  const elements = formEl.querySelectorAll('input, select, textarea');
  elements.forEach(el => {
    if (!el.name) return;
    if (el.type === 'checkbox') {
      data[el.name] = el.checked;
    } else if (el.type === 'radio') {
      if (el.checked) data[el.name] = el.value;
    } else {
      data[el.name] = el.value;
    }
  });
  return data;
}

// ─── BADGE HELPERS ────────────────────────────────────────────────────────────
/**
 * Return a badge HTML string for stock status.
 * @param {number} quantity
 * @param {number} threshold
 * @param {string|null} expiryDate
 * @returns {string}
 */
function stockStatusBadge(quantity, threshold, expiryDate = null) {
  if (expiryDate && new Date(expiryDate) < new Date()) {
    return `<span class="badge badge-danger"><i class="fa-solid fa-skull-crossbones"></i> Expired</span>`;
  }
  if (quantity <= 0) {
    return `<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> Out of Stock</span>`;
  }
  if (quantity <= threshold) {
    return `<span class="badge badge-warning"><i class="fa-solid fa-triangle-exclamation"></i> Low Stock</span>`;
  }
  return `<span class="badge badge-success"><i class="fa-solid fa-check"></i> In Stock</span>`;
}

/**
 * Return a badge HTML string for a role.
 * @param {string} role
 * @returns {string}
 */
function roleBadge(role) {
  const map = {
    admin:   ['badge-danger',  'fa-shield-halved', 'Admin'],
    manager: ['badge-primary', 'fa-user-tie',      'Manager'],
    staff:   ['badge-neutral', 'fa-user',          'Staff']
  };
  const [cls, icon, label] = map[role] || ['badge-neutral', 'fa-user', role];
  return `<span class="badge ${cls}"><i class="fa-solid ${icon}"></i> ${sanitize(label)}</span>`;
}

/**
 * Return an active/inactive badge.
 * @param {boolean} isActive
 * @returns {string}
 */
function activeBadge(isActive) {
  return isActive
    ? `<span class="badge badge-success"><i class="fa-solid fa-circle"></i> Active</span>`
    : `<span class="badge badge-neutral"><i class="fa-regular fa-circle"></i> Inactive</span>`;
}

/**
 * Return a payment method badge.
 * @param {string} method
 * @returns {string}
 */
function paymentBadge(method) {
  const map = {
    cash:     ['badge-success', 'fa-money-bill-wave', 'Cash'],
    card:     ['badge-info',    'fa-credit-card',     'Card'],
    transfer: ['badge-primary', 'fa-building-columns','Transfer'],
    credit:   ['badge-warning', 'fa-clock',           'Credit']
  };
  const [cls, icon, label] = map[method] || ['badge-neutral', 'fa-question', method];
  return `<span class="badge ${cls}"><i class="fa-solid ${icon}"></i> ${sanitize(label)}</span>`;
}

/**
 * Return a sale status badge.
 * @param {string} status
 * @returns {string}
 */
function saleStatusBadge(status) {
  return status === 'voided'
    ? `<span class="badge badge-danger"><i class="fa-solid fa-ban"></i> Voided</span>`
    : `<span class="badge badge-success"><i class="fa-solid fa-check"></i> Completed</span>`;
}

// ─── AVATAR RENDERER ──────────────────────────────────────────────────────────
/**
 * Render an avatar element HTML string.
 * @param {string} initials
 * @param {string} colorClass  - e.g. 'avatar-color-3'
 * @param {string} [size]      - 'sm' | 'md' | 'lg'
 * @returns {string}
 */
function renderAvatar(initials, colorClass, size = 'md') {
  return `<div class="avatar avatar-${size} ${colorClass}">${sanitize(initials)}</div>`;
}

// ─── PRODUCT IMAGE RENDERER ───────────────────────────────────────────────────
/**
 * Render a product image or placeholder.
 * @param {string|null} imageBase64
 * @param {string}      productName
 * @param {string}      [size]  - 'thumb' (for table) | 'preview' (for form)
 * @returns {string}
 */
function renderProductImage(imageBase64, productName, size = 'thumb') {
  if (imageBase64) {
    return size === 'thumb'
      ? `<img src="${imageBase64}" alt="${sanitize(productName)}" class="product-thumb" />`
      : `<img src="${imageBase64}" alt="${sanitize(productName)}" style="width:100%;height:100%;object-fit:cover;" />`;
  }
  const initial = (productName || '?').charAt(0).toUpperCase();
  return `<div class="product-thumb-placeholder">${sanitize(initial)}</div>`;
}

// ─── DOM HELPERS ──────────────────────────────────────────────────────────────
/**
 * Safely set the textContent of an element by ID.
 * @param {string} id
 * @param {string} text
 */
function setTextContent(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * Safely set the innerHTML of an element by ID.
 * Only use with sanitised HTML — never with raw user input.
 * @param {string} id
 * @param {string} html
 */
function setInnerHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

/**
 * Toggle the 'hidden' class on an element.
 * @param {string|HTMLElement} elOrId
 * @param {boolean} show
 */
function toggleVisible(elOrId, show) {
  const el = typeof elOrId === 'string' ? document.getElementById(elOrId) : elOrId;
  if (!el) return;
  el.classList.toggle('hidden', !show);
}

/**
 * XSS sanitiser: replace HTML special characters with entities.
 * Use for any user-provided string inserted into the DOM.
 * @param {string} str
 * @returns {string}
 */
function sanitize(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export {
  // Toast
  showToast,
  removeToast,

  // Modal
  showModal,
  closeModal,
  showConfirmModal,
  showTypedConfirmModal,

  // Spinner
  showSpinner,
  hideSpinner,

  // Table
  renderTable,
  renderSortableHeaders,

  // Pagination
  renderPagination,

  // Empty state
  renderEmptyState,

  // Skeletons
  renderSkeletons,
  renderKPISkeletons,

  // App shell
  updateUserUI,
  applyPrimaryColor,
  updateNotificationBadge,
  initSidebarToggle,
  initTopbarDropdowns,
  initScrollToTop,
  initOfflineBanner,

  // Form helpers
  setFieldError,
  clearFieldError,
  clearAllFieldErrors,
  applyValidationErrors,
  serializeForm,

  // Badges
  stockStatusBadge,
  roleBadge,
  activeBadge,
  paymentBadge,
  saleStatusBadge,

  // Renderers
  renderAvatar,
  renderProductImage,

  // DOM utilities
  setTextContent,
  setInnerHTML,
  toggleVisible,
  sanitize,

  // Colour utilities
  applyPrimaryColor as applyThemeColor,
  darkenHex,
  lightenHex
};
