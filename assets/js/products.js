/**
 * Stockdity IMS — Products Module
 * Handles: product list, add, edit, detail, soft-delete,
 * CSV bulk import, CSV bulk export, image upload.
 */

import db, { getActiveProducts, getProductById, skuExists } from './db.js';
import { getSession } from './auth.js';
import {
  showToast, showModal, closeModal, showConfirmModal,
  showSpinner, hideSpinner, renderPagination,
  renderEmptyState, stockStatusBadge, sanitize,
  renderProductImage, toggleVisible
} from './ui.js';
import {
  formatCurrency, formatDate, formatDateTime,
  generateSKU, calculateProfitMargin, debounce,
  sortBy, filterBySearch, paginate, exportCSV,
  validateImageFile, fileToBase64, expiryStatus,
  daysUntilExpiry, validate, truncate
} from './utils.js';
import { writeAuditLog } from './audit.js';
import { generateNotificationsForDashboard } from './notifications.js';

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _state = {
  allProducts:  [],
  filtered:     [],
  categories:   [],
  suppliers:    [],
  page:         1,
  pageSize:     20,
  sortKey:      'name',
  sortDir:      'asc',
  searchTerm:   '',
  filters:      { category: '', supplier: '', unit: '', status: '' },
  action:       'list',
  editingId:    null
};
let _destroyed = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init(params = {}) {
  _destroyed   = false;
  _state.action = params.action || 'list';

  const content = document.getElementById('app-content');
  if (!content) return;

  try {
    _state.categories = await db.categories.orderBy('name').toArray();

    // FIX: use filter() — avoids boolean vs integer is_active mismatch
    _state.suppliers = await db.suppliers.filter(s => !!s.is_active).toArray();

    switch (_state.action) {
      case 'add':    renderProductForm(null);          break;
      case 'edit':   await renderEditProduct(params.id); break;
      case 'detail': await renderProductDetail(params.id); break;
      default:       await renderProductList(params.query || {});
    }
  } catch (err) {
    console.error('[Products] Init error:', err);
    showToast('Failed to load products.', 'error');
  }
}

function destroy() {
  _destroyed = true;
}

// ─── PRODUCT LIST ─────────────────────────────────────────────────────────────
async function renderProductList(query = {}) {
  const content = document.getElementById('app-content');
  if (!content) return;

  // Apply URL query params to state
  if (query.page)     _state.page     = parseInt(query.page, 10) || 1;
  if (query.search)   _state.searchTerm = query.search;
  if (query.category) _state.filters.category = query.category;
  if (query.status)   _state.filters.status   = query.status;
  if (query.sort)     _state.sortKey  = query.sort;
  if (query.dir)      _state.sortDir  = query.dir;

  content.innerHTML = buildListShell();
  bindListEvents();
  await fetchAndRenderProducts();
}

function buildListShell() {
  const user = getSession();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  return `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-boxes-stacked"></i> Products</h1>
        <p class="page-subtitle">Manage your product catalogue and inventory.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="export-csv-btn">
          <i class="fa-solid fa-file-csv"></i> Export CSV
        </button>
        <button class="btn btn-secondary" id="import-csv-btn">
          <i class="fa-solid fa-file-import"></i> Import CSV
        </button>
        ${canEdit ? `
          <a href="#/products/add" class="btn btn-primary">
            <i class="fa-solid fa-plus"></i> Add Product
          </a>
        ` : ''}
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <div class="filter-search search-dropdown-wrap">
        <input
          class="form-input"
          type="search"
          id="product-search"
          placeholder="Search by name, SKU, barcode…"
          value="${sanitize(_state.searchTerm)}"
          autocomplete="off"
        />
      </div>
      <select class="form-select" id="filter-category" style="width:160px;">
        <option value="">All Categories</option>
        ${_state.categories.map(c =>
          `<option value="${c.id}" ${_state.filters.category == c.id ? 'selected' : ''}>
            ${sanitize(c.name)}
          </option>`
        ).join('')}
      </select>
      <select class="form-select" id="filter-status" style="width:150px;">
        <option value="">All Status</option>
        <option value="in-stock"   ${_state.filters.status === 'in-stock'    ? 'selected' : ''}>In Stock</option>
        <option value="low-stock"  ${_state.filters.status === 'low-stock'   ? 'selected' : ''}>Low Stock</option>
        <option value="out-stock"  ${_state.filters.status === 'out-stock'   ? 'selected' : ''}>Out of Stock</option>
        <option value="expired"    ${_state.filters.status === 'expired'     ? 'selected' : ''}>Expired</option>
      </select>
      <select class="form-select" id="filter-supplier" style="width:160px;">
        <option value="">All Suppliers</option>
        ${_state.suppliers.map(s =>
          `<option value="${s.id}" ${_state.filters.supplier == s.id ? 'selected' : ''}>
            ${sanitize(s.name)}
          </option>`
        ).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" id="clear-filters-btn">
        <i class="fa-solid fa-xmark"></i> Clear
      </button>
    </div>

    <!-- Product Table -->
    <div class="card" style="padding:0;">
      <div id="products-table-container"></div>
      <div id="products-pagination"></div>
    </div>
  `;
}

function bindListEvents() {
  // Search with debounce
  const searchInput = document.getElementById('product-search');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(async (e) => {
      _state.searchTerm = e.target.value.trim();
      _state.page = 1;
      await fetchAndRenderProducts();
    }, 300));
  }

  // Filters
  ['filter-category', 'filter-status', 'filter-supplier'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', async (e) => {
      const key = id.replace('filter-', '');
      _state.filters[key] = e.target.value;
      _state.page = 1;
      await fetchAndRenderProducts();
    });
  });

  // Clear filters
  document.getElementById('clear-filters-btn')?.addEventListener('click', async () => {
    _state.searchTerm = '';
    _state.filters    = { category: '', supplier: '', unit: '', status: '' };
    _state.page       = 1;
    document.getElementById('product-search').value    = '';
    document.getElementById('filter-category').value   = '';
    document.getElementById('filter-status').value     = '';
    document.getElementById('filter-supplier').value   = '';
    await fetchAndRenderProducts();
  });

  // Export
  document.getElementById('export-csv-btn')?.addEventListener('click', handleExportCSV);

  // Import
  document.getElementById('import-csv-btn')?.addEventListener('click', showImportModal);

  // Event delegation for table actions
  document.getElementById('products-table-container')?.addEventListener('click', handleTableClick);
}

async function fetchAndRenderProducts() {
  const container = document.getElementById('products-table-container');
  const pagWrap   = document.getElementById('products-pagination');
  if (!container) return;

  try {
    // Load fresh data
    _state.allProducts = await getActiveProducts();

    // Apply search
    let filtered = filterBySearch(
      _state.allProducts,
      _state.searchTerm,
      ['name', 'sku', 'barcode', 'category_name', 'supplier_name']
    );

    // Apply filters
    if (_state.filters.category) {
      filtered = filtered.filter(p => String(p.category_id) === String(_state.filters.category));
    }
    if (_state.filters.supplier) {
      filtered = filtered.filter(p => String(p.supplier_id) === String(_state.filters.supplier));
    }
    if (_state.filters.status) {
      filtered = filtered.filter(p => {
        const isExpired = p.expiry_date && new Date(p.expiry_date) < new Date();
        switch (_state.filters.status) {
          case 'in-stock':  return !isExpired && p.quantity > p.low_stock_threshold;
          case 'low-stock': return !isExpired && p.quantity > 0 && p.quantity <= p.low_stock_threshold;
          case 'out-stock': return p.quantity === 0;
          case 'expired':   return isExpired;
          default:          return true;
        }
      });
    }

    // Sort
    _state.filtered = sortBy(filtered, _state.sortKey, _state.sortDir);

    // Paginate
    const { data, total } = paginate(_state.filtered, _state.page, _state.pageSize);

    if (_destroyed) return;

    if (!data.length) {
      container.innerHTML = renderEmptyState(
        _state.searchTerm || Object.values(_state.filters).some(Boolean)
          ? 'No products match your filters.'
          : 'No products found. Add your first product!',
        'fa-solid fa-boxes-stacked',
        `<a href="#/products/add" class="btn btn-primary btn-sm"><i class="fa-solid fa-plus"></i> Add Product</a>`
      );
      if (pagWrap) pagWrap.innerHTML = '';
      return;
    }

    const currency = window.AppState.settings?.currency_symbol || '₦';
    const user     = getSession();
    const canEdit  = user?.role === 'admin' || user?.role === 'manager';

    container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th style="width:48px;"></th>
              <th class="sortable ${_state.sortKey === 'name' ? (_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}"
                  data-sort="name">Name</th>
              <th class="sortable ${_state.sortKey === 'sku'  ? (_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}"
                  data-sort="sku">SKU</th>
              <th>Category</th>
              <th class="sortable ${_state.sortKey === 'quantity' ? (_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}"
                  data-sort="quantity">Stock</th>
              <th class="sortable ${_state.sortKey === 'selling_price' ? (_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}"
                  data-sort="selling_price">Price</th>
              <th>Margin</th>
              <th>Expiry</th>
              <th>Status</th>
              ${canEdit ? '<th style="width:100px;">Actions</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${data.map(p => {
              const margin   = calculateProfitMargin(p.cost_price, p.selling_price);
              const expiry   = expiryStatus(p.expiry_date);
              const rowClass = p.expiry_date && new Date(p.expiry_date) < new Date()
                ? 'row-expired'
                : p.expiry_date && daysUntilExpiry(p.expiry_date) <= 30
                ? 'row-expiring' : '';

              return `
                <tr class="${rowClass}">
                  <td>${renderProductImage(p.image_base64, p.name, 'thumb')}</td>
                  <td>
                    <a href="#/products/${p.id}" class="font-semibold" style="color:var(--color-primary);">
                      ${sanitize(p.name)}
                    </a>
                    ${p.barcode ? `<br><span class="text-xs text-muted">${sanitize(p.barcode)}</span>` : ''}
                  </td>
                  <td><code style="font-size:var(--text-xs);background:var(--color-surface-2);padding:2px 6px;border-radius:4px;">${sanitize(p.sku)}</code></td>
                  <td>${sanitize(p.category_name || '—')}</td>
                  <td>
                    <span class="font-semibold">${p.quantity.toLocaleString()}</span>
                    <span class="text-muted text-xs">${sanitize(p.unit || '')}</span>
                  </td>
                  <td>${formatCurrency(p.selling_price, currency)}</td>
                  <td>
                    <span class="${margin >= 20 ? 'text-success' : margin >= 10 ? 'text-warning' : 'text-danger'} font-semibold">
                      ${margin.toFixed(1)}%
                    </span>
                  </td>
                  <td class="${expiry.cssClass}">${sanitize(expiry.label)}</td>
                  <td>${stockStatusBadge(p.quantity, p.low_stock_threshold, p.expiry_date)}</td>
                  ${canEdit ? `
                    <td>
                      <div class="table-actions">
                        <a href="#/products/${p.id}/edit" class="btn btn-ghost btn-sm" title="Edit">
                          <i class="fa-solid fa-pen"></i>
                        </a>
                        <button class="btn btn-ghost btn-sm text-danger" data-action="delete" data-id="${p.id}" data-name="${sanitize(p.name)}" title="Delete">
                          <i class="fa-solid fa-trash"></i>
                        </button>
                      </div>
                    </td>
                  ` : ''}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Sortable headers
    container.querySelectorAll('th[data-sort]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', async () => {
        const key = th.dataset.sort;
        _state.sortDir = (_state.sortKey === key && _state.sortDir === 'asc') ? 'desc' : 'asc';
        _state.sortKey = key;
        _state.page    = 1;
        await fetchAndRenderProducts();
      });
    });

    // Pagination
    if (pagWrap) {
      renderPagination(pagWrap, {
        total,
        page:       _state.page,
        pageSize:   _state.pageSize,
        pageSizes:  [10, 20, 50],
        onPageChange: async (p) => { _state.page = p; await fetchAndRenderProducts(); },
        onSizeChange: async (s) => { _state.pageSize = s; _state.page = 1; await fetchAndRenderProducts(); }
      });
    }

  } catch (err) {
    console.error('[Products] Fetch error:', err);
    if (container) container.innerHTML = `<div class="alert alert-danger" style="margin:var(--space-lg);">Failed to load products.</div>`;
  }
}

// ─── TABLE CLICK HANDLER (delegation) ────────────────────────────────────────
async function handleTableClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const id     = parseInt(btn.dataset.id, 10);

  if (action === 'delete') {
    const name = btn.dataset.name || 'this product';
    showConfirmModal({
      title:       'Delete Product',
      message:     `Are you sure you want to delete "${name}"? This action cannot be undone. The product will be deactivated and hidden from your catalogue.`,
      confirmText: 'Delete',
      confirmClass:'btn-danger',
      onConfirm:   () => softDeleteProduct(id)
    });
  }
}

// ─── SOFT DELETE ─────────────────────────────────────────────────────────────
async function softDeleteProduct(id) {
  try {
    showSpinner();
    const product = await db.products.get(id);
    if (!product) throw new Error('Product not found.');

    await db.products.update(id, {
      is_active:  0,        // ← integer 0, not boolean false
      updated_at: new Date().toISOString()
    });

    await writeAuditLog({
      action:      'delete',
      entity_type: 'products',
      entity_id:   id,
      old_values:  product,
      new_values:  { is_active: 0 }
    });

    showToast(`"${product.name}" has been deleted.`, 'success');
    await fetchAndRenderProducts();

  } catch (err) {
    console.error('[Products] Delete error:', err);
    showToast('Failed to delete product.', 'error');
  } finally {
    hideSpinner();
  }
}

// ─── PRODUCT FORM (Add / Edit) ────────────────────────────────────────────────
async function renderProductForm(product = null) {
  const content    = document.getElementById('app-content');
  if (!content) return;

  const isEditing  = !!product;
  const categories = await db.categories.orderBy('name').toArray();
  const suppliers  = await db.suppliers.where('is_active').equals(1).toArray();
  const currency   = window.AppState.settings?.currency_symbol || '₦';

  const defaultThreshold = window.AppState.settings?.default_low_stock_threshold || '10';

  const units = ['pieces', 'packs', 'cartons', 'kg', 'g', 'litres', 'ml', 'bottles', 'custom'];

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">
          <i class="fa-solid fa-${isEditing ? 'pen' : 'plus'}"></i>
          ${isEditing ? `Edit Product: ${sanitize(product.name)}` : 'Add New Product'}
        </h1>
      </div>
      <div class="page-actions">
        <a href="#/products" class="btn btn-secondary">
          <i class="fa-solid fa-arrow-left"></i> Back to Products
        </a>
      </div>
    </div>

    <form id="product-form" novalidate autocomplete="off">
      <div class="dashboard-grid" style="align-items:start;">

        <!-- Left Column -->
        <div style="display:flex;flex-direction:column;gap:var(--space-lg);">

          <!-- Basic Information -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Basic Information</h3>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="p-name">Product Name <span class="required">*</span></label>
                <input class="form-input" type="text" id="p-name" name="name"
                  value="${sanitize(product?.name || '')}" required placeholder="e.g. Paracetamol 500mg" />
                <span class="form-error-text" id="p-name-err"></span>
              </div>
              <div class="form-group">
                <label class="form-label" for="p-sku">SKU <span class="required">*</span></label>
                <div style="display:flex;gap:var(--space-xs);">
                  <input class="form-input" type="text" id="p-sku" name="sku"
                    value="${sanitize(product?.sku || '')}" required
                    placeholder="AUTO-1234" spellcheck="false" style="flex:1;" />
                  ${!isEditing ? `<button type="button" class="btn btn-secondary btn-sm" id="gen-sku-btn" title="Generate SKU">
                    <i class="fa-solid fa-rotate"></i>
                  </button>` : ''}
                </div>
                <span class="form-error-text" id="p-sku-err"></span>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="p-barcode">Barcode</label>
                <input class="form-input" type="text" id="p-barcode" name="barcode"
                  value="${sanitize(product?.barcode || '')}" placeholder="Optional" />
              </div>
              <div class="form-group">
                <label class="form-label" for="p-unit">Unit of Measurement</label>
                <select class="form-select" id="p-unit" name="unit">
                  ${units.map(u => `<option value="${u}" ${product?.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
                </select>
              </div>
            </div>

            <div id="custom-unit-wrap" class="form-group" style="${product?.unit === 'custom' ? '' : 'display:none;'}">
              <label class="form-label" for="p-unit-custom">Custom Unit Name</label>
              <input class="form-input" type="text" id="p-unit-custom" name="unit_custom"
                value="${sanitize(product?.unit !== 'custom' && !units.includes(product?.unit || '') ? product?.unit || '' : '')}"
                placeholder="e.g. tablets, rolls" />
            </div>

            <div class="form-group">
              <label class="form-label" for="p-desc">Description</label>
              <textarea class="form-textarea" id="p-desc" name="description" rows="3"
                placeholder="Optional product description…">${sanitize(product?.description || '')}</textarea>
            </div>
          </div>

          <!-- Pricing -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Pricing</h3>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="p-cost">Cost Price (${sanitize(currency)}) <span class="required">*</span></label>
                <input class="form-input" type="number" id="p-cost" name="cost_price"
                  min="0" step="0.01" value="${product?.cost_price || ''}" placeholder="0.00" required />
                <span class="form-error-text" id="p-cost-err"></span>
              </div>
              <div class="form-group">
                <label class="form-label" for="p-sell">Selling Price (${sanitize(currency)}) <span class="required">*</span></label>
                <input class="form-input" type="number" id="p-sell" name="selling_price"
                  min="0" step="0.01" value="${product?.selling_price || ''}" placeholder="0.00" required />
                <span class="form-error-text" id="p-sell-err"></span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Profit Margin</label>
              <div id="margin-display" class="form-inline-val">—</div>
            </div>
          </div>

          <!-- Categorisation -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Categorisation</h3>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="p-category">Category</label>
                <div style="display:flex;gap:var(--space-xs);">
                  <select class="form-select" id="p-category" name="category_id" style="flex:1;">
                    <option value="">-- Select Category --</option>
                    ${categories.map(c =>
                      `<option value="${c.id}" ${product?.category_id == c.id ? 'selected' : ''}>${sanitize(c.name)}</option>`
                    ).join('')}
                  </select>
                  <button type="button" class="btn btn-secondary btn-sm" id="add-cat-inline-btn" title="Add new category">
                    <i class="fa-solid fa-plus"></i>
                  </button>
                </div>
                <span class="form-error-text" id="p-category-err"></span>
              </div>
              <div class="form-group">
                <label class="form-label" for="p-supplier">Supplier</label>
                <select class="form-select" id="p-supplier" name="supplier_id">
                  <option value="">-- No Supplier --</option>
                  ${suppliers.map(s =>
                    `<option value="${s.id}" ${product?.supplier_id == s.id ? 'selected' : ''}>${sanitize(s.name)}</option>`
                  ).join('')}
                </select>
              </div>
            </div>
          </div>

        </div>

        <!-- Right Column -->
        <div style="display:flex;flex-direction:column;gap:var(--space-lg);">

          <!-- Product Image -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Product Image</h3>
            </div>
            <div style="display:flex;align-items:flex-start;gap:var(--space-lg);">
              <div class="image-preview-wrap" id="image-preview-wrap">
                ${product?.image_base64
                  ? `<img src="${product.image_base64}" alt="Product" id="image-preview-img" style="width:100%;height:100%;object-fit:cover;" />`
                  : `<div class="image-preview-placeholder" id="image-placeholder">
                      <i class="fa-solid fa-image"></i>
                      <span>No image</span>
                    </div>`
                }
                ${product?.image_base64
                  ? `<button type="button" class="image-remove-btn" id="remove-image-btn" title="Remove image">
                      <i class="fa-solid fa-xmark"></i>
                    </button>`
                  : ''
                }
              </div>
              <div style="flex:1;">
                <input type="file" id="p-image" name="image" accept="image/jpeg,image/png,image/webp" style="display:none;" />
                <button type="button" class="btn btn-secondary btn-sm" id="upload-image-btn">
                  <i class="fa-solid fa-upload"></i> Upload Image
                </button>
                <p class="form-helper-text" style="margin-top:var(--space-xs);">
                  JPG, PNG or WEBP. Max 2MB.
                </p>
                <span class="form-error-text" id="p-image-err"></span>
              </div>
            </div>
            <input type="hidden" id="p-image-b64" name="image_base64" value="${product?.image_base64 ? '1' : ''}" />
          </div>

          <!-- Stock & Thresholds -->
          <div class="card">
            <div class="card-header">
              <h3 class="card-title">Stock Settings</h3>
            </div>

            ${!isEditing ? `
              <div class="form-group">
                <label class="form-label" for="p-qty">Opening Quantity <span class="required">*</span></label>
                <input class="form-input" type="number" id="p-qty" name="quantity"
                  min="0" step="1" value="0" required />
                <span class="form-helper-text">Initial stock count for this product.</span>
                <span class="form-error-text" id="p-qty-err"></span>
              </div>
            ` : `
              <div class="alert alert-info" style="margin-bottom:var(--space-lg);">
                <i class="fa-solid fa-circle-info"></i>
                Current quantity: <strong>${product?.quantity || 0} ${sanitize(product?.unit || '')}</strong>.
                Use <a href="#/stock/in">Stock In</a> / <a href="#/stock/out">Stock Out</a> to adjust.
              </div>
            `}

            <div class="form-group">
              <label class="form-label" for="p-threshold">Low Stock Threshold <span class="required">*</span></label>
              <input class="form-input" type="number" id="p-threshold" name="low_stock_threshold"
                min="0" step="1" value="${product?.low_stock_threshold ?? defaultThreshold}" required />
              <span class="form-helper-text">Alert when quantity falls to or below this number.</span>
              <span class="form-error-text" id="p-threshold-err"></span>
            </div>

            <!-- Expiry Date -->
            <div class="form-group">
              <div class="toggle-wrap" style="margin-bottom:var(--space-sm);">
                <label class="toggle-switch">
                  <input type="checkbox" id="expiry-toggle" ${product?.expiry_date ? 'checked' : ''} />
                  <span class="toggle-slider"></span>
                </label>
                <span class="toggle-label">Track Expiry Date</span>
              </div>
              <div id="expiry-date-wrap" style="${product?.expiry_date ? '' : 'display:none;'}">
                <input class="form-input" type="date" id="p-expiry" name="expiry_date"
                  value="${product?.expiry_date || ''}" />
                <span class="form-error-text" id="p-expiry-err"></span>
              </div>
            </div>
          </div>

          <!-- Form Actions -->
          <div style="display:flex;gap:var(--space-md);justify-content:flex-end;">
            <a href="#/products" class="btn btn-secondary">Cancel</a>
            <button type="submit" class="btn btn-primary" id="save-product-btn">
              <span class="btn-text">
                <i class="fa-solid fa-${isEditing ? 'floppy-disk' : 'plus'}"></i>
                ${isEditing ? 'Save Changes' : 'Add Product'}
              </span>
              <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
            </button>
          </div>

        </div>
      </div>
    </form>
  `;

  // Bind form events
  bindFormEvents(product, isEditing);
}

// ─── FORM EVENTS ─────────────────────────────────────────────────────────────
function bindFormEvents(product, isEditing) {
  let currentImageB64 = product?.image_base64 || null;

  // SKU generator
  document.getElementById('gen-sku-btn')?.addEventListener('click', () => {
    const catSelect = document.getElementById('p-category');
    const catId     = catSelect?.value;
    const catName   = catId
      ? _state.categories.find(c => String(c.id) === catId)?.name || ''
      : '';
    document.getElementById('p-sku').value = generateSKU(catName);
  });

  // Auto-generate SKU on category change (if SKU empty and not editing)
  if (!isEditing) {
    document.getElementById('p-category')?.addEventListener('change', () => {
      const skuInput = document.getElementById('p-sku');
      if (!skuInput.value) {
        const catId   = document.getElementById('p-category').value;
        const catName = catId ? _state.categories.find(c => String(c.id) === catId)?.name || '' : '';
        skuInput.value = generateSKU(catName);
      }
    });
  }

  // Margin calculator
  const calcMargin = () => {
    const cost = parseFloat(document.getElementById('p-cost')?.value) || 0;
    const sell = parseFloat(document.getElementById('p-sell')?.value) || 0;
    const display = document.getElementById('margin-display');
    if (display) {
      const margin = calculateProfitMargin(cost, sell);
      const profit = sell - cost;
      const currency = window.AppState.settings?.currency_symbol || '₦';
      display.textContent = `${margin.toFixed(1)}% (${formatCurrency(profit, currency)} profit)`;
      display.style.color = margin >= 20 ? 'var(--color-success)'
        : margin >= 10 ? 'var(--color-warning)' : 'var(--color-danger)';
    }
  };
  document.getElementById('p-cost')?.addEventListener('input', calcMargin);
  document.getElementById('p-sell')?.addEventListener('input', calcMargin);
  calcMargin(); // Run on load

  // Custom unit toggle
  document.getElementById('p-unit')?.addEventListener('change', (e) => {
    const wrap = document.getElementById('custom-unit-wrap');
    if (wrap) wrap.style.display = e.target.value === 'custom' ? '' : 'none';
  });

  // Expiry date toggle
  document.getElementById('expiry-toggle')?.addEventListener('change', (e) => {
    const wrap = document.getElementById('expiry-date-wrap');
    if (wrap) wrap.style.display = e.target.checked ? '' : 'none';
    if (!e.target.checked) {
      const input = document.getElementById('p-expiry');
      if (input) input.value = '';
    }
  });

  // Image upload
  const fileInput   = document.getElementById('p-image');
  const uploadBtn   = document.getElementById('upload-image-btn');
  const previewWrap = document.getElementById('image-preview-wrap');
  const imageB64El  = document.getElementById('p-image-b64');
  const imageErrEl  = document.getElementById('p-image-err');

  uploadBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    const validation = validateImageFile(file);
    if (!validation.valid) {
      if (imageErrEl) imageErrEl.textContent = validation.error;
      return;
    }
    if (imageErrEl) imageErrEl.textContent = '';

    try {
      const b64 = await fileToBase64(file);
      currentImageB64 = b64;
      if (imageB64El) imageB64El.value = b64;

      if (previewWrap) {
        previewWrap.innerHTML = `
          <img src="${b64}" alt="Preview" style="width:100%;height:100%;object-fit:cover;" />
          <button type="button" class="image-remove-btn" id="remove-image-btn">
            <i class="fa-solid fa-xmark"></i>
          </button>
        `;
        document.getElementById('remove-image-btn')?.addEventListener('click', removeImage);
      }
    } catch {
      if (imageErrEl) imageErrEl.textContent = 'Failed to read image file.';
    }
  });

  function removeImage() {
    currentImageB64 = null;
    if (imageB64El) imageB64El.value = '';
    if (previewWrap) {
      previewWrap.innerHTML = `
        <div class="image-preview-placeholder" id="image-placeholder">
          <i class="fa-solid fa-image"></i>
          <span>No image</span>
        </div>
      `;
    }
  }

  document.getElementById('remove-image-btn')?.addEventListener('click', removeImage);

  // Inline add category
  document.getElementById('add-cat-inline-btn')?.addEventListener('click', () => {
    showAddCategoryModal(async (newCat) => {
      const select = document.getElementById('p-category');
      if (select) {
        const opt = document.createElement('option');
        opt.value       = newCat.id;
        opt.textContent = newCat.name;
        opt.selected    = true;
        select.appendChild(opt);
        _state.categories.push(newCat);
        // Auto-generate SKU if field is empty
        if (!isEditing) {
          const skuInput = document.getElementById('p-sku');
          if (!skuInput.value) skuInput.value = generateSKU(newCat.name);
        }
      }
    });
  });

  // Form submit
  document.getElementById('product-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const btnText    = document.querySelector('#save-product-btn .btn-text');
    const btnSpinner = document.querySelector('#save-product-btn .btn-spinner');
    btnText?.classList.add('hidden');
    btnSpinner?.classList.remove('hidden');

    try {
      const unitVal    = document.getElementById('p-unit').value;
      const customUnit = document.getElementById('p-unit-custom')?.value.trim();
      const finalUnit  = unitVal === 'custom' ? (customUnit || 'custom') : unitVal;

      const formData = {
        name:                sanitize_input(document.getElementById('p-name').value),
        sku:                 document.getElementById('p-sku').value.trim().toUpperCase(),
        barcode:             document.getElementById('p-barcode').value.trim(),
        description:         document.getElementById('p-desc').value.trim(),
        unit:                finalUnit,
        category_id:         parseInt(document.getElementById('p-category').value) || null,
        supplier_id:         parseInt(document.getElementById('p-supplier').value) || null,
        cost_price:          parseFloat(document.getElementById('p-cost').value) || 0,
        selling_price:       parseFloat(document.getElementById('p-sell').value) || 0,
        low_stock_threshold: parseInt(document.getElementById('p-threshold').value) || 10,
        expiry_date:         document.getElementById('expiry-toggle')?.checked
                               ? document.getElementById('p-expiry').value || null
                               : null,
        image_base64:        currentImageB64
      };

      if (!isEditing) {
        formData.quantity = parseInt(document.getElementById('p-qty').value) || 0;
      }

      // Validate
      const rules = [
        { field: 'name',          type: 'required',    message: 'Product name is required.' },
        { field: 'sku',           type: 'required',    message: 'SKU is required.' },
        { field: 'cost_price',    type: 'nonNegative', message: 'Cost price must be 0 or more.' },
        { field: 'selling_price', type: 'positiveNum', message: 'Selling price must be greater than 0.' }
      ];
      if (!isEditing) {
        rules.push({ field: 'quantity', type: 'nonNegative', message: 'Quantity cannot be negative.' });
      }

      const { isValid, errors } = validate(rules, formData);
      if (!isValid) {
        Object.entries(errors).forEach(([field, msg]) => {
          const errEl = document.getElementById(`p-${field.replace('_', '-')}-err`);
          const inputEl = document.getElementById(`p-${field.replace('_', '-')}`);
          if (errEl) errEl.textContent = msg;
          if (inputEl) inputEl.classList.add('is-invalid');
        });
        return;
      }

      // SKU uniqueness check
      const skuTaken = await skuExists(formData.sku, isEditing ? product.id : null);
      if (skuTaken) {
        const errEl  = document.getElementById('p-sku-err');
        const inputEl = document.getElementById('p-sku');
        if (errEl)  errEl.textContent = 'This SKU is already in use by another product.';
        if (inputEl) inputEl.classList.add('is-invalid');
        return;
      }

      if (isEditing) {
        await updateProduct(product.id, formData);
      } else {
        await createProduct(formData);
      }

    } finally {
      btnText?.classList.remove('hidden');
      btnSpinner?.classList.add('hidden');
    }
  });
}

function sanitize_input(str) {
  return String(str || '').trim();
}

// ─── CREATE PRODUCT ───────────────────────────────────────────────────────────
async function createProduct(data) {
  try {
    const now = new Date().toISOString();
    const id  = await db.products.add({
      ...data,
      is_active:  1,        // ← integer 1, not boolean true
      created_at: now,
      updated_at: now
    });

    if (data.quantity > 0) {
      const user = getSession();
      await db.stock_movements.add({
        product_id:     id,
        user_id:        user?.id || 0,
        type:           'stock_in',
        quantity:       data.quantity,
        reference_note: 'Opening stock',
        created_at:     now
      });
    }

    await writeAuditLog({
      action:      'create',
      entity_type: 'products',
      entity_id:   id,
      new_values:  { ...data, quantity: data.quantity }
    });

    showToast(`"${data.name}" added successfully.`, 'success');
    window.location.hash = '#/products';

  } catch (err) {
    console.error('[Products] Create error:', err);
    showToast('Failed to create product.', 'error');
  }
}

// ─── UPDATE PRODUCT ───────────────────────────────────────────────────────────
async function updateProduct(id, data) {
  try {
    const old = await db.products.get(id);
    const { quantity, ...updateData } = data; // exclude quantity from update

    await db.products.update(id, {
      ...updateData,
      updated_at: new Date().toISOString()
    });

    await writeAuditLog({
      action:      'update',
      entity_type: 'products',
      entity_id:   id,
      old_values:  old,
      new_values:  updateData
    });

    showToast(`"${data.name}" updated successfully.`, 'success');
    window.location.hash = '#/products';

  } catch (err) {
    console.error('[Products] Update error:', err);
    showToast('Failed to update product.', 'error');
  }
}

// ─── EDIT PRODUCT ─────────────────────────────────────────────────────────────
async function renderEditProduct(id) {
  const product = await getProductById(id);
  if (!product) {
    showToast('Product not found.', 'error');
    window.location.hash = '#/products';
    return;
  }
  renderProductForm(product);
}

// ─── PRODUCT DETAIL PAGE ─────────────────────────────────────────────────────
async function renderProductDetail(id) {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `<div class="card"><div class="skeleton skeleton-chart"></div></div>`;

  try {
    const product  = await getProductById(id);
    if (!product) {
      showToast('Product not found.', 'error');
      window.location.hash = '#/products';
      return;
    }

    const [categories, suppliers, movements, saleItems] = await Promise.all([
      db.categories.toArray(),
      db.suppliers.toArray(),
      db.stock_movements.where('product_id').equals(id).reverse().sortBy('created_at'),
      db.sale_items.where('product_id').equals(id).toArray()
    ]);

    const category = categories.find(c => c.id === product.category_id);
    const supplier = suppliers.find(s => s.id === product.supplier_id);
    const currency = window.AppState.settings?.currency_symbol || '₦';
    const margin   = calculateProfitMargin(product.cost_price, product.selling_price);
    const expiry   = expiryStatus(product.expiry_date);
    const user     = getSession();
    const canEdit  = user?.role === 'admin' || user?.role === 'manager';

    const totalRevenue = saleItems.reduce((s, i) => s + i.subtotal, 0);
    const totalSold    = saleItems.reduce((s, i) => s + i.quantity, 0);

    content.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${sanitize(product.name)}</h1>
          <p class="page-subtitle">SKU: <code>${sanitize(product.sku)}</code></p>
        </div>
        <div class="page-actions">
          <a href="#/products" class="btn btn-secondary">
            <i class="fa-solid fa-arrow-left"></i> Back
          </a>
          ${canEdit ? `
            <a href="#/products/${product.id}/edit" class="btn btn-primary">
              <i class="fa-solid fa-pen"></i> Edit Product
            </a>
          ` : ''}
        </div>
      </div>

      <div class="dashboard-grid" style="margin-bottom:var(--space-xl);">

        <!-- Product Info Card -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Product Details</h3>
            ${stockStatusBadge(product.quantity, product.low_stock_threshold, product.expiry_date)}
          </div>
          <div style="display:flex;gap:var(--space-xl);align-items:flex-start;flex-wrap:wrap;">
            <div style="width:120px;height:120px;border-radius:var(--radius-md);overflow:hidden;border:1px solid var(--color-border);flex-shrink:0;">
              ${product.image_base64
                ? `<img src="${product.image_base64}" alt="${sanitize(product.name)}" style="width:100%;height:100%;object-fit:cover;" />`
                : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--color-primary-light);font-size:2rem;font-weight:700;color:var(--color-primary);">
                    ${sanitize(product.name.charAt(0).toUpperCase())}
                  </div>`
              }
            </div>
            <div style="flex:1;min-width:200px;">
              <div class="form-print-row"><span class="form-print-label">Category:</span><span>${sanitize(category?.name || '—')}</span></div>
              <div class="form-print-row"><span class="form-print-label">Supplier:</span><span>${sanitize(supplier?.name || '—')}</span></div>
              <div class="form-print-row"><span class="form-print-label">Unit:</span><span>${sanitize(product.unit || '—')}</span></div>
              <div class="form-print-row"><span class="form-print-label">Barcode:</span><span>${sanitize(product.barcode || '—')}</span></div>
              <div class="form-print-row"><span class="form-print-label">Cost Price:</span><span>${formatCurrency(product.cost_price, currency)}</span></div>
              <div class="form-print-row"><span class="form-print-label">Selling Price:</span><span>${formatCurrency(product.selling_price, currency)}</span></div>
              <div class="form-print-row"><span class="form-print-label">Margin:</span>
                <span style="color:${margin >= 20 ? 'var(--color-success)' : 'var(--color-warning)'};">
                  ${margin.toFixed(1)}%
                </span>
              </div>
              <div class="form-print-row"><span class="form-print-label">Expiry:</span><span class="${expiry.cssClass}">${sanitize(expiry.label)}</span></div>
              <div class="form-print-row"><span class="form-print-label">Low Stock At:</span><span>${product.low_stock_threshold} units</span></div>
              ${product.description ? `<div style="margin-top:var(--space-sm);font-size:var(--text-sm);color:var(--color-text-secondary);">${sanitize(product.description)}</div>` : ''}
            </div>
          </div>
        </div>

        <!-- Stats Card -->
        <div class="card">
          <div class="card-header"><h3 class="card-title">Sales Performance</h3></div>
          <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);gap:var(--space-md);">
            <div class="kpi-card" style="padding:var(--space-lg);">
              <div class="kpi-card-value">${product.quantity.toLocaleString()}</div>
              <div class="kpi-card-label">Current Stock</div>
            </div>
            <div class="kpi-card" style="padding:var(--space-lg);">
              <div class="kpi-card-value">${formatCurrency(product.quantity * product.cost_price, currency)}</div>
              <div class="kpi-card-label">Stock Value</div>
            </div>
            <div class="kpi-card" style="padding:var(--space-lg);">
              <div class="kpi-card-value">${totalSold.toLocaleString()}</div>
              <div class="kpi-card-label">Total Units Sold</div>
            </div>
            <div class="kpi-card" style="padding:var(--space-lg);">
              <div class="kpi-card-value">${formatCurrency(totalRevenue, currency)}</div>
              <div class="kpi-card-label">Total Revenue</div>
            </div>
          </div>
          <div style="margin-top:var(--space-lg);">
            <p class="text-xs text-muted">Added: ${formatDate(product.created_at)} &nbsp;·&nbsp; Last updated: ${formatDate(product.updated_at)}</p>
          </div>
        </div>
      </div>

      <!-- Stock Movements -->
      <div class="card" style="margin-bottom:var(--space-xl);">
        <div class="card-header">
          <h3 class="card-title">Stock Movement History</h3>
          <a href="#/stock/history" class="btn btn-ghost btn-sm">View All</a>
        </div>
        ${movements.length ? `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Type</th><th>Quantity</th><th>Note</th>
                </tr>
              </thead>
              <tbody>
                ${movements.slice(0, 20).map(m => {
                  const { movementTypeBadge, formatMovementQuantity } = window._utils || {};
                  const qtyStr = m.quantity >= 0 ? `+${m.quantity}` : String(m.quantity);
                  const qtyColor = m.type === 'stock_in' ? 'var(--color-success)'
                    : m.type === 'adjustment' ? 'var(--color-info)' : 'var(--color-danger)';
                  return `
                    <tr>
                      <td style="white-space:nowrap;">${formatDateTime(m.created_at)}</td>
                      <td>${renderMovementBadge(m.type)}</td>
                      <td><strong style="color:${qtyColor};">${qtyStr}</strong></td>
                      <td class="text-muted">${sanitize(m.reference_note || '—')}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        ` : renderEmptyState('No stock movements recorded.', 'fa-solid fa-clock-rotate-left')}
      </div>
    `;

  } catch (err) {
    console.error('[Products] Detail error:', err);
    showToast('Failed to load product details.', 'error');
  }
}

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

// ─── INLINE ADD CATEGORY MODAL ────────────────────────────────────────────────
function showAddCategoryModal(onCreated) {
  showModal({
    title: 'Add New Category',
    size:  'sm',
    body: `
      <div class="form-group">
        <label class="form-label" for="new-cat-name">Category Name <span class="required">*</span></label>
        <input class="form-input" type="text" id="new-cat-name" placeholder="e.g. Pharmaceuticals" autofocus />
        <span class="form-error-text" id="new-cat-name-err"></span>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label" for="new-cat-desc">Description</label>
        <textarea class="form-textarea" id="new-cat-desc" rows="2" placeholder="Optional"></textarea>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="cancel-cat-btn">Cancel</button>
      <button class="btn btn-primary" id="save-cat-btn">
        <i class="fa-solid fa-plus"></i> Add Category
      </button>
    `,
    onOpen: () => {
      document.getElementById('cancel-cat-btn')?.addEventListener('click', closeModal);
      document.getElementById('save-cat-btn')?.addEventListener('click', async () => {
        const name = document.getElementById('new-cat-name')?.value.trim();
        const desc = document.getElementById('new-cat-desc')?.value.trim();
        const errEl = document.getElementById('new-cat-name-err');

        if (!name) {
          if (errEl) errEl.textContent = 'Category name is required.';
          return;
        }

        try {
          const id = await db.categories.add({
            name, description: desc, created_at: new Date().toISOString()
          });
          const newCat = { id, name, description: desc };
          closeModal();
          onCreated(newCat);
          showToast(`Category "${name}" added.`, 'success');
        } catch (err) {
          if (errEl) errEl.textContent = 'Failed to create category.';
        }
      });
      document.getElementById('new-cat-name')?.focus();
    }
  });
}

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
async function handleExportCSV() {
  try {
    showSpinner();
    const products   = await getActiveProducts();
    const currency   = window.AppState.settings?.currency_symbol || '';
    const exportData = products.map(p => ({
      SKU:             p.sku,
      Name:            p.name,
      Category:        p.category_name,
      Supplier:        p.supplier_name,
      Unit:            p.unit,
      Cost_Price:      p.cost_price,
      Selling_Price:   p.selling_price,
      Quantity:        p.quantity,
      Low_Stock_Threshold: p.low_stock_threshold,
      Expiry_Date:     p.expiry_date || '',
      Barcode:         p.barcode || '',
      Description:     p.description || ''
    }));

    const date = new Date().toISOString().slice(0, 10);
    exportCSV(exportData, `products-export-${date}`);
    showToast(`Exported ${exportData.length} products.`, 'success');
  } catch (err) {
    console.error('[Products] Export error:', err);
    showToast('Export failed.', 'error');
  } finally {
    hideSpinner();
  }
}

// ─── CSV IMPORT ───────────────────────────────────────────────────────────────
function showImportModal() {
  showModal({
    title: 'Bulk Import Products',
    size:  'lg',
    body: `
      <div class="alert alert-info" style="margin-bottom:var(--space-lg);">
        <i class="fa-solid fa-circle-info"></i>
        Download the template first, fill it in, then upload the completed file.
        Only valid rows will be imported; invalid rows will be skipped.
      </div>
      <div style="display:flex;gap:var(--space-md);margin-bottom:var(--space-lg);">
        <button class="btn btn-secondary" id="download-template-btn">
          <i class="fa-solid fa-download"></i> Download Template
        </button>
        <label class="btn btn-primary" style="cursor:pointer;">
          <i class="fa-solid fa-upload"></i> Upload CSV
          <input type="file" id="csv-import-file" accept=".csv" style="display:none;" />
        </label>
      </div>
      <div id="import-validation-area"></div>
      <div id="import-summary" style="display:none;"></div>
    `,
    footer: `
      <button class="btn btn-secondary" id="cancel-import-btn">Close</button>
      <button class="btn btn-primary hidden" id="confirm-import-btn">
        <i class="fa-solid fa-file-import"></i> Import Valid Rows
      </button>
    `,
    onOpen: () => {
      document.getElementById('cancel-import-btn')?.addEventListener('click', closeModal);
      document.getElementById('download-template-btn')?.addEventListener('click', downloadImportTemplate);
      document.getElementById('csv-import-file')?.addEventListener('change', handleCSVFileSelect);
    }
  });
}

function downloadImportTemplate() {
  const template = [
    {
      name: 'Sample Product', sku: 'GEN-0001', barcode: '',
      category: 'General', supplier: '',
      unit: 'pieces', cost_price: 100, selling_price: 150,
      quantity: 50, low_stock_threshold: 10,
      expiry_date: '', description: 'Sample description'
    }
  ];
  exportCSV(template, 'product-import-template');
  showToast('Template downloaded.', 'success');
}

function handleCSVFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const validationArea = document.getElementById('import-validation-area');
  if (validationArea) {
    validationArea.innerHTML = `
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-text w-75"></div>
    `;
  }

  Papa.parse(file, {
    header:      true,
    skipEmptyLines: true,
    complete:    (results) => processImportData(results.data),
    error:       (err)     => showToast('Failed to parse CSV: ' + err.message, 'error')
  });
}

async function processImportData(rows) {
  const validationArea = document.getElementById('import-validation-area');
  const confirmBtn     = document.getElementById('confirm-import-btn');
  if (!validationArea || !rows.length) return;

  const existingSkus = new Set(
    (await db.products.toArray()).map(p => p.sku.toLowerCase())
  );

  const validRows   = [];
  const reportRows  = [];

  for (let i = 0; i < rows.length; i++) {
    const row    = rows[i];
    const rowNum = i + 2; // +1 for header, +1 for 1-based
    const errors = [];

    const name  = (row.name || '').trim();
    const sku   = (row.sku  || '').trim().toUpperCase();
    const cost  = parseFloat(row.cost_price);
    const sell  = parseFloat(row.selling_price);
    const qty   = parseInt(row.quantity, 10);

    if (!name)            errors.push('Name is required');
    if (!sku)             errors.push('SKU is required');
    if (isNaN(cost) || cost < 0) errors.push('Invalid cost price');
    if (isNaN(sell) || sell <= 0) errors.push('Invalid selling price');
    if (isNaN(qty)  || qty  < 0)  errors.push('Invalid quantity');
    if (sku && existingSkus.has(sku.toLowerCase())) errors.push(`SKU "${sku}" already exists`);

    const isValid = errors.length === 0;

    if (isValid) {
      validRows.push({
        name,
        sku,
        barcode:             (row.barcode || '').trim(),
        description:         (row.description || '').trim(),
        unit:                (row.unit || 'pieces').trim(),
        cost_price:          cost,
        selling_price:       sell,
        quantity:            qty,
        low_stock_threshold: parseInt(row.low_stock_threshold, 10) || 10,
        expiry_date:         (row.expiry_date || '').trim() || null,
        category_name:       (row.category || '').trim(),
        supplier_name:       (row.supplier || '').trim()
      });
    }

    reportRows.push({ rowNum, name: name || '(empty)', sku, isValid, errors });
  }

  // Render validation table
  validationArea.innerHTML = `
    <div class="import-summary" style="display:flex;gap:var(--space-lg);margin-bottom:var(--space-md);">
      <div class="import-summary-item">
        <span class="import-summary-label">Total Rows:</span>
        <span class="font-bold">${rows.length}</span>
      </div>
      <div class="import-summary-item" style="color:var(--color-success);">
        <span class="import-summary-label">Valid:</span>
        <span class="font-bold">${validRows.length}</span>
      </div>
      <div class="import-summary-item" style="color:var(--color-danger);">
        <span class="import-summary-label">Invalid:</span>
        <span class="font-bold">${rows.length - validRows.length}</span>
      </div>
    </div>
    <div class="table-wrapper" style="max-height:280px;overflow-y:auto;">
      <table class="import-validation-table">
        <thead>
          <tr><th>Row</th><th>Name</th><th>SKU</th><th>Status</th><th>Issues</th></tr>
        </thead>
        <tbody>
          ${reportRows.map(r => `
            <tr class="${r.isValid ? 'import-row-valid' : 'import-row-invalid'}">
              <td>${r.rowNum}</td>
              <td>${sanitize(r.name)}</td>
              <td>${sanitize(r.sku)}</td>
              <td>
                ${r.isValid
                  ? `<span class="badge badge-success"><i class="fa-solid fa-check"></i> Valid</span>`
                  : `<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> Error</span>`
                }
              </td>
              <td class="text-xs">${r.errors.map(e => sanitize(e)).join('; ') || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  if (confirmBtn && validRows.length > 0) {
    confirmBtn.classList.remove('hidden');
    confirmBtn.textContent = `Import ${validRows.length} Valid Row${validRows.length !== 1 ? 's' : ''}`;
    confirmBtn.onclick = () => executeImport(validRows);
  }
}

async function executeImport(validRows) {
  try {
    showSpinner();
    const now        = new Date().toISOString();
    const categories = await db.categories.toArray();
    const suppliers  = await db.suppliers.toArray();
    const user       = getSession();

    const catMap = Object.fromEntries(categories.map(c => [c.name.toLowerCase(), c.id]));
    const supMap = Object.fromEntries(suppliers.map(s => [s.name.toLowerCase(), s.id]));

    await db.transaction('rw', [db.products, db.stock_movements, db.audit_logs], async () => {
      for (const row of validRows) {
        const productData = {
          name:                row.name,
          sku:                 row.sku,
          barcode:             row.barcode,
          description:         row.description,
          unit:                row.unit,
          category_id:         catMap[row.category_name?.toLowerCase()] || null,
          supplier_id:         supMap[row.supplier_name?.toLowerCase()] || null,
          cost_price:          row.cost_price,
          selling_price:       row.selling_price,
          quantity:            row.quantity,
          low_stock_threshold: row.low_stock_threshold,
          expiry_date:         row.expiry_date,
          image_base64:        null,
          is_active:           true,
          created_at:          now,
          updated_at:          now
        };

        const id = await db.products.add(productData);

        if (row.quantity > 0) {
          await db.stock_movements.add({
            product_id:     id,
            user_id:        user?.id || 0,
            type:           'stock_in',
            quantity:       row.quantity,
            reference_note: 'CSV Import',
            created_at:     now
          });
        }

        await db.audit_logs.add({
          user_id:           user?.id || 0,
          user_name_snapshot:user?.name || 'System',
          action:            'create',
          entity_type:       'products',
          entity_id:         id,
          old_values:        '{}',
          new_values:        JSON.stringify(productData),
          created_at:        now
        });
      }
    });

    closeModal();
    showToast(`Successfully imported ${validRows.length} products.`, 'success');
    await fetchAndRenderProducts();

  } catch (err) {
    console.error('[Products] Import error:', err);
    showToast('Import failed. Please try again.', 'error');
  } finally {
    hideSpinner();
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export { init, destroy };
