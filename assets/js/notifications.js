/**
 * Stockdity IMS — Notifications Module
 * Handles: notification generation (low stock, expiry, system),
 * notifications page (list, mark read, delete),
 * EmailJS integration for email alerts.
 */

import db, {
  getLowStockProducts,
  getExpiringProducts,
  getOutOfStockProducts,
  notificationExistsToday,
  getUnreadNotificationCount
} from './db.js';
import { encryptRecord, decryptRecord, decryptAll, isEncryptionReady } from './crypto-store.js';
import { getSession } from './auth.js';
import {
  showToast, renderEmptyState, renderPagination,
  updateNotificationBadge, sanitize
} from './ui.js';
import {
  formatDate, formatDateTime, timeSince,
  daysUntilExpiry, debounce, paginate
} from './utils.js';
import AppConfig from '../../config.js';

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _state = {
  notifications: [],
  filtered:      [],
  page:          1,
  pageSize:      20,
  showUnread:    false
};
let _destroyed = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  _destroyed = false;
  await renderNotificationsPage();
}

function destroy() {
  _destroyed = true;
}

// ─── NOTIFICATIONS PAGE ───────────────────────────────────────────────────────
async function renderNotificationsPage() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-bell"></i> Notifications</h1>
        <p class="page-subtitle">Stay informed about low stock, expiry alerts, and system events.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="mark-all-read-page-btn">
          <i class="fa-solid fa-check-double"></i> Mark All Read
        </button>
      </div>
    </div>

    <!-- Toggle Tabs -->
    <div class="tab-bar" style="margin-bottom:var(--space-lg);">
      <button class="tab-btn ${!_state.showUnread ? 'active' : ''}" id="tab-all">
        All Notifications
        <span class="badge badge-neutral" id="tab-all-count" style="margin-left:var(--space-xs);"></span>
      </button>
      <button class="tab-btn ${_state.showUnread ? 'active' : ''}" id="tab-unread">
        Unread
        <span class="badge badge-danger" id="tab-unread-count" style="margin-left:var(--space-xs);"></span>
      </button>
    </div>

    <!-- Notifications List -->
    <div id="notifications-list-container"></div>
    <div id="notifications-pagination"></div>
  `;

  // Tab switching
  document.getElementById('tab-all')?.addEventListener('click', () => {
    _state.showUnread = false;
    _state.page = 1;
    document.getElementById('tab-all')?.classList.add('active');
    document.getElementById('tab-unread')?.classList.remove('active');
    applyFilterAndRender();
  });

  document.getElementById('tab-unread')?.addEventListener('click', () => {
    _state.showUnread = true;
    _state.page = 1;
    document.getElementById('tab-unread')?.classList.remove('active');
    document.getElementById('tab-all')?.classList.remove('active');
    document.getElementById('tab-unread')?.classList.add('active');
    applyFilterAndRender();
  });

  // Mark all read
  document.getElementById('mark-all-read-page-btn')?.addEventListener('click', async () => {
    try {
      const storedAll = await db.notifications.toArray();
      const allNotifs = isEncryptionReady() ? await decryptAll(storedAll) : storedAll;
      const unread    = allNotifs.filter(n => !n.is_read || n.is_read === 0);

      for (const notif of unread) {
        const stored  = await db.notifications.get(notif.id);
        const current = isEncryptionReady()
          ? (await decryptRecord(stored) ?? stored)
          : stored;
        const updated = { ...current, is_read: 1 };
        const toStore = isEncryptionReady() ? await encryptRecord(updated) : updated;
        await db.notifications.put(toStore);
      }

      showToast('All notifications marked as read.', 'success');
      await loadNotifications();
      await updateBadge();
    } catch (err) {
      console.error('[Notifications] Mark all read error:', err);
      showToast('Failed to mark notifications as read.', 'error');
    }
  });
  
  // Event delegation for notification actions
  document.getElementById('notifications-list-container')?.addEventListener('click', handleNotificationAction);

  await loadNotifications();
}

async function loadNotifications() {
  try {
    const storedAll = await db.notifications.toArray();
    const allNotifs = isEncryptionReady() ? await decryptAll(storedAll) : storedAll;
    _state.notifications = allNotifs.sort((a, b) =>
      (b.created_at || '').localeCompare(a.created_at || '')
    );
    applyFilterAndRender();
    updateTabCounts();
  } catch (err) {
    console.error('[Notifications] Load error:', err);
  }
}

function updateTabCounts() {
  const allCount    = _state.notifications.length;
  const unreadCount = _state.notifications.filter(n => !n.is_read).length;

  const allCountEl    = document.getElementById('tab-all-count');
  const unreadCountEl = document.getElementById('tab-unread-count');

  if (allCountEl)    allCountEl.textContent    = allCount;
  if (unreadCountEl) {
    unreadCountEl.textContent = unreadCount;
    unreadCountEl.style.display = unreadCount > 0 ? '' : 'none';
  }
}

function applyFilterAndRender() {
  let filtered = [..._state.notifications];

  if (_state.showUnread) {
    filtered = filtered.filter(n => !n.is_read);
  }

  _state.filtered = filtered;
  renderNotificationsList();
}

function renderNotificationsList() {
  const container = document.getElementById('notifications-list-container');
  const pagWrap   = document.getElementById('notifications-pagination');
  if (!container) return;

  const { data, total } = paginate(_state.filtered, _state.page, _state.pageSize);

  if (!data.length) {
    container.innerHTML = renderEmptyState(
      _state.showUnread ? 'No unread notifications.' : 'No notifications yet.',
      'fa-solid fa-bell-slash'
    );
    if (pagWrap) pagWrap.innerHTML = '';
    return;
  }

  const typeConfig = {
    low_stock: {
      icon:    'fa-triangle-exclamation',
      iconCls: 'low-stock',
      label:   'Low Stock'
    },
    expiry: {
      icon:    'fa-clock',
      iconCls: 'expiry',
      label:   'Expiry Alert'
    },
    system: {
      icon:    'fa-circle-info',
      iconCls: 'system',
      label:   'System'
    }
  };

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--space-sm);">
      ${data.map(n => {
        const config = typeConfig[n.type] || typeConfig.system;
        return `
          <div class="card ${!n.is_read ? 'unread-notification' : ''}"
               style="
                 padding:var(--space-md) var(--space-lg);
                 cursor:pointer;
                 border-left:4px solid ${!n.is_read
                   ? (n.type === 'low_stock' ? 'var(--color-warning)'
                      : n.type === 'expiry' ? 'var(--color-danger)'
                      : 'var(--color-info)')
                   : 'var(--color-border)'};
                 background:${!n.is_read ? 'var(--color-primary-light)' : 'var(--color-surface)'};
                 transition:all var(--transition-fast);
               "
               data-id="${n.id}"
               data-action="view"
          >
            <div style="display:flex;align-items:flex-start;gap:var(--space-md);">
              <div class="notif-item-icon ${config.iconCls}" style="flex-shrink:0;margin-top:2px;">
                <i class="fa-solid ${config.icon}"></i>
              </div>
              <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:var(--space-sm);margin-bottom:4px;flex-wrap:wrap;">
                  <span class="badge ${
                    n.type === 'low_stock' ? 'badge-warning'
                    : n.type === 'expiry'  ? 'badge-danger'
                    : 'badge-info'
                  }">${sanitize(config.label)}</span>
                  ${!n.is_read ? `<span class="badge badge-primary" style="font-size:10px;">New</span>` : ''}
                </div>
                <p style="margin:0;font-size:var(--text-sm);color:var(--color-text-primary);line-height:1.5;">
                  ${sanitize(n.message)}
                </p>
                <p style="margin:4px 0 0;font-size:var(--text-xs);color:var(--color-text-muted);">
                  ${timeSince(n.created_at)} &nbsp;·&nbsp; ${formatDateTime(n.created_at)}
                </p>
              </div>
              <div style="display:flex;gap:var(--space-xs);flex-shrink:0;">
                ${!n.is_read ? `
                  <button class="btn btn-ghost btn-sm" data-action="mark-read" data-id="${n.id}"
                    title="Mark as read" style="color:var(--color-success);">
                    <i class="fa-solid fa-check"></i>
                  </button>
                ` : ''}
                <button class="btn btn-ghost btn-sm text-danger" data-action="delete" data-id="${n.id}"
                  title="Delete notification">
                  <i class="fa-solid fa-trash"></i>
                </button>
              </div>
            </div>
            ${n.product_id ? `
              <div style="margin-top:var(--space-sm);padding-top:var(--space-sm);border-top:1px solid var(--color-border);">
                <a href="#/products/${n.product_id}" class="btn btn-ghost btn-sm" style="font-size:var(--text-xs);">
                  <i class="fa-solid fa-arrow-right"></i> View Product
                </a>
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;

  if (pagWrap) {
    renderPagination(pagWrap, {
      total,
      page:         _state.page,
      pageSize:     _state.pageSize,
      onPageChange: (p) => { _state.page = p; renderNotificationsList(); },
      onSizeChange: (s) => { _state.pageSize = s; _state.page = 1; renderNotificationsList(); }
    });
  }
}

async function handleNotificationAction(e) {
  const btn = e.target.closest('[data-action][data-id]');
  if (!btn) return;

  e.stopPropagation();

  const action = btn.dataset.action;
  const id     = parseInt(btn.dataset.id, 10);

  if (action === 'mark-read') {
   const storedNotifs  = await db.notifications.toArray();
    const allNotifs     = isEncryptionReady() ? await decryptAll(storedNotifs) : storedNotifs;
    const existing      = allNotifs.find(n =>
      n.type === 'system' && (n.created_at || '').startsWith(todayStr)
    );
    if (existing) return;  
  }

  if (action === 'delete') {
    await db.notifications.delete(id);
    _state.notifications = _state.notifications.filter(n => n.id !== id);
    applyFilterAndRender();
    updateTabCounts();
    await updateBadge();
    return;
  }

  // Clicking the card body — mark as read if unread
  const card = e.target.closest('[data-action="view"][data-id]');
  if (card) {
    const notifId = parseInt(card.dataset.id, 10);
    const notif   = _state.notifications.find(n => n.id === notifId);
    if (notif && !notif.is_read) {
      await db.notifications.update(notifId, { is_read: 1 });
      notif.is_read = true;
      applyFilterAndRender();
      updateTabCounts();
      await updateBadge();
    }
  }
}

// ─── NOTIFICATION BADGE UPDATE ────────────────────────────────────────────────
async function updateBadge() {
  const count = await getUnreadNotificationCount();
  updateNotificationBadge(count);
}

// ─── NOTIFICATION GENERATION ──────────────────────────────────────────────────
/**
 * Run all notification checks that execute on every dashboard load.
 * Called from dashboard.js on init.
 */
async function generateNotificationsForDashboard() {
  await Promise.allSettled([
    generateLowStockNotifications(),
    generateExpiryNotifications(),
    generateOutOfStockSystemNotification()
  ]);

  await updateBadge();
}

/**
 * Generate low-stock notifications for all products at or below threshold.
 * Only creates one notification per product per day.
 */
async function generateLowStockNotifications() {
  try {
    const lowStockProducts = await getLowStockProducts();
    const settings         = window.AppState.settings || {};
    const emailEnabled     = settings.email_alerts_enabled === 'true';

    for (const product of lowStockProducts) {
      const alreadyNotified = await notificationExistsToday('low_stock', product.id);
      if (alreadyNotified) continue;

      const message = `Low stock alert: "${product.name}" has ${product.quantity} ${product.unit || 'units'} remaining (threshold: ${product.low_stock_threshold}).`;

      await db.notifications.add({
        user_id:    null,
        type:       'low_stock',
        message,
        product_id: product.id,
        is_read:    0,
        created_at: new Date().toISOString()
      });

      // Send email alert if enabled
      if (emailEnabled) {
        await sendEmailAlert('low_stock', {
          product_name:    product.name,
          current_quantity:product.quantity,
          threshold:       product.low_stock_threshold,
          business_name:   settings.business_name || AppConfig.APP_NAME
        });
      }
    }
  } catch (err) {
    console.error('[Notifications] Low stock generation error:', err);
  }
}

/**
 * Generate expiry notifications for products expiring within 30 days.
 * Only creates one notification per product per day.
 */
async function generateExpiryNotifications() {
  try {
    const expiringProducts = await getExpiringProducts(AppConfig.EXPIRY_WARNING_DAYS);
    const settings         = window.AppState.settings || {};
    const emailEnabled     = settings.email_alerts_enabled === 'true';

    for (const product of expiringProducts) {
      const alreadyNotified = await notificationExistsToday('expiry', product.id);
      if (alreadyNotified) continue;

      const days    = daysUntilExpiry(product.expiry_date);
      const message = days < 0
        ? `EXPIRED: "${product.name}" expired ${Math.abs(days)} day${Math.abs(days) !== 1 ? 's' : ''} ago. Current stock: ${product.quantity} ${product.unit || 'units'}.`
        : days === 0
        ? `EXPIRY TODAY: "${product.name}" expires today! Current stock: ${product.quantity} ${product.unit || 'units'}.`
        : `Expiry alert: "${product.name}" expires in ${days} day${days !== 1 ? 's' : ''} (${formatDate(product.expiry_date)}). Stock: ${product.quantity} ${product.unit || 'units'}.`;

      await db.notifications.add({
        user_id:    null,
        type:       'expiry',
        message,
        product_id: product.id,
        is_read:    0,
        created_at: new Date().toISOString()
      });

      // Send email alert if enabled
      if (emailEnabled) {
        await sendEmailAlert('expiry', {
          product_name:  product.name,
          expiry_date:   formatDate(product.expiry_date),
          days_remaining:days,
          business_name: settings.business_name || AppConfig.APP_NAME
        });
      }
    }
  } catch (err) {
    console.error('[Notifications] Expiry generation error:', err);
  }
}

/**
 * On first admin login each day: generate a system notification
 * summarising products with zero quantity.
 */
async function generateOutOfStockSystemNotification() {
  try {
    const user = getSession();
    if (!user || user.role !== 'admin') return;

    const todayStr = new Date().toISOString().slice(0, 10);

    // Check if system notification already sent today
    const existing = await db.notifications
      .where('type').equals('system')
      .and(n => n.created_at.startsWith(todayStr))
      .first();

    if (existing) return;

    const outOfStock = await getOutOfStockProducts();
    if (!outOfStock.length) return;

    const message = `Daily check: ${outOfStock.length} product${outOfStock.length !== 1 ? 's are' : ' is'} out of stock. Review your inventory to restock.`;

    await db.notifications.add({
      user_id:    user.id,
      type:       'system',
      message,
      product_id: null,
      is_read:    0,
      created_at: new Date().toISOString()
    });

  } catch (err) {
    console.error('[Notifications] System notification error:', err);
  }
}

/**
 * Check and generate a low-stock notification for a specific product.
 * Called after any stock deduction (sale, stock-out, adjustment).
 * @param {number} productId
 */
async function checkAndGenerateLowStockNotification(productId) {
  try {
    const product = await db.products.get(productId);
    if (!product || !product.is_active) return;

    if (product.quantity <= product.low_stock_threshold) {
      const alreadyNotified = await notificationExistsToday('low_stock', productId);
      if (alreadyNotified) return;

      const settings = window.AppState.settings || {};

      const message = `Low stock alert: "${product.name}" has ${product.quantity} ${product.unit || 'units'} remaining (threshold: ${product.low_stock_threshold}).`;

      await db.notifications.add({
        user_id:    null,
        type:       'low_stock',
        message,
        product_id: productId,
        is_read:    0,
        created_at: new Date().toISOString()
      });

      if (settings.email_alerts_enabled === 'true') {
        await sendEmailAlert('low_stock', {
          product_name:    product.name,
          current_quantity:product.quantity,
          threshold:       product.low_stock_threshold,
          business_name:   settings.business_name || AppConfig.APP_NAME
        });
      }

      await updateBadge();
    }
  } catch (err) {
    console.error('[Notifications] Low stock check error:', err);
  }
}

// ─── EMAIL NOTIFICATIONS (EmailJS) ───────────────────────────────────────────
/**
 * Send an email notification via EmailJS.
 * Failures are caught and logged — never block the main operation.
 *
 * @param {'low_stock'|'expiry'} type
 * @param {Object} params
 */
async function sendEmailAlert(type, params) {
  try {
    const settings = window.AppState.settings || {};

    const publicKey  = settings.emailjs_public_key;
    const serviceId  = settings.emailjs_service_id;
    const templateId = type === 'low_stock'
      ? settings.emailjs_template_id_lowstock
      : settings.emailjs_template_id_expiry;

    if (!publicKey || !serviceId || !templateId) {
      console.warn('[Notifications] EmailJS not fully configured — skipping email alert.');
      return;
    }

    // Initialise EmailJS if not already done
    if (typeof emailjs !== 'undefined') {
      emailjs.init(publicKey);
      await emailjs.send(serviceId, templateId, params);
      console.log(`[Notifications] Email alert sent: ${type}`);
    } else {
      console.warn('[Notifications] EmailJS SDK not available.');
    }

  } catch (err) {
    // Email failure must NEVER block the main application flow
    console.error('[Notifications] Email send error (non-fatal):', err);
  }
}

/**
 * Send a test email via EmailJS.
 * Called from the Settings → Notifications tab.
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function sendTestEmail() {
  try {
    const settings   = window.AppState.settings || {};
    const publicKey  = settings.emailjs_public_key;
    const serviceId  = settings.emailjs_service_id;
    const templateId = settings.emailjs_template_id_lowstock;

    if (!publicKey || !serviceId || !templateId) {
      return {
        success: false,
        error:   'EmailJS is not fully configured. Please fill in all EmailJS fields.'
      };
    }

    if (typeof emailjs === 'undefined') {
      return {
        success: false,
        error:   'EmailJS SDK is not loaded. Check your internet connection.'
      };
    }

    emailjs.init(publicKey);
    await emailjs.send(serviceId, templateId, {
      product_name:    'Test Product',
      current_quantity:5,
      threshold:       10,
      business_name:   settings.business_name || AppConfig.APP_NAME
    });

    return { success: true };

  } catch (err) {
    console.error('[Notifications] Test email error:', err);
    return {
      success: false,
      error:   err?.text || err?.message || 'Email send failed. Check your EmailJS configuration.'
    };
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export {
  init,
  destroy,
  generateNotificationsForDashboard,
  generateLowStockNotifications,
  generateExpiryNotifications,
  checkAndGenerateLowStockNotification,
  sendEmailAlert,
  sendTestEmail
};
