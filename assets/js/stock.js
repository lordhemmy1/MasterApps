/**
 * Stockdity IMS — Stock Module
 * Handles: Stock In, Stock Out, Stock Adjustment, Movement History.
 */

import db, { getLowStockProducts } from './db.js';
import { getSession } from './auth.js';
import {
  showToast, showSpinner, hideSpinner, showModal, closeModal,
  renderPagination, renderEmptyState, sanitize
} from './ui.js';
import {
  formatDateTime, formatDate, debounce, sortBy,
  filterBySearch, paginate, exportCSV,
  movementTypeBadge, formatMovementQuantity, validate
} from './utils.js';
import { writeAuditLog } from './audit.js';
import { checkAndGenerateLowStockNotification } from './notifications.js';

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _state = {
  action:       'in',
  movements:    [],
  filtered:     [],
  page:         1,
  pageSize:     20,
  sortKey:      'created_at',
  sortDir:      'desc',
  searchTerm:   '',
  filters:      { type: '', product: '', dateFrom: '', dateTo: '' }
};
let _destroyed = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init(params = {}) {
  _destroyed   = false;
  _state.action = params.action || 'in';

  const content = document.getElementById('app-content');
  if (!content) return;

  switch (_state.action) {
    case 'in':      renderStockInPage();      break;
    case 'out':     renderStockOutPage();     break;
    case 'adjust':  renderAdjustmentPage();   break;
    case 'history': await renderHistoryPage(params.query || {}); break;
    default:        renderStockInPage();
  }
}

function destroy() {
  _destroyed = true;
}

// ─── SHARED: PRODUCT SEARCHABLE DROPDOWN ─────────────────────────────────────
/**
 * Render a searchable product select dropdown into a container.
 * @param {string} containerId
 * @param {Object} options
 */
async function renderProductSearchField(containerId, options = {}) {
  const { onSelect, filterFn = null, placeholder = 'Search product by name or SKU…' } = options;

  const container = document.getElementById(containerId);
  if (!container) return;

  // FIX: load all, filter with !!p.is_active — avoids boolean/int mismatch
  let products = (await db.products.toArray()).filter(p => !!p.is_active);
  if (filterFn) products = products.filter(filterFn);
  
  let selectedProduct = null;
  let dropdownVisible = false;

  container.innerHTML = `
    <div class="search-dropdown-wrap" id="prod-search-wrap-${containerId}">
      <input
        class="form-input"
        type="search"
        id="prod-search-input-${containerId}"
        placeholder="${sanitize(placeholder)}"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="search-dropdown hidden" id="prod-search-dropdown-${containerId}"></div>
    </div>
    <input type="hidden" id="prod-selected-id-${containerId}" value="" />
    <div id="prod-selected-info-${containerId}" class="hidden" style="
      margin-top:var(--space-sm);padding:var(--space-md);
      background:var(--color-primary-light);border-radius:var(--radius-md);
      border:1px solid var(--color-primary);font-size:var(--text-sm);
    "></div>
  `;

  const searchInput  = document.getElementById(`prod-search-input-${containerId}`);
  const dropdown     = document.getElementById(`prod-search-dropdown-${containerId}`);
  const hiddenInput  = document.getElementById(`prod-selected-id-${containerId}`);
  const selectedInfo = document.getElementById(`prod-selected-info-${containerId}`);
  const currency     = window.AppState.settings?.currency_symbol || '₦';

  function showDropdown(term) {
    const filtered = term
      ? products.filter(p =>
          p.name.toLowerCase().includes(term.toLowerCase()) ||
          p.sku.toLowerCase().includes(term.toLowerCase())
        ).slice(0, 12)
      : products.slice(0, 12);

    if (!filtered.length) {
      dropdown.innerHTML = `<div class="search-dropdown-empty">No products found.</div>`;
    } else {
      dropdown.innerHTML = filtered.map(p => `
        <div class="search-dropdown-item" data-id="${p.id}">
          <div>
            <div class="font-semibold">${sanitize(p.name)}</div>
            <div class="text-xs text-muted">
              SKU: ${sanitize(p.sku)} &nbsp;·&nbsp;
              Stock: ${p.quantity} ${sanitize(p.unit || '')} &nbsp;·&nbsp;
              Price: ${currency}${p.selling_price.toFixed(2)}
            </div>
          </div>
        </div>
      `).join('');
    }

    dropdown.classList.remove('hidden');
    dropdownVisible = true;
  }

  function hideDropdown() {
    dropdown.classList.add('hidden');
    dropdownVisible = false;
  }

  function selectProduct(product) {
    selectedProduct       = product;
    hiddenInput.value     = product.id;
    searchInput.value     = `${product.name} (${product.sku})`;

    const isExpired = product.expiry_date && new Date(product.expiry_date) < new Date();
    selectedInfo.innerHTML = `
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:var(--space-sm);">
        <div>
          <strong>${sanitize(product.name)}</strong>
          <span class="text-muted text-xs" style="margin-left:var(--space-sm);">${sanitize(product.sku)}</span>
        </div>
        <div style="display:flex;gap:var(--space-md);">
          <span>Current Stock: <strong>${product.quantity} ${sanitize(product.unit || '')}</strong></span>
          <span>Cost: <strong>${currency}${product.cost_price.toFixed(2)}</strong></span>
          ${isExpired ? `<span class="badge badge-danger">Expired</span>` : ''}
        </div>
      </div>
    `;
    selectedInfo.classList.remove('hidden');
    hideDropdown();

    if (typeof onSelect === 'function') onSelect(product);
  }

  // Search input events
  searchInput.addEventListener('input', debounce((e) => {
    const term = e.target.value.trim();
    if (!term && selectedProduct) {
      // Clear selection
      selectedProduct   = null;
      hiddenInput.value = '';
      selectedInfo.classList.add('hidden');
    }
    showDropdown(term);
  }, 250));

  searchInput.addEventListener('focus', () => showDropdown(searchInput.value.trim()));

  // Keyboard navigation
  searchInput.addEventListener('keydown', (e) => {
    if (!dropdownVisible) return;
    const items = dropdown.querySelectorAll('.search-dropdown-item');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const focused = dropdown.querySelector('.focused');
      const next    = focused ? focused.nextElementSibling : items[0];
      if (focused) focused.classList.remove('focused');
      next?.classList.add('focused');
      next?.scrollIntoView({ block: 'nearest' });
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const focused = dropdown.querySelector('.focused');
      const prev    = focused ? focused.previousElementSibling : items[items.length - 1];
      if (focused) focused.classList.remove('focused');
      prev?.classList.add('focused');
      prev?.scrollIntoView({ block: 'nearest' });
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const focused = dropdown.querySelector('.focused');
      if (focused) {
        const id = parseInt(focused.dataset.id, 10);
        const p  = products.find(p => p.id === id);
        if (p) selectProduct(p);
      }
    }

    if (e.key === 'Escape') hideDropdown();
  });

  // Dropdown click
  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.search-dropdown-item[data-id]');
    if (!item) return;
    const id = parseInt(item.dataset.id, 10);
    const p  = products.find(p => p.id === id);
    if (p) selectProduct(p);
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) hideDropdown();
  });

  return {
    getSelected: () => selectedProduct,
    reset: () => {
      selectedProduct   = null;
      hiddenInput.value = '';
      searchInput.value = '';
      selectedInfo.classList.add('hidden');
      hideDropdown();
    },
    refresh: async () => {
      // FIX: same filter approach
      const all = await db.products.toArray();
      products = all.filter(p => !!p.is_active);
      if (filterFn) products = products.filter(filterFn);
    }
  };
}   // ← CLOSING BRACE FOR renderProductSearchField ADDED HERE

// ─── STOCK IN PAGE ────────────────────────────────────────────────────────────
function renderStockInPage() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-arrow-down-to-line"></i> Stock In</h1>
        <p class="page-subtitle">Record incoming stock for any product.</p>
      </div>
      <div class="page-actions">
        <a href="#/stock/history" class="btn btn-secondary">
          <i class="fa-solid fa-clock-rotate-left"></i> View History
        </a>
      </div>
    </div>

    <div class="card" style="max-width:700px;">
      <div class="card-header">
        <h3 class="card-title">Record Stock Receipt</h3>
      </div>
      <form id="stock-in-form" novalidate autocomplete="off">

        <div class="form-group">
          <label class="form-label">Product <span class="required">*</span></label>
          <div id="stock-in-product-search"></div>
          <span class="form-error-text" id="stock-in-product-err"></span>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="stock-in-qty">Quantity Received <span class="required">*</span></label>
            <input class="form-input" type="number" id="stock-in-qty" min="1" step="1"
              placeholder="e.g. 50" required />
            <span class="form-error-text" id="stock-in-qty-err"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="stock-in-supplier">Supplier (Optional)</label>
            <select class="form-select" id="stock-in-supplier">
              <option value="">-- Select Supplier --</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="stock-in-ref">Reference / Invoice No.</label>
            <input class="form-input" type="text" id="stock-in-ref"
              placeholder="e.g. INV-2024-001" />
          </div>
          <div class="form-group">
            <label class="form-label" for="stock-in-date">Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="stock-in-date"
              value="${new Date().toISOString().slice(0, 10)}" required />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="stock-in-note">Additional Notes</label>
          <textarea class="form-textarea" id="stock-in-note" rows="2"
            placeholder="Optional notes about this stock receipt…"></textarea>
        </div>

        <div style="display:flex;gap:var(--space-md);justify-content:flex-end;">
          <button type="button" class="btn btn-secondary" id="stock-in-reset-btn">
            <i class="fa-solid fa-rotate-left"></i> Reset
          </button>
          <button type="submit" class="btn btn-success" id="stock-in-submit-btn">
            <span class="btn-text"><i class="fa-solid fa-arrow-down-to-line"></i> Record Stock In</span>
            <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
          </button>
        </div>
      </form>
    </div>
  `;

  // Populate suppliers — FIX: safe filter
  db.suppliers.filter(s => !!s.is_active).toArray().then(suppliers => {
    const select = document.getElementById('stock-in-supplier');
    if (select) {
      suppliers.forEach(s => {
        const opt = document.createElement('option');
        opt.value       = s.id;
        opt.textContent = s.name;
        select.appendChild(opt);
      });
    }
  });

  // Render product search
  let productSearch;
  renderProductSearchField('stock-in-product-search', {
    placeholder: 'Search product by name or SKU…'
  }).then(ps => { productSearch = ps; });

  // Reset button
  document.getElementById('stock-in-reset-btn')?.addEventListener('click', () => {
    productSearch?.reset();
    document.getElementById('stock-in-qty').value  = '';
    document.getElementById('stock-in-ref').value  = '';
    document.getElementById('stock-in-note').value = '';
    document.getElementById('stock-in-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('stock-in-product-err').textContent = '';
    document.getElementById('stock-in-qty-err').textContent     = '';
  });

  // Form submit
  document.getElementById('stock-in-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btnText    = document.querySelector('#stock-in-submit-btn .btn-text');
    const btnSpinner = document.querySelector('#stock-in-submit-btn .btn-spinner');

    // Clear errors
    document.getElementById('stock-in-product-err').textContent = '';
    document.getElementById('stock-in-qty-err').textContent     = '';

    const product     = productSearch?.getSelected();
    const qty         = parseInt(document.getElementById('stock-in-qty').value, 10);
    const supplierId  = parseInt(document.getElementById('stock-in-supplier').value) || null;
    const reference   = document.getElementById('stock-in-ref').value.trim();
    const date        = document.getElementById('stock-in-date').value;
    const note        = document.getElementById('stock-in-note').value.trim();

    let hasError = false;

    if (!product) {
      document.getElementById('stock-in-product-err').textContent = 'Please select a product.';
      hasError = true;
    }
    if (!qty || qty < 1) {
      document.getElementById('stock-in-qty-err').textContent = 'Quantity must be at least 1.';
      hasError = true;
    }
    if (hasError) return;

    btnText?.classList.add('hidden');
    btnSpinner?.classList.remove('hidden');

    try {
      await recordStockIn({
        product,
        quantity:    qty,
        supplier_id: supplierId,
        reference,
        date,
        note
      });

      showToast(`Stock In recorded: +${qty} ${product.unit || 'units'} of "${product.name}".`, 'success');

      // Reset form
      productSearch?.reset();
      document.getElementById('stock-in-qty').value  = '';
      document.getElementById('stock-in-ref').value  = '';
      document.getElementById('stock-in-note').value = '';
      productSearch?.refresh();

    } catch (err) {
      console.error('[Stock] Stock In error:', err);
      showToast(err.message || 'Failed to record stock in.', 'error');
    } finally {
      btnText?.classList.remove('hidden');
      btnSpinner?.classList.add('hidden');
    }
  });
}

async function recordStockIn({ product, quantity, supplier_id, reference, date, note }) {
  const user = getSession();
  const now  = date ? new Date(date).toISOString() : new Date().toISOString();

  const refNote = [reference, note].filter(Boolean).join(' — ') || 'Stock In';

  await db.transaction('rw', [db.products, db.stock_movements, db.audit_logs], async () => {
    // Re-read quantity inside transaction for integrity
    const current = await db.products.get(product.id);
    if (!current) throw new Error('Product not found.');

    const newQty = current.quantity + quantity;

    await db.products.update(product.id, {
      quantity:   newQty,
      updated_at: new Date().toISOString()
    });

    await db.stock_movements.add({
      product_id:     product.id,
      user_id:        user?.id || 0,
      type:           'stock_in',
      quantity:       quantity,
      reference_note: refNote,
      created_at:     now
    });

    await db.audit_logs.add({
      user_id:           user?.id || 0,
      user_name_snapshot:user?.name || 'System',
      action:            'update',
      entity_type:       'products',
      entity_id:         product.id,
      old_values:        JSON.stringify({ quantity: current.quantity }),
      new_values:        JSON.stringify({ quantity: newQty, movement: 'stock_in', amount: quantity }),
      created_at:        new Date().toISOString()
    });
  });

  // Check if this resolves a low stock notification
  await checkAndGenerateLowStockNotification(product.id);
}

// ─── STOCK OUT PAGE ───────────────────────────────────────────────────────────
function renderStockOutPage() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-arrow-up-from-line"></i> Stock Out</h1>
        <p class="page-subtitle">Record stock removed for reasons other than a sale.</p>
      </div>
      <div class="page-actions">
        <a href="#/stock/history" class="btn btn-secondary">
          <i class="fa-solid fa-clock-rotate-left"></i> View History
        </a>
      </div>
    </div>

    <div class="card" style="max-width:700px;">
      <div class="card-header">
        <h3 class="card-title">Record Stock Removal</h3>
      </div>
      <form id="stock-out-form" novalidate autocomplete="off">

        <div class="form-group">
          <label class="form-label">Product <span class="required">*</span></label>
          <div id="stock-out-product-search"></div>
          <span class="form-error-text" id="stock-out-product-err"></span>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="stock-out-qty">Quantity to Remove <span class="required">*</span></label>
            <input class="form-input" type="number" id="stock-out-qty" min="1" step="1"
              placeholder="e.g. 10" required />
            <span class="form-helper-text" id="stock-out-available"></span>
            <span class="form-error-text" id="stock-out-qty-err"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="stock-out-date">Date <span class="required">*</span></label>
            <input class="form-input" type="date" id="stock-out-date"
              value="${new Date().toISOString().slice(0, 10)}" required />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="stock-out-reason">Reason / Note <span class="required">*</span></label>
          <input class="form-input" type="text" id="stock-out-reason"
            placeholder="e.g. Damaged goods, internal use, theft…" required />
          <span class="form-error-text" id="stock-out-reason-err"></span>
        </div>

        <div style="display:flex;gap:var(--space-md);justify-content:flex-end;">
          <a href="#/stock/history" class="btn btn-secondary">Cancel</a>
          <button type="submit" class="btn btn-warning" id="stock-out-submit-btn">
            <span class="btn-text"><i class="fa-solid fa-arrow-up-from-line"></i> Record Stock Out</span>
            <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
          </button>
        </div>
      </form>
    </div>
  `;

  let currentProduct = null;
  let productSearch;

  renderProductSearchField('stock-out-product-search', {
    filterFn:    (p) => p.quantity > 0,
    placeholder: 'Search products with available stock…',
    onSelect:    (p) => {
      currentProduct = p;
      const availEl = document.getElementById('stock-out-available');
      if (availEl) availEl.textContent = `Available: ${p.quantity} ${p.unit || 'units'}`;
    }
  }).then(ps => { productSearch = ps; });

  document.getElementById('stock-out-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const productErr = document.getElementById('stock-out-product-err');
    const qtyErr     = document.getElementById('stock-out-qty-err');
    const reasonErr  = document.getElementById('stock-out-reason-err');
    const btnText    = document.querySelector('#stock-out-submit-btn .btn-text');
    const btnSpinner = document.querySelector('#stock-out-submit-btn .btn-spinner');

    productErr.textContent = '';
    qtyErr.textContent     = '';
    reasonErr.textContent  = '';

    const product = productSearch?.getSelected() || currentProduct;
    const qty     = parseInt(document.getElementById('stock-out-qty').value, 10);
    const reason  = document.getElementById('stock-out-reason').value.trim();
    const date    = document.getElementById('stock-out-date').value;

    let hasError = false;

    if (!product)      { productErr.textContent = 'Please select a product.'; hasError = true; }
    if (!qty || qty < 1) { qtyErr.textContent   = 'Quantity must be at least 1.'; hasError = true; }
    if (!reason)       { reasonErr.textContent  = 'Reason is required.'; hasError = true; }
    if (hasError) return;

    if (qty > product.quantity) {
      qtyErr.textContent = `Cannot remove more than current stock (${product.quantity}).`;
      return;
    }

    btnText?.classList.add('hidden');
    btnSpinner?.classList.remove('hidden');

    try {
      await recordStockOut({ product, quantity: qty, reason, date });
      showToast(`Stock Out recorded: -${qty} ${product.unit || 'units'} of "${product.name}".`, 'success');
      productSearch?.reset();
      document.getElementById('stock-out-qty').value    = '';
      document.getElementById('stock-out-reason').value = '';
      document.getElementById('stock-out-available').textContent = '';
      currentProduct = null;
      await productSearch?.refresh();
    } catch (err) {
      console.error('[Stock] Stock Out error:', err);
      showToast(err.message || 'Failed to record stock out.', 'error');
    } finally {
      btnText?.classList.remove('hidden');
      btnSpinner?.classList.add('hidden');
    }
  });
}

async function recordStockOut({ product, quantity, reason, date }) {
  const user = getSession();
  const now  = date ? new Date(date).toISOString() : new Date().toISOString();

  await db.transaction('rw', [db.products, db.stock_movements, db.audit_logs], async () => {
    const current = await db.products.get(product.id);
    if (!current) throw new Error('Product not found.');
    if (quantity > current.quantity) {
      throw new Error(`Insufficient stock. Available: ${current.quantity}.`);
    }

    const newQty = current.quantity - quantity;

    await db.products.update(product.id, {
      quantity:   newQty,
      updated_at: new Date().toISOString()
    });

    await db.stock_movements.add({
      product_id:     product.id,
      user_id:        user?.id || 0,
      type:           'stock_out',
      quantity:       -quantity,
      reference_note: reason,
      created_at:     now
    });

    await db.audit_logs.add({
      user_id:           user?.id || 0,
      user_name_snapshot:user?.name || 'System',
      action:            'update',
      entity_type:       'products',
      entity_id:         product.id,
      old_values:        JSON.stringify({ quantity: current.quantity }),
      new_values:        JSON.stringify({ quantity: newQty, movement: 'stock_out', amount: quantity }),
      created_at:        new Date().toISOString()
    });
  });

  await checkAndGenerateLowStockNotification(product.id);
}

// ─── STOCK ADJUSTMENT PAGE ────────────────────────────────────────────────────
function renderAdjustmentPage() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-sliders"></i> Stock Adjustment</h1>
        <p class="page-subtitle">Correct the stock count for a product (e.g. after a physical count).</p>
      </div>
      <div class="page-actions">
        <a href="#/stock/history" class="btn btn-secondary">
          <i class="fa-solid fa-clock-rotate-left"></i> View History
        </a>
      </div>
    </div>

    <div class="card" style="max-width:700px;">
      <div class="card-header">
        <h3 class="card-title">Adjust Stock Quantity</h3>
      </div>
      <form id="adjust-form" novalidate autocomplete="off">

        <div class="form-group">
          <label class="form-label">Product <span class="required">*</span></label>
          <div id="adjust-product-search"></div>
          <span class="form-error-text" id="adjust-product-err"></span>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="adjust-current-qty">Current Quantity (System)</label>
            <input class="form-input" type="number" id="adjust-current-qty"
              readonly disabled style="background:var(--color-surface-2);color:var(--color-text-secondary);" />
          </div>
          <div class="form-group">
            <label class="form-label" for="adjust-new-qty">Corrected Quantity <span class="required">*</span></label>
            <input class="form-input" type="number" id="adjust-new-qty"
              min="0" step="1" placeholder="Actual quantity counted" required />
            <span class="form-error-text" id="adjust-new-qty-err"></span>
          </div>
        </div>

        <!-- Difference indicator -->
        <div id="adjust-diff-display" class="hidden" style="
          padding:var(--space-md);background:var(--color-surface-2);
          border-radius:var(--radius-md);border:1px solid var(--color-border);
          margin-bottom:var(--space-lg);font-size:var(--text-sm);
        ">
          <strong>Adjustment:</strong>
          <span id="adjust-diff-value" style="font-weight:700;font-size:var(--text-lg);margin-left:var(--space-sm);"></span>
          units
        </div>

        <div class="form-group">
          <label class="form-label" for="adjust-justification">Justification <span class="required">*</span></label>
          <textarea class="form-textarea" id="adjust-justification" rows="3" required
            placeholder="e.g. Physical stock count on 15/05/2024 — discrepancy found…"></textarea>
          <span class="form-error-text" id="adjust-justification-err"></span>
        </div>

        <div class="alert alert-warning" style="margin-bottom:var(--space-lg);">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>This action is logged in the audit trail. Use it only for genuine count corrections.</span>
        </div>

        <div style="display:flex;gap:var(--space-md);justify-content:flex-end;">
          <a href="#/stock/history" class="btn btn-secondary">Cancel</a>
          <button type="submit" class="btn btn-primary" id="adjust-submit-btn" disabled>
            <span class="btn-text"><i class="fa-solid fa-sliders"></i> Apply Adjustment</span>
            <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
          </button>
        </div>
      </form>
    </div>
  `;

  let currentProduct  = null;
  let productSearch;

  renderProductSearchField('adjust-product-search', {
    placeholder: 'Search product to adjust…',
    onSelect: (p) => {
      currentProduct = p;
      const currentEl = document.getElementById('adjust-current-qty');
      if (currentEl) currentEl.value = p.quantity;
      updateDiffDisplay();
    }
  }).then(ps => { productSearch = ps; });

  function updateDiffDisplay() {
    if (!currentProduct) return;

    const newQtyEl   = document.getElementById('adjust-new-qty');
    const diffDisplay = document.getElementById('adjust-diff-display');
    const diffValue   = document.getElementById('adjust-diff-value');
    const submitBtn   = document.getElementById('adjust-submit-btn');
    const newQty      = parseInt(newQtyEl?.value, 10);

    if (isNaN(newQty) || !currentProduct) {
      diffDisplay?.classList.add('hidden');
      if (submitBtn) submitBtn.disabled = true;
      return;
    }

    const diff = newQty - currentProduct.quantity;
    diffDisplay?.classList.remove('hidden');

    if (diffValue) {
      diffValue.textContent = diff >= 0 ? `+${diff}` : String(diff);
      diffValue.style.color = diff > 0
        ? 'var(--color-success)'
        : diff < 0
        ? 'var(--color-danger)'
        : 'var(--color-text-secondary)';
    }

    if (submitBtn) submitBtn.disabled = diff === 0;
  }

  document.getElementById('adjust-new-qty')?.addEventListener('input', updateDiffDisplay);

  document.getElementById('adjust-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const productErr       = document.getElementById('adjust-product-err');
    const newQtyErr        = document.getElementById('adjust-new-qty-err');
    const justificationErr = document.getElementById('adjust-justification-err');
    const btnText          = document.querySelector('#adjust-submit-btn .btn-text');
    const btnSpinner       = document.querySelector('#adjust-submit-btn .btn-spinner');

    productErr.textContent       = '';
    newQtyErr.textContent        = '';
    justificationErr.textContent = '';

    const product       = productSearch?.getSelected() || currentProduct;
    const newQty        = parseInt(document.getElementById('adjust-new-qty').value, 10);
    const justification = document.getElementById('adjust-justification').value.trim();

    let hasError = false;
    if (!product)           { productErr.textContent       = 'Please select a product.'; hasError = true; }
    if (isNaN(newQty) || newQty < 0) { newQtyErr.textContent = 'Enter a valid non-negative quantity.'; hasError = true; }
    if (!justification)     { justificationErr.textContent = 'Justification is required.'; hasError = true; }
    if (hasError) return;

    btnText?.classList.add('hidden');
    btnSpinner?.classList.remove('hidden');

    try {
      const diff = newQty - product.quantity;
      await recordAdjustment({ product, newQty, diff, justification });
      showToast(`Stock adjusted for "${product.name}": ${diff >= 0 ? '+' : ''}${diff} units.`, 'success');

      productSearch?.reset();
      document.getElementById('adjust-new-qty').value        = '';
      document.getElementById('adjust-justification').value  = '';
      document.getElementById('adjust-current-qty').value    = '';
      document.getElementById('adjust-diff-display')?.classList.add('hidden');
      document.getElementById('adjust-submit-btn').disabled  = true;
      currentProduct = null;
      await productSearch?.refresh();

    } catch (err) {
      console.error('[Stock] Adjustment error:', err);
      showToast(err.message || 'Failed to apply adjustment.', 'error');
    } finally {
      btnText?.classList.remove('hidden');
      btnSpinner?.classList.add('hidden');
    }
  });
}

async function recordAdjustment({ product, newQty, diff, justification }) {
  const user = getSession();
  const now  = new Date().toISOString();

  await db.transaction('rw', [db.products, db.stock_movements, db.audit_logs], async () => {
    const current = await db.products.get(product.id);
    if (!current) throw new Error('Product not found.');

    await db.products.update(product.id, {
      quantity:   newQty,
      updated_at: now
    });

    await db.stock_movements.add({
      product_id:     product.id,
      user_id:        user?.id || 0,
      type:           'adjustment',
      quantity:       diff,
      reference_note: justification,
      created_at:     now
    });

    await db.audit_logs.add({
      user_id:           user?.id || 0,
      user_name_snapshot:user?.name || 'System',
      action:            'update',
      entity_type:       'products',
      entity_id:         product.id,
      old_values:        JSON.stringify({ quantity: current.quantity }),
      new_values:        JSON.stringify({ quantity: newQty, movement: 'adjustment', diff }),
      created_at:        now
    });
  });

  await checkAndGenerateLowStockNotification(product.id);
}

// ─── STOCK HISTORY PAGE ───────────────────────────────────────────────────────
async function renderHistoryPage(query = {}) {
  const content = document.getElementById('app-content');
  if (!content) return;

  // Apply URL params
  if (query.type)     _state.filters.type     = query.type;
  if (query.dateFrom) _state.filters.dateFrom  = query.dateFrom;
  if (query.dateTo)   _state.filters.dateTo    = query.dateTo;

  const products = await db.products.toArray();
  const users    = await db.users.toArray();
  const prodMap  = Object.fromEntries(products.map(p => [p.id, p]));
  const userMap  = Object.fromEntries(users.map(u => [u.id, u]));

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-clock-rotate-left"></i> Stock Movement History</h1>
        <p class="page-subtitle">Complete log of all inventory movements.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="export-movements-btn">
          <i class="fa-solid fa-file-csv"></i> Export CSV
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="filter-bar">
      <div class="filter-search">
        <input class="form-input" type="search" id="hist-search"
          placeholder="Search product name…"
          value="${sanitize(_state.searchTerm)}" />
      </div>
      <select class="form-select" id="hist-filter-type" style="width:160px;">
        <option value="">All Types</option>
        <option value="stock_in"   ${_state.filters.type === 'stock_in'   ? 'selected' : ''}>Stock In</option>
        <option value="stock_out"  ${_state.filters.type === 'stock_out'  ? 'selected' : ''}>Stock Out</option>
        <option value="adjustment" ${_state.filters.type === 'adjustment' ? 'selected' : ''}>Adjustment</option>
        <option value="sale"       ${_state.filters.type === 'sale'       ? 'selected' : ''}>Sale</option>
        <option value="return"     ${_state.filters.type === 'return'     ? 'selected' : ''}>Return</option>
      </select>
      <input class="form-input" type="date" id="hist-date-from"
        value="${sanitize(_state.filters.dateFrom)}" style="width:160px;" title="From date" />
      <input class="form-input" type="date" id="hist-date-to"
        value="${sanitize(_state.filters.dateTo)}" style="width:160px;" title="To date" />
      <button class="btn btn-ghost btn-sm" id="hist-clear-btn">
        <i class="fa-solid fa-xmark"></i> Clear
      </button>
    </div>

    <!-- Table -->
    <div class="card" style="padding:0;">
      <div id="history-table-container"></div>
      <div id="history-pagination"></div>
    </div>
  `;

  // Load movements
  let allMovements = await db.stock_movements.orderBy('created_at').reverse().toArray();

  // Enrich with product and user names
  allMovements = allMovements.map(m => ({
    ...m,
    product_name: prodMap[m.product_id]?.name || `Product #${m.product_id}`,
    product_unit: prodMap[m.product_id]?.unit || '',
    user_name:    userMap[m.user_id]?.name    || 'System'
  }));

  _state.movements = allMovements;

  function applyFiltersAndRender() {
    let filtered = [..._state.movements];

    // Search
    if (_state.searchTerm) {
      filtered = filtered.filter(m =>
        m.product_name.toLowerCase().includes(_state.searchTerm.toLowerCase())
      );
    }
    // Type filter
    if (_state.filters.type) {
      filtered = filtered.filter(m => m.type === _state.filters.type);
    }
    // Date from
    if (_state.filters.dateFrom) {
      const from = new Date(_state.filters.dateFrom);
      from.setHours(0, 0, 0, 0);
      filtered = filtered.filter(m => new Date(m.created_at) >= from);
    }
    // Date to
    if (_state.filters.dateTo) {
      const to = new Date(_state.filters.dateTo);
      to.setHours(23, 59, 59, 999);
      filtered = filtered.filter(m => new Date(m.created_at) <= to);
    }

    _state.filtered = filtered;
    renderHistoryTable();
  }

  function renderHistoryTable() {
    const container = document.getElementById('history-table-container');
    const pagWrap   = document.getElementById('history-pagination');
    if (!container) return;

    const { data, total } = paginate(_state.filtered, _state.page, _state.pageSize);

    if (!data.length) {
      container.innerHTML = renderEmptyState('No stock movements found.', 'fa-solid fa-clock-rotate-left');
      if (pagWrap) pagWrap.innerHTML = '';
      return;
    }

    container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Date & Time</th>
              <th>Product</th>
              <th>Type</th>
              <th>Quantity</th>
              <th>Reference / Note</th>
              <th>Recorded By</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(m => {
              const qty      = m.quantity;
              const qtyColor = m.type === 'stock_in'
                ? 'var(--color-success)'
                : m.type === 'adjustment'
                ? (qty >= 0 ? 'var(--color-info)' : 'var(--color-warning)')
                : 'var(--color-danger)';
              const qtyStr = qty >= 0 ? `+${qty}` : String(qty);

              return `
                <tr>
                  <td style="white-space:nowrap;">${formatDateTime(m.created_at)}</td>
                  <td>
                    <a href="#/products/${m.product_id}" class="font-semibold" style="color:var(--color-primary);">
                      ${sanitize(m.product_name)}
                    </a>
                  </td>
                  <td>${renderMovementBadge(m.type)}</td>
                  <td>
                    <strong style="color:${qtyColor};font-size:var(--text-base);">${qtyStr}</strong>
                    <span class="text-xs text-muted">${sanitize(m.product_unit)}</span>
                  </td>
                  <td class="text-muted" style="max-width:240px;">${sanitize(truncate(m.reference_note || '—', 60))}</td>
                  <td>${sanitize(m.user_name)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    if (pagWrap) {
      renderPagination(pagWrap, {
        total,
        page:       _state.page,
        pageSize:   _state.pageSize,
        onPageChange: (p) => { _state.page = p; renderHistoryTable(); },
        onSizeChange: (s) => { _state.pageSize = s; _state.page = 1; renderHistoryTable(); }
      });
    }
  }

  // Filter events
  document.getElementById('hist-search')?.addEventListener('input', debounce((e) => {
    _state.searchTerm = e.target.value.trim();
    _state.page = 1;
    applyFiltersAndRender();
  }, 300));

  document.getElementById('hist-filter-type')?.addEventListener('change', (e) => {
    _state.filters.type = e.target.value;
    _state.page = 1;
    applyFiltersAndRender();
  });

  document.getElementById('hist-date-from')?.addEventListener('change', (e) => {
    _state.filters.dateFrom = e.target.value;
    _state.page = 1;
    applyFiltersAndRender();
  });

  document.getElementById('hist-date-to')?.addEventListener('change', (e) => {
    _state.filters.dateTo = e.target.value;
    _state.page = 1;
    applyFiltersAndRender();
  });

  document.getElementById('hist-clear-btn')?.addEventListener('click', () => {
    _state.searchTerm = '';
    _state.filters    = { type: '', product: '', dateFrom: '', dateTo: '' };
    _state.page       = 1;
    document.getElementById('hist-search').value       = '';
    document.getElementById('hist-filter-type').value  = '';
    document.getElementById('hist-date-from').value    = '';
    document.getElementById('hist-date-to').value      = '';
    applyFiltersAndRender();
  });

  // Export
  document.getElementById('export-movements-btn')?.addEventListener('click', () => {
    const exportData = _state.filtered.map(m => ({
      Date:         formatDateTime(m.created_at),
      Product:      m.product_name,
      Type:         m.type,
      Quantity:     m.quantity,
      Note:         m.reference_note || '',
      Recorded_By:  m.user_name
    }));
    const date = new Date().toISOString().slice(0, 10);
    exportCSV(exportData, `stock-movements-${date}`);
    showToast(`Exported ${exportData.length} movement records.`, 'success');
  });

  // Initial render
  applyFiltersAndRender();
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function renderMovementBadge(type) {
  const map = {
    stock_in:   ['badge-success', 'fa-arrow-down-to-line', 'Stock In'],
    stock_out:  ['badge-warning', 'fa-arrow-up-from-line', 'Stock Out'],
    adjustment: ['badge-info',    'fa-sliders',            'Adjustment'],
    sale:       ['badge-primary', 'fa-cash-register',      'Sale'],
    return:     ['badge-neutral', 'fa-rotate-left',        'Return']
  };
  const [cls, icon, label] = map[type] || ['badge-neutral', 'fa-question', type];
  return `<span class="badge ${cls}"><i class="fa-solid ${icon}"></i> ${sanitize(label)}</span>`;
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ─── EXPORTS ─────────────────────────────────────────────────────────────────
export { init, destroy, recordStockIn, recordStockOut };
