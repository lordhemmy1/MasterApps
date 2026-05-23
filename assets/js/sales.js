/**
 * Stockdity IMS — Sales Module
 * Handles: new sale entry, cart management, sales history,
 * sale detail view, void sale, receipt printing.
 */

import db, { getSaleItems } from './db.js';
import { getSession } from './auth.js';
import {
  showToast, showSpinner, hideSpinner, showModal, closeModal,
  showConfirmModal, renderPagination, renderEmptyState,
  sanitize, paymentBadge, saleStatusBadge
} from './ui.js';
import {
  formatCurrency, formatDate, formatDateTime, formatReceiptNumber,
  debounce, sortBy, paginate, exportCSV, validate, timeSince
} from './utils.js';
import { writeAuditLog } from './audit.js';
import { checkAndGenerateLowStockNotification } from './notifications.js';
import AppConfig from '../../config.js';

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _state = {
  action:    'list',
  cart:      [],
  page:      1,
  pageSize:  20,
  sortKey:   'created_at',
  sortDir:   'desc',
  filters:   { status: '', payment: '', dateFrom: '', dateTo: '', customer: '' }
};
let _destroyed = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init(params = {}) {
  _destroyed    = false;
  _state.action = params.action || 'list';

  const content = document.getElementById('app-content');
  if (!content) return;

  switch (_state.action) {
    case 'new':
      await renderNewSalePage();
      break;
    case 'receipt':
      await renderReceiptPage(params.id);
      break;
    case 'detail':
      await renderSaleDetailPage(params.id);
      break;
    default:
      await renderSalesHistoryPage(params.query || {});
  }
}

function destroy() {
  _destroyed = true;
  // Persist cart to sessionStorage on navigation away
  persistCart();
}

// ─── CART PERSISTENCE ─────────────────────────────────────────────────────────
function persistCart() {
  try {
    sessionStorage.setItem(
      AppConfig.SESSION_KEYS.SALES_CART,
      JSON.stringify(_state.cart)
    );
  } catch { /* storage full or unavailable */ }
}

function restoreCart() {
  try {
    const raw = sessionStorage.getItem(AppConfig.SESSION_KEYS.SALES_CART);
    _state.cart = raw ? JSON.parse(raw) : [];
  } catch {
    _state.cart = [];
  }
}

function clearCart() {
  _state.cart = [];
  sessionStorage.removeItem(AppConfig.SESSION_KEYS.SALES_CART);
}

// ─── NEW SALE PAGE ────────────────────────────────────────────────────────────
async function renderNewSalePage() {
  const content = document.getElementById('app-content');
  if (!content) return;

  // Restore any saved cart
  restoreCart();

  const currency = window.AppState.settings?.currency_symbol || '₦';

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-cash-register"></i> New Sale</h1>
        <p class="page-subtitle">Search for products and build your sale.</p>
      </div>
      <div class="page-actions">
        <a href="#/sales" class="btn btn-secondary">
          <i class="fa-solid fa-receipt"></i> Sales History
        </a>
      </div>
    </div>

    <div class="sales-layout">
      <!-- LEFT: Product Search -->
      <div>
        <!-- Product Search -->
        <div class="card" style="margin-bottom:var(--space-lg);">
          <div class="card-header">
            <h3 class="card-title">Product Search</h3>
            <span class="text-xs text-muted">Type a product name or SKU to add to cart</span>
          </div>
          <div class="search-dropdown-wrap" style="position:relative;">
            <div class="input-icon-wrap">
              <input
                class="form-input"
                type="search"
                id="sale-product-search"
                placeholder="Search by name or SKU…"
                autocomplete="off"
                spellcheck="false"
                style="padding-left:38px;"
              />
              <i class="fa-solid fa-magnifying-glass input-icon"></i>
            </div>
            <div class="search-dropdown hidden" id="sale-product-dropdown"></div>
          </div>
        </div>

        <!-- Cart Items (mobile — shows below search on small screens) -->
        <div class="card" id="mobile-cart-section" style="display:none;">
          <div id="mobile-cart-content"></div>
        </div>
      </div>

      <!-- RIGHT: Cart Panel -->
      <div class="cart-panel" id="cart-panel">
        <div class="cart-header">
          <div>
            <div class="cart-title">Shopping Cart</div>
            <div class="cart-count" id="cart-item-count">0 items</div>
          </div>
          <button class="btn btn-ghost btn-sm text-danger" id="clear-cart-btn" title="Clear cart">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>

        <div class="cart-items" id="cart-items-container">
          <div class="cart-empty" id="cart-empty-state">
            <i class="fa-solid fa-cart-shopping"></i>
            <p>Your cart is empty.<br>Search for products above to add them.</p>
          </div>
        </div>

        <div class="cart-footer" id="cart-footer">
          <div class="cart-total-row">
            <span class="cart-total-label">Total</span>
            <span class="cart-total-value" id="cart-total-display">${currency}0.00</span>
          </div>

          <div class="form-group" style="margin-bottom:var(--space-md);">
            <label class="form-label" for="sale-payment">Payment Method <span class="required">*</span></label>
            <select class="form-select" id="sale-payment">
              <option value="cash">💵 Cash</option>
              <option value="card">💳 Card</option>
              <option value="transfer">🏦 Bank Transfer</option>
              <option value="credit">⏳ Credit</option>
            </select>
          </div>

          <div class="form-group" style="margin-bottom:var(--space-md);">
            <label class="form-label" for="sale-customer">Customer Name (Optional)</label>
            <input class="form-input" type="text" id="sale-customer"
              placeholder="Walk-in customer" />
          </div>

          <div class="form-group" style="margin-bottom:var(--space-lg);">
            <label class="form-label" for="sale-notes">Notes (Optional)</label>
            <textarea class="form-textarea" id="sale-notes" rows="2"
              placeholder="Any additional notes…" style="min-height:60px;"></textarea>
          </div>

          <button class="btn btn-primary btn-full" id="confirm-sale-btn" disabled>
            <span class="btn-text"><i class="fa-solid fa-check"></i> Confirm Sale</span>
            <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
          </button>
        </div>
      </div>
    </div>
  `;

  // Render any restored cart items
  renderCartUI();

  // Bind product search
  bindProductSearch();

  // Clear cart button
  document.getElementById('clear-cart-btn')?.addEventListener('click', () => {
    if (!_state.cart.length) return;
    showConfirmModal({
      title:       'Clear Cart',
      message:     'Are you sure you want to remove all items from the cart?',
      confirmText: 'Clear Cart',
      confirmClass:'btn-danger',
      onConfirm:   () => {
        clearCart();
        renderCartUI();
        showToast('Cart cleared.', 'info');
      }
    });
  });

  // Confirm sale button
  document.getElementById('confirm-sale-btn')?.addEventListener('click', handleConfirmSale);

  // Cart item change delegation (quantity changes / removes)
  document.getElementById('cart-items-container')?.addEventListener('input', handleCartItemChange);
  document.getElementById('cart-items-container')?.addEventListener('click', handleCartItemClick);

  // Responsive: show mobile cart on small screens
  checkMobileLayout();
  window.addEventListener('resize', checkMobileLayout);
}

function checkMobileLayout() {
  const mobileSection = document.getElementById('mobile-cart-section');
  if (window.innerWidth <= 768 && mobileSection) {
    mobileSection.style.display = '';
  }
}

// ─── PRODUCT SEARCH ───────────────────────────────────────────────────────────
function bindProductSearch() {
  const searchInput = document.getElementById('sale-product-search');
  const dropdown    = document.getElementById('sale-product-dropdown');
  if (!searchInput || !dropdown) return;

  let products = [];
  let focused  = -1;

  // FIX: load all, then filter with !!p.is_active — avoids boolean/int mismatch
  db.products.toArray().then(all => {
    products = all.filter(p => !!p.is_active);
  });

  function showResults(term) {
    const results = term
      ? products
          .filter(p =>
            p.quantity > 0 &&
            (p.name.toLowerCase().includes(term.toLowerCase()) ||
             p.sku.toLowerCase().includes(term.toLowerCase()))
          )
          .slice(0, 10)
      : [];

    focused = -1;

    if (!term) { dropdown.classList.add('hidden'); return; }

    if (!results.length) {
      dropdown.innerHTML = `<div class="search-dropdown-empty">No products with stock found for "${sanitize(term)}".</div>`;
      dropdown.classList.remove('hidden');
      return;
    }

    const currency = window.AppState.settings?.currency_symbol || '₦';
    dropdown.innerHTML = results.map((p, i) => {
      const inCart   = _state.cart.find(c => c.product_id === p.id);
      const qtyColor = p.quantity <= p.low_stock_threshold ? 'var(--color-warning)' : 'var(--color-success)';

      return `
        <div class="search-dropdown-item" data-index="${i}" data-id="${p.id}" tabindex="-1">
          <div style="flex:1;min-width:0;">
            <div class="font-semibold">${sanitize(p.name)}</div>
            <div class="text-xs text-muted">
              ${sanitize(p.sku)} &nbsp;·&nbsp;
              <span style="color:${qtyColor};">${p.quantity} ${sanitize(p.unit || 'units')} available</span>
              &nbsp;·&nbsp; ${currency}${p.selling_price.toFixed(2)}
            </div>
          </div>
          ${inCart ? `<span class="badge badge-primary">In cart (${inCart.quantity})</span>` : ''}
        </div>
      `;
    }).join('');

    dropdown.classList.remove('hidden');
    dropdown._results = results;
  }

  searchInput.addEventListener('input', debounce((e) => {
    showResults(e.target.value.trim());
  }, 200));

  searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) showResults(searchInput.value.trim());
  });

  searchInput.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.search-dropdown-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focused = Math.min(focused + 1, items.length - 1);
      items.forEach((el, i) => el.classList.toggle('focused', i === focused));
      items[focused]?.scrollIntoView({ block: 'nearest' });
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      focused = Math.max(focused - 1, 0);
      items.forEach((el, i) => el.classList.toggle('focused', i === focused));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const target = focused >= 0 ? items[focused] : items[0];
      const id     = parseInt(target?.dataset.id, 10);
      if (!isNaN(id)) {
        const product = products.find(p => p.id === id);
        if (product) addToCart(product);
        searchInput.value = '';
        dropdown.classList.add('hidden');
      }
    }
    if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  });

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.search-dropdown-item[data-id]');
    if (!item) return;
    const id      = parseInt(item.dataset.id, 10);
    const product = products.find(p => p.id === id);
    if (product) addToCart(product);
    searchInput.value = '';
    dropdown.classList.add('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#sale-product-search') && !e.target.closest('#sale-product-dropdown')) {
      dropdown.classList.add('hidden');
    }
  });
}

// ─── CART MANAGEMENT ──────────────────────────────────────────────────────────
function addToCart(product) {
  const existing = _state.cart.find(i => i.product_id === product.id);

  if (existing) {
    if (existing.quantity >= product.quantity) {
      showToast(`Maximum available stock is ${product.quantity} ${product.unit || 'units'}.`, 'warning');
      return;
    }
    existing.quantity++;
    existing.subtotal = existing.quantity * existing.unit_price;
    showToast(`"${product.name}" quantity updated (${existing.quantity}).`, 'info', '', 2000);
  } else {
    _state.cart.push({
      product_id:            product.id,
      product_name:          product.name,
      product_sku:           product.sku,
      product_unit:          product.unit || '',
      available_quantity:    product.quantity,
      unit_price:            product.selling_price,
      quantity:              1,
      subtotal:              product.selling_price
    });
    showToast(`"${product.name}" added to cart.`, 'success', '', 2000);
  }

  persistCart();
  renderCartUI();
}

function removeFromCart(productId) {
  _state.cart = _state.cart.filter(i => i.product_id !== productId);
  persistCart();
  renderCartUI();
}

function updateCartQuantity(productId, newQty) {
  const item = _state.cart.find(i => i.product_id === productId);
  if (!item) return;

  const qty = parseInt(newQty, 10);
  if (isNaN(qty) || qty < 1) {
    showToast('Quantity must be at least 1.', 'warning');
    return;
  }
  if (qty > item.available_quantity) {
    showToast(`Only ${item.available_quantity} ${item.product_unit || 'units'} available.`, 'warning');
    renderCartUI(); // Reset to valid quantity
    return;
  }

  item.quantity = qty;
  item.subtotal = qty * item.unit_price;
  persistCart();
  renderCartUI();
}

function getCartTotal() {
  return _state.cart.reduce((sum, i) => sum + i.subtotal, 0);
}

// ─── CART UI RENDERING ────────────────────────────────────────────────────────
function renderCartUI() {
  const container  = document.getElementById('cart-items-container');
  const totalEl    = document.getElementById('cart-total-display');
  const countEl    = document.getElementById('cart-item-count');
  const confirmBtn = document.getElementById('confirm-sale-btn');
  const emptyState = document.getElementById('cart-empty-state');
  const currency   = window.AppState.settings?.currency_symbol || '₦';

  if (!container) return;

  const total     = getCartTotal();
  const itemCount = _state.cart.reduce((s, i) => s + i.quantity, 0);

  // Update summary elements
  if (totalEl)    totalEl.textContent   = formatCurrency(total, currency);
  if (countEl)    countEl.textContent   = `${_state.cart.length} item${_state.cart.length !== 1 ? 's' : ''} (${itemCount} units)`;
  if (confirmBtn) confirmBtn.disabled   = _state.cart.length === 0;

  if (!_state.cart.length) {
    container.innerHTML = `
      <div class="cart-empty" id="cart-empty-state">
        <i class="fa-solid fa-cart-shopping"></i>
        <p>Your cart is empty.<br>Search for products above to add them.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = _state.cart.map(item => `
    <div class="cart-item" data-product-id="${item.product_id}">
      <div>
        <div class="cart-item-name">${sanitize(item.product_name)}</div>
        <div class="cart-item-sku text-muted text-xs">${sanitize(item.product_sku)}</div>
        <div class="cart-item-controls">
          <button class="btn btn-ghost btn-xs" data-action="decrease" data-product-id="${item.product_id}" title="Decrease">
            <i class="fa-solid fa-minus"></i>
          </button>
          <input
            class="cart-qty-input"
            type="number"
            min="1"
            max="${item.available_quantity}"
            value="${item.quantity}"
            data-product-id="${item.product_id}"
            data-action="qty-input"
          />
          <button class="btn btn-ghost btn-xs" data-action="increase" data-product-id="${item.product_id}" title="Increase">
            <i class="fa-solid fa-plus"></i>
          </button>
          <span class="text-xs text-muted">/ ${item.available_quantity} avail.</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:var(--space-xs);">
        <button class="cart-item-remove" data-action="remove" data-product-id="${item.product_id}" title="Remove">
          <i class="fa-solid fa-xmark"></i>
        </button>
        <div class="cart-item-subtotal">${formatCurrency(item.subtotal, currency)}</div>
        <div class="text-xs text-muted">${currency}${item.unit_price.toFixed(2)} each</div>
      </div>
    </div>
  `).join('');
}

function handleCartItemChange(e) {
  if (e.target.dataset.action === 'qty-input') {
    const productId = parseInt(e.target.dataset.productId, 10);
    updateCartQuantity(productId, e.target.value);
  }
}

function handleCartItemClick(e) {
  const btn       = e.target.closest('[data-action][data-product-id]');
  if (!btn) return;

  const action    = btn.dataset.action;
  const productId = parseInt(btn.dataset.productId, 10);
  const item      = _state.cart.find(i => i.product_id === productId);
  if (!item) return;

  if (action === 'remove')   removeFromCart(productId);
  if (action === 'increase') updateCartQuantity(productId, item.quantity + 1);
  if (action === 'decrease') {
    if (item.quantity <= 1) {
      removeFromCart(productId);
    } else {
      updateCartQuantity(productId, item.quantity - 1);
    }
  }
}

// ─── CONFIRM SALE ─────────────────────────────────────────────────────────────
async function handleConfirmSale() {
  if (!_state.cart.length) return;

  const btnText    = document.querySelector('#confirm-sale-btn .btn-text');
  const btnSpinner = document.querySelector('#confirm-sale-btn .btn-spinner');
  const confirmBtn = document.getElementById('confirm-sale-btn');

  btnText?.classList.add('hidden');
  btnSpinner?.classList.remove('hidden');
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const payment  = document.getElementById('sale-payment')?.value || 'cash';
    const customer = document.getElementById('sale-customer')?.value.trim() || '';
    const notes    = document.getElementById('sale-notes')?.value.trim()    || '';
    const user     = getSession();

    let saleId;

    await db.transaction('rw', [
      db.sales, db.sale_items, db.products,
      db.stock_movements, db.audit_logs, db.notifications
    ], async () => {

      // ── Re-validate all quantities inside the transaction ─────────────
      for (const item of _state.cart) {
        const current = await db.products.get(item.product_id);
        if (!current || !current.is_active) {
          throw new Error(`"${item.product_name}" is no longer available.`);
        }
        if (item.quantity > current.quantity) {
          throw new Error(
            `Insufficient stock for "${item.product_name}". ` +
            `Available: ${current.quantity}, requested: ${item.quantity}.`
          );
        }
      }

      // ── Create sale record ────────────────────────────────────────────
      const total = getCartTotal();
      const now   = new Date().toISOString();

      saleId = await db.sales.add({
        user_id:       user?.id || 0,
        customer_name: customer,
        total_amount:  total,
        payment_method:payment,
        notes,
        status:        'completed',
        created_at:    now
      });

      // ── Create sale items & update stock ──────────────────────────────
      for (const item of _state.cart) {
        await db.sale_items.add({
          sale_id:               saleId,
          product_id:            item.product_id,
          product_name_snapshot: item.product_name,
          product_sku_snapshot:  item.product_sku,
          quantity:              item.quantity,
          unit_price:            item.unit_price,
          subtotal:              item.subtotal
        });

        // Decrement product quantity
        const current    = await db.products.get(item.product_id);
        const newQty     = current.quantity - item.quantity;

        await db.products.update(item.product_id, {
          quantity:   newQty,
          updated_at: now
        });

        // Stock movement record
        await db.stock_movements.add({
          product_id:     item.product_id,
          user_id:        user?.id || 0,
          type:           'sale',
          quantity:       -item.quantity,
          reference_note: `Sale #${saleId}`,
          created_at:     now
        });

        // Low stock notification check
        if (newQty <= current.low_stock_threshold) {
          const todayStr  = now.slice(0, 10);
          const existing  = await db.notifications
            .where('type').equals('low_stock')
            .and(n => n.product_id === item.product_id && n.created_at.startsWith(todayStr))
            .first();

          if (!existing) {
            await db.notifications.add({
              user_id:    null,
              type:       'low_stock',
              message:    `Low stock alert: "${item.product_name}" has ${newQty} ${current.unit || 'units'} remaining (threshold: ${current.low_stock_threshold}).`,
              product_id: item.product_id,
              is_read:    0,
              created_at: now
            });
          }
        }
      }

      // ── Audit log ─────────────────────────────────────────────────────
      await db.audit_logs.add({
        user_id:           user?.id || 0,
        user_name_snapshot:user?.name || 'System',
        action:            'create',
        entity_type:       'sales',
        entity_id:         saleId,
        old_values:        '{}',
        new_values:        JSON.stringify({ total, items: _state.cart.length, payment }),
        created_at:        now
      });
    });

    // ── Success ───────────────────────────────────────────────────────
    clearCart();
    renderCartUI();

    showToast(`Sale #${saleId} completed! Total: ${formatCurrency(getCartTotal() || 0, window.AppState.settings?.currency_symbol || '₦')}`, 'success');

    // Show receipt prompt
    showModal({
      title: 'Sale Confirmed!',
      size:  'sm',
      body: `
        <div style="text-align:center;padding:var(--space-lg) 0;">
          <i class="fa-solid fa-circle-check" style="font-size:3rem;color:var(--color-success);margin-bottom:var(--space-md);"></i>
          <p style="font-size:var(--text-lg);font-weight:600;">Sale #${saleId} recorded successfully.</p>
          <p class="text-muted" style="margin-top:var(--space-sm);">Would you like to print a receipt?</p>
        </div>
      `,
      footer: `
        <button class="btn btn-secondary" id="skip-receipt-btn">
          <i class="fa-solid fa-xmark"></i> No Thanks
        </button>
        <a href="#/sales/${saleId}/receipt" class="btn btn-primary" id="print-receipt-btn">
          <i class="fa-solid fa-print"></i> Print Receipt
        </a>
      `,
      onOpen: () => {
        document.getElementById('skip-receipt-btn')?.addEventListener('click', () => {
          closeModal();
        });
      }
    });

  } catch (err) {
    console.error('[Sales] Confirm sale error:', err);
    showToast(err.message || 'Failed to complete sale. Please try again.', 'error');
  } finally {
    btnText?.classList.remove('hidden');
    btnSpinner?.classList.add('hidden');
    if (confirmBtn) confirmBtn.disabled = _state.cart.length === 0;
  }
}

// ─── SALES HISTORY PAGE ───────────────────────────────────────────────────────
async function renderSalesHistoryPage(query = {}) {
  const content = document.getElementById('app-content');
  if (!content) return;

  if (query.page)     _state.page                = parseInt(query.page, 10) || 1;
  if (query.status)   _state.filters.status      = query.status;
  if (query.payment)  _state.filters.payment     = query.payment;
  if (query.dateFrom) _state.filters.dateFrom    = query.dateFrom;
  if (query.dateTo)   _state.filters.dateTo      = query.dateTo;
  if (query.customer) _state.filters.customer    = query.customer;

  const user     = getSession();
  const canVoid  = user?.role === 'admin' || user?.role === 'manager';
  const currency = window.AppState.settings?.currency_symbol || '₦';

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-receipt"></i> Sales History</h1>
        <p class="page-subtitle">View and manage all recorded sales.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="export-sales-btn">
          <i class="fa-solid fa-file-csv"></i> Export CSV
        </button>
        <a href="#/sales/new" class="btn btn-primary">
          <i class="fa-solid fa-plus"></i> New Sale
        </a>
      </div>
    </div>

    <!-- Daily Summary Bar -->
    <div id="daily-summary-bar" style="margin-bottom:var(--space-lg);">
      <div class="skeleton" style="height:72px;border-radius:var(--radius-md);"></div>
    </div>

    <!-- Filters -->
    <div class="filter-bar">
      <div class="filter-search">
        <input class="form-input" type="search" id="sales-search"
          placeholder="Search by customer, receipt no…"
          value="${sanitize(_state.filters.customer)}" />
      </div>
      <select class="form-select" id="sales-filter-status" style="width:140px;">
        <option value="">All Status</option>
        <option value="completed" ${_state.filters.status === 'completed' ? 'selected' : ''}>Completed</option>
        <option value="voided"    ${_state.filters.status === 'voided'    ? 'selected' : ''}>Voided</option>
      </select>
      <select class="form-select" id="sales-filter-payment" style="width:150px;">
        <option value="">All Payments</option>
        <option value="cash"     ${_state.filters.payment === 'cash'     ? 'selected' : ''}>Cash</option>
        <option value="card"     ${_state.filters.payment === 'card'     ? 'selected' : ''}>Card</option>
        <option value="transfer" ${_state.filters.payment === 'transfer' ? 'selected' : ''}>Transfer</option>
        <option value="credit"   ${_state.filters.payment === 'credit'   ? 'selected' : ''}>Credit</option>
      </select>
      <input class="form-input" type="date" id="sales-date-from"
        value="${sanitize(_state.filters.dateFrom)}" style="width:150px;" />
      <input class="form-input" type="date" id="sales-date-to"
        value="${sanitize(_state.filters.dateTo)}" style="width:150px;" />
      <button class="btn btn-ghost btn-sm" id="sales-clear-btn">
        <i class="fa-solid fa-xmark"></i> Clear
      </button>
    </div>

    <!-- Sales Table -->
    <div class="card" style="padding:0;">
      <div id="sales-table-container"></div>
      <div id="sales-pagination"></div>
    </div>
  `;

  // Load daily summary
  await loadDailySummary(currency);

  // Load all sales
  let allSales = await db.sales.orderBy('created_at').reverse().toArray();

  // Pre-load sale item counts
  const allItems    = await db.sale_items.toArray();
  const itemCounts  = {};
  allItems.forEach(i => {
    itemCounts[i.sale_id] = (itemCounts[i.sale_id] || 0) + 1;
  });

  allSales = allSales.map(s => ({ ...s, item_count: itemCounts[s.id] || 0 }));

  function applyFiltersAndRender() {
    let filtered = [...allSales];

    const searchTerm = document.getElementById('sales-search')?.value.trim().toLowerCase() || '';
    if (searchTerm) {
      filtered = filtered.filter(s =>
        (s.customer_name || '').toLowerCase().includes(searchTerm) ||
        formatReceiptNumber(s.id).toLowerCase().includes(searchTerm)
      );
    }

    if (_state.filters.status)  filtered = filtered.filter(s => s.status         === _state.filters.status);
    if (_state.filters.payment) filtered = filtered.filter(s => s.payment_method  === _state.filters.payment);

    if (_state.filters.dateFrom) {
      const from = new Date(_state.filters.dateFrom); from.setHours(0, 0, 0, 0);
      filtered = filtered.filter(s => new Date(s.created_at) >= from);
    }
    if (_state.filters.dateTo) {
      const to = new Date(_state.filters.dateTo); to.setHours(23, 59, 59, 999);
      filtered = filtered.filter(s => new Date(s.created_at) <= to);
    }

    const { data, total } = paginate(filtered, _state.page, _state.pageSize);
    renderSalesTable(data, total, filtered, canVoid, currency);
  }

  function renderSalesTable(data, total, filtered, canVoid, currency) {
    const container = document.getElementById('sales-table-container');
    const pagWrap   = document.getElementById('sales-pagination');

    if (!data.length) {
      if (container) container.innerHTML = renderEmptyState('No sales found.', 'fa-solid fa-receipt',
        `<a href="#/sales/new" class="btn btn-primary btn-sm"><i class="fa-solid fa-plus"></i> New Sale</a>`);
      if (pagWrap) pagWrap.innerHTML = '';
      return;
    }

    if (container) {
      container.innerHTML = `
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Receipt #</th>
                <th>Date & Time</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total</th>
                <th>Payment</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${data.map(sale => `
                <tr>
                  <td><strong>${sanitize(formatReceiptNumber(sale.id))}</strong></td>
                  <td style="white-space:nowrap;">${formatDateTime(sale.created_at)}</td>
                  <td>${sanitize(sale.customer_name || '—')}</td>
                  <td><span class="badge badge-neutral">${sale.item_count} item(s)</span></td>
                  <td><strong>${formatCurrency(sale.total_amount, currency)}</strong></td>
                  <td>${paymentBadge(sale.payment_method)}</td>
                  <td>${saleStatusBadge(sale.status)}</td>
                  <td>
                    <div class="table-actions">
                      <a href="#/sales/${sale.id}" class="btn btn-ghost btn-sm" title="View">
                        <i class="fa-solid fa-eye"></i>
                      </a>
                      <a href="#/sales/${sale.id}/receipt" class="btn btn-ghost btn-sm" title="Receipt">
                        <i class="fa-solid fa-print"></i>
                      </a>
                      ${canVoid && sale.status === 'completed' ? `
                        <button class="btn btn-ghost btn-sm text-danger"
                          data-action="void" data-id="${sale.id}" data-total="${sale.total_amount}"
                          title="Void Sale">
                          <i class="fa-solid fa-ban"></i>
                        </button>
                      ` : ''}
                    </div>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      // Void button delegation
      container.addEventListener('click', async (e) => {
        const btn = e.target.closest('[data-action="void"][data-id]');
        if (!btn) return;
        const saleId = parseInt(btn.dataset.id, 10);
        await promptVoidSale(saleId, () => {
          applyFiltersAndRender();
          loadDailySummary(currency);
        });
      });
    }

    if (pagWrap) {
      renderPagination(pagWrap, {
        total,
        page:         _state.page,
        pageSize:     _state.pageSize,
        onPageChange: (p) => { _state.page = p; applyFiltersAndRender(); },
        onSizeChange: (s) => { _state.pageSize = s; _state.page = 1; applyFiltersAndRender(); }
      });
    }
  }

  // Filter bindings
  document.getElementById('sales-search')?.addEventListener('input', debounce(() => {
    _state.page = 1; applyFiltersAndRender();
  }, 300));

  ['sales-filter-status', 'sales-filter-payment'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', (e) => {
      const key = id === 'sales-filter-status' ? 'status' : 'payment';
      _state.filters[key] = e.target.value;
      _state.page = 1;
      applyFiltersAndRender();
    });
  });

  ['sales-date-from', 'sales-date-to'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', (e) => {
      const key = id === 'sales-date-from' ? 'dateFrom' : 'dateTo';
      _state.filters[key] = e.target.value;
      _state.page = 1;
      applyFiltersAndRender();
    });
  });

  document.getElementById('sales-clear-btn')?.addEventListener('click', () => {
    _state.filters = { status: '', payment: '', dateFrom: '', dateTo: '', customer: '' };
    _state.page    = 1;
    document.getElementById('sales-search').value         = '';
    document.getElementById('sales-filter-status').value  = '';
    document.getElementById('sales-filter-payment').value = '';
    document.getElementById('sales-date-from').value      = '';
    document.getElementById('sales-date-to').value        = '';
    applyFiltersAndRender();
  });

  document.getElementById('export-sales-btn')?.addEventListener('click', async () => {
    try {
      const exportData = allSales.map(s => ({
        Receipt_No:    formatReceiptNumber(s.id),
        Date:          formatDateTime(s.created_at),
        Customer:      s.customer_name || '',
        Items:         s.item_count,
        Total:         s.total_amount,
        Payment:       s.payment_method,
        Status:        s.status,
        Notes:         s.notes || ''
      }));
      exportCSV(exportData, `sales-history-${new Date().toISOString().slice(0, 10)}`);
      showToast(`Exported ${exportData.length} sale records.`, 'success');
    } catch (err) {
      showToast('Export failed.', 'error');
    }
  });

  applyFiltersAndRender();
}

async function loadDailySummary(currency) {
  const bar = document.getElementById('daily-summary-bar');
  if (!bar) return;

  try {
    const today      = new Date();
    const todayStr   = today.toISOString().slice(0, 10);
    const todaySales = await db.sales
      .where('created_at').aboveOrEqual(todayStr)
      .and(s => s.status === 'completed' && s.created_at.startsWith(todayStr))
      .toArray();

    const revenue     = todaySales.reduce((s, sale) => s + sale.total_amount, 0);
    const payBreakdown = { cash: 0, card: 0, transfer: 0, credit: 0 };
    todaySales.forEach(s => {
      payBreakdown[s.payment_method] = (payBreakdown[s.payment_method] || 0) + s.total_amount;
    });

    bar.innerHTML = `
      <div class="stat-row">
        <div class="stat-row-item">
          <span class="stat-row-label">Today's Transactions</span>
          <span class="stat-row-value">${todaySales.length}</span>
        </div>
        <div class="stat-row-item">
          <span class="stat-row-label">Today's Revenue</span>
          <span class="stat-row-value">${formatCurrency(revenue, currency)}</span>
        </div>
        ${Object.entries(payBreakdown).filter(([, v]) => v > 0).map(([method, amount]) => `
          <div class="stat-row-item">
            <span class="stat-row-label">${method.charAt(0).toUpperCase() + method.slice(1)}</span>
            <span class="stat-row-value">${formatCurrency(amount, currency)}</span>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    console.error('[Sales] Daily summary error:', err);
    bar.innerHTML = '';
  }
}

// ─── SALE DETAIL PAGE ─────────────────────────────────────────────────────────
async function renderSaleDetailPage(saleId) {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `<div class="card"><div class="skeleton skeleton-chart"></div></div>`;

  try {
    const sale  = await db.sales.get(Number(saleId));
    if (!sale) {
      showToast('Sale not found.', 'error');
      window.location.hash = '#/sales';
      return;
    }

    const items    = await getSaleItems(sale.id);
    const user     = getSession();
    const canVoid  = (user?.role === 'admin' || user?.role === 'manager') && sale.status === 'completed';
    const currency = window.AppState.settings?.currency_symbol || '₦';

    content.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">
            Sale Detail — ${sanitize(formatReceiptNumber(sale.id))}
          </h1>
          <p class="page-subtitle">
            ${formatDateTime(sale.created_at)} &nbsp;·&nbsp;
            ${saleStatusBadge(sale.status)}
          </p>
        </div>
        <div class="page-actions">
          <a href="#/sales" class="btn btn-secondary">
            <i class="fa-solid fa-arrow-left"></i> Back
          </a>
          <a href="#/sales/${sale.id}/receipt" class="btn btn-secondary">
            <i class="fa-solid fa-print"></i> Print Receipt
          </a>
          ${canVoid ? `
            <button class="btn btn-danger" id="void-sale-btn">
              <i class="fa-solid fa-ban"></i> Void Sale
            </button>
          ` : ''}
        </div>
      </div>

      <div class="dashboard-grid" style="margin-bottom:var(--space-xl);">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Sale Information</h3>
          </div>
          <div class="form-print-row">
            <span class="form-print-label">Receipt No.:</span>
            <span><strong>${sanitize(formatReceiptNumber(sale.id))}</strong></span>
          </div>
          <div class="form-print-row">
            <span class="form-print-label">Date & Time:</span>
            <span>${formatDateTime(sale.created_at)}</span>
          </div>
          <div class="form-print-row">
            <span class="form-print-label">Customer:</span>
            <span>${sanitize(sale.customer_name || 'Walk-in Customer')}</span>
          </div>
          <div class="form-print-row">
            <span class="form-print-label">Payment:</span>
            <span>${paymentBadge(sale.payment_method)}</span>
          </div>
          <div class="form-print-row">
            <span class="form-print-label">Status:</span>
            <span>${saleStatusBadge(sale.status)}</span>
          </div>
          ${sale.notes ? `
            <div class="form-print-row">
              <span class="form-print-label">Notes:</span>
              <span class="text-muted">${sanitize(sale.notes)}</span>
            </div>
          ` : ''}
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Sale Summary</h3>
          </div>
          <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);gap:var(--space-md);">
            <div class="kpi-card" style="padding:var(--space-lg);">
              <div class="kpi-card-value">${items.length}</div>
              <div class="kpi-card-label">Products</div>
            </div>
            <div class="kpi-card" style="padding:var(--space-lg);">
              <div class="kpi-card-value">${items.reduce((s, i) => s + i.quantity, 0)}</div>
              <div class="kpi-card-label">Total Units</div>
            </div>
            <div class="kpi-card" style="padding:var(--space-lg);grid-column:1/-1;">
              <div class="kpi-card-value">${formatCurrency(sale.total_amount, currency)}</div>
              <div class="kpi-card-label">Grand Total</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Sale Items Table -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Items Sold</h3>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>SKU</th>
                <th>Unit Price</th>
                <th>Quantity</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item, idx) => `
                <tr>
                  <td class="text-muted">${idx + 1}</td>
                  <td><strong>${sanitize(item.product_name_snapshot)}</strong></td>
                  <td><code style="font-size:var(--text-xs);background:var(--color-surface-2);padding:2px 6px;border-radius:4px;">${sanitize(item.product_sku_snapshot)}</code></td>
                  <td>${formatCurrency(item.unit_price, currency)}</td>
                  <td>${item.quantity.toLocaleString()}</td>
                  <td><strong>${formatCurrency(item.subtotal, currency)}</strong></td>
                </tr>
              `).join('')}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="5" style="text-align:right;font-weight:600;padding:var(--space-md) var(--space-lg);">
                  Grand Total:
                </td>
                <td style="font-weight:700;font-size:var(--text-lg);color:var(--color-primary);padding:var(--space-md) var(--space-lg);">
                  ${formatCurrency(sale.total_amount, currency)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;

    // Void sale handler
    document.getElementById('void-sale-btn')?.addEventListener('click', async () => {
      await promptVoidSale(sale.id, () => {
        renderSaleDetailPage(sale.id);
      });
    });

  } catch (err) {
    console.error('[Sales] Detail error:', err);
    showToast('Failed to load sale details.', 'error');
  }
}

// ─── VOID SALE ────────────────────────────────────────────────────────────────
async function promptVoidSale(saleId, onVoided) {
  showConfirmModal({
    title:       'Void Sale',
    message:     `Are you sure you want to void sale ${formatReceiptNumber(saleId)}? All stock will be restored and this action is permanent.`,
    confirmText: 'Void Sale',
    confirmClass:'btn-danger',
    onConfirm:   async () => {
      try {
        showSpinner();
        await voidSale(saleId);
        showToast(`Sale ${formatReceiptNumber(saleId)} has been voided and stock restored.`, 'success');
        if (typeof onVoided === 'function') onVoided();
      } catch (err) {
        console.error('[Sales] Void error:', err);
        showToast(err.message || 'Failed to void sale.', 'error');
      } finally {
        hideSpinner();
      }
    }
  });
}

async function voidSale(saleId) {
  const user = getSession();
  const now  = new Date().toISOString();

  await db.transaction('rw', [
    db.sales, db.sale_items, db.products,
    db.stock_movements, db.audit_logs
  ], async () => {
    const sale = await db.sales.get(saleId);
    if (!sale)                      throw new Error('Sale not found.');
    if (sale.status === 'voided')   throw new Error('Sale is already voided.');

    // Mark sale as voided
    await db.sales.update(saleId, { status: 'voided' });

    // Restore stock for each item
    const items = await db.sale_items.where('sale_id').equals(saleId).toArray();

    for (const item of items) {
      const product = await db.products.get(item.product_id);
      if (!product) continue;

      const newQty = product.quantity + item.quantity;

      await db.products.update(item.product_id, {
        quantity:   newQty,
        updated_at: now
      });

      await db.stock_movements.add({
        product_id:     item.product_id,
        user_id:        user?.id || 0,
        type:           'return',
        quantity:       item.quantity,
        reference_note: `Void: Sale #${saleId}`,
        created_at:     now
      });
    }

    // Audit log
    await db.audit_logs.add({
      user_id:           user?.id || 0,
      user_name_snapshot:user?.name || 'System',
      action:            'void',
      entity_type:       'sales',
      entity_id:         saleId,
      old_values:        JSON.stringify({ status: 'completed' }),
      new_values:        JSON.stringify({ status: 'voided' }),
      created_at:        now
    });
  });
}

// ─── RECEIPT PAGE ─────────────────────────────────────────────────────────────
async function renderReceiptPage(saleId) {
  const content = document.getElementById('app-content');
  if (!content) return;

  try {
    const sale = await db.sales.get(Number(saleId));
    if (!sale) {
      showToast('Sale not found.', 'error');
      window.location.hash = '#/sales';
      return;
    }

    const items    = await getSaleItems(sale.id);
    const settings = window.AppState.settings || {};
    const currency = settings.currency_symbol || '₦';
    const bizName  = settings.business_name   || 'My Business';
    const bizAddr  = settings.business_address || '';
    const bizPhone = settings.business_phone   || '';
    const bizEmail = settings.business_email   || '';
    const logoB64  = settings.business_logo_base64 || '';

    content.innerHTML = `
      <div class="page-header no-print">
        <div>
          <h1 class="page-title"><i class="fa-solid fa-print"></i> Receipt</h1>
        </div>
        <div class="page-actions">
          <a href="#/sales/${sale.id}" class="btn btn-secondary no-print">
            <i class="fa-solid fa-arrow-left"></i> Back to Sale
          </a>
          <button class="btn btn-primary no-print" id="print-btn">
            <i class="fa-solid fa-print"></i> Print Receipt
          </button>
        </div>
      </div>

      <div class="receipt" id="receipt-content">
        <div class="receipt-header">
          ${logoB64 ? `<img src="${logoB64}" alt="${sanitize(bizName)}" class="receipt-logo" />` : ''}
          <div class="receipt-biz-name">${sanitize(bizName)}</div>
          ${bizAddr  ? `<div class="receipt-biz-info">${sanitize(bizAddr)}</div>`  : ''}
          ${bizPhone ? `<div class="receipt-biz-info">Tel: ${sanitize(bizPhone)}</div>` : ''}
          ${bizEmail ? `<div class="receipt-biz-info">${sanitize(bizEmail)}</div>` : ''}
        </div>

        <div class="receipt-divider"></div>

        <div class="receipt-meta">
          <span>Receipt: <strong>${sanitize(formatReceiptNumber(sale.id))}</strong></span>
          <span>${formatDateTime(sale.created_at)}</span>
        </div>
        ${sale.customer_name ? `
          <div class="receipt-meta" style="margin-top:4px;">
            <span>Customer: ${sanitize(sale.customer_name)}</span>
          </div>
        ` : ''}

        <div class="receipt-divider"></div>

        <table class="receipt-items">
          <thead>
            <tr>
              <th style="text-align:left;">Item</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Price</th>
              <th style="text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(item => `
              <tr>
                <td>${sanitize(item.product_name_snapshot)}</td>
                <td style="text-align:center;">${item.quantity}</td>
                <td style="text-align:right;">${formatCurrency(item.unit_price, currency)}</td>
                <td style="text-align:right;">${formatCurrency(item.subtotal, currency)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="receipt-divider"></div>

        <div class="receipt-total-section">
          <div class="receipt-total-row">
            <span>Subtotal</span>
            <span>${formatCurrency(sale.total_amount, currency)}</span>
          </div>
          <div class="receipt-total-row grand">
            <span>TOTAL</span>
            <span>${formatCurrency(sale.total_amount, currency)}</span>
          </div>
        </div>

        <div class="receipt-payment-info">
          Payment Method: <strong>${sale.payment_method.toUpperCase()}</strong>
        </div>

        ${sale.notes ? `<div class="receipt-payment-info text-muted">${sanitize(sale.notes)}</div>` : ''}

        <div class="receipt-divider"></div>

        <div class="receipt-footer">
          <p>Thank you for your business!</p>
          <p style="margin-top:4px;">${sanitize(bizName)}</p>
        </div>
      </div>
    `;

    document.getElementById('print-btn')?.addEventListener('click', () => {
      window.print();
    });

  } catch (err) {
    console.error('[Sales] Receipt error:', err);
    showToast('Failed to load receipt.', 'error');
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export { init, destroy, voidSale };
