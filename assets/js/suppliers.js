/**
 * Stockdity IMS — Suppliers Module
 * Handles: supplier list, add, edit, deactivate, supplier profile page.
 */

import db from './db.js';
import { getSession } from './auth.js';
import {
  showToast, showModal, closeModal, showConfirmModal,
  renderEmptyState, renderPagination, activeBadge,
  sanitize
} from './ui.js';
import {
  formatDate, formatDateTime, formatCurrency,
  debounce, filterBySearch, sortBy, paginate,
  validate, validateEmail, validatePhone
} from './utils.js';
import { writeAuditLog } from './audit.js';

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _state = {
  action:    'list',
  suppliers: [],
  filtered:  [],
  page:      1,
  pageSize:  20,
  sortKey:   'name',
  sortDir:   'asc',
  searchTerm:''
};
let _destroyed = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init(params = {}) {
  _destroyed    = false;
  _state.action = params.action || 'list';

  const content = document.getElementById('app-content');
  if (!content) return;

  if (_state.action === 'detail' && params.id) {
    await renderSupplierProfile(params.id);
  } else {
    await renderSupplierList();
  }
}

function destroy() {
  _destroyed = true;
}

// ─── SUPPLIER LIST ────────────────────────────────────────────────────────────
async function renderSupplierList() {
  const content = document.getElementById('app-content');
  if (!content) return;

  const user    = getSession();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-truck"></i> Suppliers</h1>
        <p class="page-subtitle">Manage your product suppliers and their contact information.</p>
      </div>
      <div class="page-actions">
        ${canEdit ? `
          <button class="btn btn-primary" id="add-supplier-btn">
            <i class="fa-solid fa-plus"></i> Add Supplier
          </button>
        ` : ''}
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-search">
        <input class="form-input" type="search" id="sup-search"
          placeholder="Search by name, contact, email…"
          value="${sanitize(_state.searchTerm)}" />
      </div>
      <button class="btn btn-ghost btn-sm" id="sup-clear-btn">
        <i class="fa-solid fa-xmark"></i> Clear
      </button>
    </div>

    <div class="card" style="padding:0;">
      <div id="suppliers-table-container"></div>
      <div id="suppliers-pagination"></div>
    </div>
  `;

  document.getElementById('add-supplier-btn')?.addEventListener('click', () => {
    showSupplierModal(null, loadAndRender);
  });

  document.getElementById('sup-search')?.addEventListener('input', debounce((e) => {
    _state.searchTerm = e.target.value.trim();
    _state.page = 1;
    renderTable();
  }, 300));

  document.getElementById('sup-clear-btn')?.addEventListener('click', () => {
    _state.searchTerm = '';
    _state.page = 1;
    document.getElementById('sup-search').value = '';
    renderTable();
  });

  document.getElementById('suppliers-table-container')?.addEventListener('click', async (e) => {
    const btn    = e.target.closest('[data-action][data-id]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id     = parseInt(btn.dataset.id, 10);

    if (action === 'edit') {
      const sup = _state.suppliers.find(s => s.id === id);
      if (sup) showSupplierModal(sup, loadAndRender);
    }
    if (action === 'toggle-active') {
      await toggleSupplierActive(id);
    }
  });

  await loadAndRender();
}

async function loadAndRender() {
  // Load suppliers with product counts
  const [suppliers, products] = await Promise.all([
    db.suppliers.orderBy('name').toArray(),
    db.products.where('is_active').equals(1).toArray()
  ]);

  const productCountMap = {};
  products.forEach(p => {
    if (p.supplier_id) {
      productCountMap[p.supplier_id] = (productCountMap[p.supplier_id] || 0) + 1;
    }
  });

  _state.suppliers = suppliers.map(s => ({
    ...s,
    product_count: productCountMap[s.id] || 0
  }));

  renderTable();
}

function renderTable() {
  const container = document.getElementById('suppliers-table-container');
  const pagWrap   = document.getElementById('suppliers-pagination');
  if (!container) return;

  const user    = getSession();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  const filtered = filterBySearch(
    _state.suppliers,
    _state.searchTerm,
    ['name', 'contact_person', 'email', 'phone']
  );

  const sorted = sortBy(filtered, _state.sortKey, _state.sortDir);
  _state.filtered = sorted;

  const { data, total } = paginate(sorted, _state.page, _state.pageSize);

  if (!data.length) {
    container.innerHTML = renderEmptyState(
      _state.searchTerm ? 'No suppliers match your search.' : 'No suppliers found.',
      'fa-solid fa-truck',
      canEdit ? `<button class="btn btn-primary btn-sm" id="empty-add-sup-btn">
        <i class="fa-solid fa-plus"></i> Add Supplier
      </button>` : ''
    );
    if (pagWrap) pagWrap.innerHTML = '';

    document.getElementById('empty-add-sup-btn')?.addEventListener('click', () => {
      showSupplierModal(null, loadAndRender);
    });
    return;
  }

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th data-sort="name" class="sortable ${_state.sortKey === 'name' ? (_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}" style="cursor:pointer;">
              Supplier Name
            </th>
            <th>Contact Person</th>
            <th>Phone</th>
            <th>Email</th>
            <th data-sort="product_count" class="sortable ${_state.sortKey === 'product_count' ? (_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}" style="cursor:pointer;">
              Products
            </th>
            <th>Status</th>
            ${canEdit ? '<th style="width:120px;">Actions</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${data.map(sup => `
            <tr>
              <td>
                <a href="#/suppliers/${sup.id}" class="font-semibold" style="color:var(--color-primary);">
                  ${sanitize(sup.name)}
                </a>
              </td>
              <td>${sanitize(sup.contact_person || '—')}</td>
              <td>${sanitize(sup.phone || '—')}</td>
              <td>
                ${sup.email
                  ? `<a href="mailto:${sanitize(sup.email)}">${sanitize(sup.email)}</a>`
                  : '—'}
              </td>
              <td>
                <span class="badge ${sup.product_count > 0 ? 'badge-primary' : 'badge-neutral'}">
                  ${sup.product_count} product${sup.product_count !== 1 ? 's' : ''}
                </span>
              </td>
              <td>${activeBadge(sup.is_active)}</td>
              ${canEdit ? `
                <td>
                  <div class="table-actions">
                    <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${sup.id}" title="Edit">
                      <i class="fa-solid fa-pen"></i>
                    </button>
                    <button
                      class="btn btn-ghost btn-sm ${sup.is_active ? 'text-danger' : 'text-success'}"
                      data-action="toggle-active" data-id="${sup.id}"
                      title="${sup.is_active ? 'Deactivate' : 'Activate'}"
                    >
                      <i class="fa-solid fa-${sup.is_active ? 'ban' : 'circle-check'}"></i>
                    </button>
                  </div>
                </td>
              ` : ''}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  // Sortable headers
  container.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      _state.sortDir = (_state.sortKey === key && _state.sortDir === 'asc') ? 'desc' : 'asc';
      _state.sortKey = key;
      _state.page    = 1;
      renderTable();
    });
  });

  if (pagWrap) {
    renderPagination(pagWrap, {
      total,
      page:         _state.page,
      pageSize:     _state.pageSize,
      onPageChange: (p) => { _state.page = p; renderTable(); },
      onSizeChange: (s) => { _state.pageSize = s; _state.page = 1; renderTable(); }
    });
  }
}

// ─── TOGGLE ACTIVE ────────────────────────────────────────────────────────────
async function toggleSupplierActive(id) {
  const supplier = _state.suppliers.find(s => s.id === id);
  if (!supplier) return;

  const newState = !supplier.is_active;
  const verb     = newState ? 'activate' : 'deactivate';

  showConfirmModal({
    title:       `${newState ? 'Activate' : 'Deactivate'} Supplier`,
    message:     `Are you sure you want to ${verb} "${supplier.name}"?`,
    confirmText: newState ? 'Activate' : 'Deactivate',
    confirmClass:newState ? 'btn-success' : 'btn-warning',
    onConfirm:   async () => {
      try {
        await db.suppliers.update(id, { is_active: newState ? 1 : 0 });
        await writeAuditLog({
          action:      'update',
          entity_type: 'suppliers',
          entity_id:   id,
          old_values:  { is_active: supplier.is_active },
          new_values:  { is_active: newState ? 1 : 0 }
        });
        showToast(`Supplier "${supplier.name}" ${verb}d.`, 'success');
        await loadAndRender();
      } catch (err) {
        console.error('[Suppliers] Toggle error:', err);
        showToast(`Failed to ${verb} supplier.`, 'error');
      }
    }
  });
}

// ─── ADD / EDIT MODAL ─────────────────────────────────────────────────────────
function showSupplierModal(supplier = null, onSaved) {
  const isEditing = !!supplier;

  showModal({
    title: isEditing ? `Edit Supplier: ${supplier.name}` : 'Add New Supplier',
    size:  'lg',
    body: `
      <form id="supplier-form" novalidate autocomplete="off">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="sup-name">Supplier Name <span class="required">*</span></label>
            <input class="form-input" type="text" id="sup-name" name="name"
              value="${sanitize(supplier?.name || '')}"
              placeholder="e.g. MedBridge Pharmaceuticals" required autofocus />
            <span class="form-error-text" id="sup-name-err"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="sup-contact">Contact Person</label>
            <input class="form-input" type="text" id="sup-contact" name="contact_person"
              value="${sanitize(supplier?.contact_person || '')}"
              placeholder="e.g. John Smith" />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="sup-phone">Phone Number</label>
            <input class="form-input" type="tel" id="sup-phone" name="phone"
              value="${sanitize(supplier?.phone || '')}"
              placeholder="e.g. +234 801 234 5678" />
            <span class="form-error-text" id="sup-phone-err"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="sup-email">Email Address</label>
            <input class="form-input" type="email" id="sup-email" name="email"
              value="${sanitize(supplier?.email || '')}"
              placeholder="e.g. supply@medbridge.com" />
            <span class="form-error-text" id="sup-email-err"></span>
          </div>
        </div>

        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" for="sup-address">Address</label>
          <textarea class="form-textarea" id="sup-address" name="address" rows="3"
            placeholder="Full supplier address…"
          >${sanitize(supplier?.address || '')}</textarea>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn-secondary" id="sup-cancel-btn">Cancel</button>
      <button class="btn btn-primary" id="sup-save-btn">
        <span class="btn-text">
          <i class="fa-solid fa-${isEditing ? 'floppy-disk' : 'plus'}"></i>
          ${isEditing ? 'Save Changes' : 'Add Supplier'}
        </span>
        <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
      </button>
    `,
    onOpen: () => {
      document.getElementById('sup-cancel-btn')?.addEventListener('click', closeModal);
      document.getElementById('sup-save-btn')?.addEventListener('click', async () => {
        await handleSaveSupplier(isEditing ? supplier : null, onSaved);
      });
    }
  });
}

async function handleSaveSupplier(existingSupplier, onSaved) {
  const nameInput  = document.getElementById('sup-name');
  const phoneInput = document.getElementById('sup-phone');
  const emailInput = document.getElementById('sup-email');
  const btnText    = document.querySelector('#sup-save-btn .btn-text');
  const btnSpinner = document.querySelector('#sup-save-btn .btn-spinner');

  // Clear errors
  ['sup-name-err', 'sup-phone-err', 'sup-email-err'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  });
  [nameInput, phoneInput, emailInput].forEach(el => el?.classList.remove('is-invalid'));

  const formData = {
    name:           nameInput?.value.trim()                             || '',
    contact_person: document.getElementById('sup-contact')?.value.trim() || '',
    phone:          phoneInput?.value.trim()                            || '',
    email:          emailInput?.value.trim().toLowerCase()              || '',
    address:        document.getElementById('sup-address')?.value.trim() || ''
  };

  // Validate
  let hasError = false;

  if (!formData.name) {
    document.getElementById('sup-name-err').textContent = 'Supplier name is required.';
    nameInput?.classList.add('is-invalid');
    hasError = true;
  }

  if (formData.phone && !validatePhone(formData.phone)) {
    document.getElementById('sup-phone-err').textContent = 'Please enter a valid phone number.';
    phoneInput?.classList.add('is-invalid');
    hasError = true;
  }

  if (formData.email && !validateEmail(formData.email)) {
    document.getElementById('sup-email-err').textContent = 'Please enter a valid email address.';
    emailInput?.classList.add('is-invalid');
    hasError = true;
  }

  if (hasError) return;

  btnText?.classList.add('hidden');
  btnSpinner?.classList.remove('hidden');

  try {
    if (existingSupplier) {
      await db.suppliers.update(existingSupplier.id, formData);
      await writeAuditLog({
        action:      'update',
        entity_type: 'suppliers',
        entity_id:   existingSupplier.id,
        old_values:  existingSupplier,
        new_values:  formData
      });
      showToast(`Supplier "${formData.name}" updated.`, 'success');
    } else {
      const id = await db.suppliers.add({
        ...formData,
        is_active:  1,
        created_at: new Date().toISOString()
      });
      await writeAuditLog({
        action:      'create',
        entity_type: 'suppliers',
        entity_id:   id,
        new_values:  formData
      });
      showToast(`Supplier "${formData.name}" added.`, 'success');
    }

    closeModal();
    if (typeof onSaved === 'function') onSaved();

  } catch (err) {
    console.error('[Suppliers] Save error:', err);
    showToast('Failed to save supplier.', 'error');
  } finally {
    btnText?.classList.remove('hidden');
    btnSpinner?.classList.add('hidden');
  }
}

// ─── SUPPLIER PROFILE PAGE ────────────────────────────────────────────────────
async function renderSupplierProfile(id) {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `<div class="card"><div class="skeleton skeleton-chart"></div></div>`;

  try {
    const supplier = await db.suppliers.get(Number(id));
    if (!supplier) {
      showToast('Supplier not found.', 'error');
      window.location.hash = '#/suppliers';
      return;
    }

    const currency  = window.AppState.settings?.currency_symbol || '₦';
    const user      = getSession();
    const canEdit   = user?.role === 'admin' || user?.role === 'manager';

    // Load all stock-in movements via this supplier's products
    const products  = await db.products
      .where('supplier_id').equals(supplier.id)
      .toArray();

    const productIds = products.map(p => p.id);

    const stockInMovements = productIds.length
      ? await db.stock_movements
          .where('product_id').anyOf(productIds)
          .and(m => m.type === 'stock_in')
          .toArray()
      : [];

    // Aggregate totals
    const totalUnits = stockInMovements.reduce((s, m) => s + Math.abs(m.quantity), 0);

    // Estimate cost value using current product cost_price
    const productCostMap = Object.fromEntries(products.map(p => [p.id, p.cost_price]));
    const totalCostValue = stockInMovements.reduce(
      (s, m) => s + (Math.abs(m.quantity) * (productCostMap[m.product_id] || 0)), 0
    );

    // Get product map for movement table
    const productNameMap = Object.fromEntries(products.map(p => [p.id, p.name]));

    // Users map for movement table
    const users    = await db.users.toArray();
    const userMap  = Object.fromEntries(users.map(u => [u.id, u.name]));

    content.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">${sanitize(supplier.name)}</h1>
          <p class="page-subtitle">Supplier Profile &nbsp;·&nbsp; ${activeBadge(supplier.is_active)}</p>
        </div>
        <div class="page-actions">
          <a href="#/suppliers" class="btn btn-secondary">
            <i class="fa-solid fa-arrow-left"></i> Back
          </a>
          ${canEdit ? `
            <button class="btn btn-primary" id="edit-supplier-btn">
              <i class="fa-solid fa-pen"></i> Edit
            </button>
            <button class="btn ${supplier.is_active ? 'btn-warning' : 'btn-success'}" id="toggle-sup-btn">
              <i class="fa-solid fa-${supplier.is_active ? 'ban' : 'circle-check'}"></i>
              ${supplier.is_active ? 'Deactivate' : 'Activate'}
            </button>
          ` : ''}
        </div>
      </div>

      <div class="dashboard-grid" style="margin-bottom:var(--space-xl);">

        <!-- Contact Card -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Contact Information</h3>
          </div>
          <div class="form-print-row">
            <span class="form-print-label">Company:</span>
            <span class="font-semibold">${sanitize(supplier.name)}</span>
          </div>
          <div class="form-print-row">
            <span class="form-print-label">Contact Person:</span>
            <span>${sanitize(supplier.contact_person || '—')}</span>
          </div>
          <div class="form-print-row">
            <span class="form-print-label">Phone:</span>
            <span>
              ${supplier.phone
                ? `<a href="tel:${sanitize(supplier.phone)}">${sanitize(supplier.phone)}</a>`
                : '—'}
            </span>
          </div>
          <div class="form-print-row">
            <span class="form-print-label">Email:</span>
            <span>
              ${supplier.email
                ? `<a href="mailto:${sanitize(supplier.email)}">${sanitize(supplier.email)}</a>`
                : '—'}
            </span>
          </div>
          <div class="form-print-row">
            <span class="form-print-label">Address:</span>
            <span>${sanitize(supplier.address || '—')}</span>
          </div>
          <div class="form-print-row">
            <span class="form-print-label">Added:</span>
            <span class="text-muted">${formatDate(supplier.created_at)}</span>
          </div>
        </div>

        <!-- Stats Card -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Supply Statistics</h3>
          </div>
          <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);gap:var(--space-md);">
            <div class="kpi-card" style="padding:var(--space-lg);">
              <div class="kpi-card-value">${products.length}</div>
              <div class="kpi-card-label">Products Linked</div>
            </div>
            <div class="kpi-card" style="padding:var(--space-lg);">
              <div class="kpi-card-value">${stockInMovements.length}</div>
              <div class="kpi-card-label">Stock Deliveries</div>
            </div>
            <div class="kpi-card" style="padding:var(--space-lg);">
              <div class="kpi-card-value">${totalUnits.toLocaleString()}</div>
              <div class="kpi-card-label">Total Units Supplied</div>
            </div>
            <div class="kpi-card" style="padding:var(--space-lg);">
              <div class="kpi-card-value">${formatCurrency(totalCostValue, currency)}</div>
              <div class="kpi-card-label">Est. Cost Value</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Products Linked -->
      <div class="card" style="margin-bottom:var(--space-xl);">
        <div class="card-header">
          <h3 class="card-title">Products Supplied</h3>
          <a href="#/products?supplier=${supplier.id}" class="btn btn-ghost btn-sm">View All</a>
        </div>
        ${products.length ? `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr><th>Product</th><th>SKU</th><th>Current Stock</th><th>Unit</th></tr>
              </thead>
              <tbody>
                ${products.slice(0, 10).map(p => `
                  <tr>
                    <td>
                      <a href="#/products/${p.id}" style="color:var(--color-primary);">
                        ${sanitize(p.name)}
                      </a>
                    </td>
                    <td><code style="font-size:var(--text-xs);background:var(--color-surface-2);padding:2px 6px;border-radius:4px;">${sanitize(p.sku)}</code></td>
                    <td>${p.quantity.toLocaleString()}</td>
                    <td class="text-muted">${sanitize(p.unit || '—')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : renderEmptyState('No products linked to this supplier.', 'fa-solid fa-boxes-stacked')}
      </div>

      <!-- Supply History -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title">Supply History</h3>
        </div>
        ${stockInMovements.length ? `
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Product</th>
                  <th>Units Received</th>
                  <th>Est. Value</th>
                  <th>Reference</th>
                  <th>Recorded By</th>
                </tr>
              </thead>
              <tbody>
                ${stockInMovements
                  .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                  .slice(0, 30)
                  .map(m => {
                    const units = Math.abs(m.quantity);
                    const cost  = productCostMap[m.product_id] || 0;
                    return `
                      <tr>
                        <td style="white-space:nowrap;">${formatDateTime(m.created_at)}</td>
                        <td>${sanitize(productNameMap[m.product_id] || `Product #${m.product_id}`)}</td>
                        <td><strong class="text-success">+${units}</strong></td>
                        <td>${formatCurrency(units * cost, currency)}</td>
                        <td class="text-muted">${sanitize(m.reference_note || '—')}</td>
                        <td>${sanitize(userMap[m.user_id] || 'System')}</td>
                      </tr>
                    `;
                  }).join('')}
              </tbody>
            </table>
          </div>
        ` : renderEmptyState('No supply history found.', 'fa-solid fa-truck')}
      </div>
    `;

    // Bind action buttons
    document.getElementById('edit-supplier-btn')?.addEventListener('click', () => {
      showSupplierModal(supplier, () => renderSupplierProfile(id));
    });

    document.getElementById('toggle-sup-btn')?.addEventListener('click', () => {
      const newState = !supplier.is_active;
      showConfirmModal({
        title:       newState ? 'Activate Supplier' : 'Deactivate Supplier',
        message:     `Are you sure you want to ${newState ? 'activate' : 'deactivate'} "${supplier.name}"?`,
        confirmText: newState ? 'Activate' : 'Deactivate',
        confirmClass:newState ? 'btn-success' : 'btn-warning',
        onConfirm:   async () => {
          try {
            await db.suppliers.update(id, { is_active: newState ? 1 : 0 });
            await writeAuditLog({
              action:      'update',
              entity_type: 'suppliers',
              entity_id:   id,
              old_values:  { is_active: supplier.is_active },
              new_values:  { is_active: newState ? 1 : 0 }
            });
            showToast(`Supplier "${supplier.name}" ${newState ? 'activated' : 'deactivated'}.`, 'success');
            renderSupplierProfile(id);
          } catch (err) {
            console.error('[Suppliers] Toggle error:', err);
            showToast('Failed to update supplier.', 'error');
          }
        }
      });
    });

  } catch (err) {
    console.error('[Suppliers] Profile error:', err);
    showToast('Failed to load supplier profile.', 'error');
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export { init, destroy };
