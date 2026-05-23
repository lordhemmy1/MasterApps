/**
 * Stockdity IMS — Categories Module
 * Handles: category list, add, edit, delete with product reassignment.
 */

import db from './db.js';
import { getSession } from './auth.js';
import {
  showToast, showModal, closeModal, showConfirmModal,
  renderEmptyState, sanitize, renderPagination
} from './ui.js';
import {
  formatDate, debounce, filterBySearch,
  sortBy, paginate, validate
} from './utils.js';
import { writeAuditLog } from './audit.js';

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _state = {
  categories:  [],
  filtered:    [],
  page:        1,
  pageSize:    20,
  sortKey:     'name',
  sortDir:     'asc',
  searchTerm:  ''
};
let _destroyed = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  _destroyed = false;
  await renderCategoryList();
}

function destroy() {
  _destroyed = true;
}

// ─── CATEGORY LIST ────────────────────────────────────────────────────────────
async function renderCategoryList() {
  const content = document.getElementById('app-content');
  if (!content) return;

  const user    = getSession();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-tags"></i> Categories</h1>
        <p class="page-subtitle">Organise your products into categories for easy management.</p>
      </div>
      <div class="page-actions">
        ${canEdit ? `
          <button class="btn btn-primary" id="add-category-btn">
            <i class="fa-solid fa-plus"></i> Add Category
          </button>
        ` : ''}
      </div>
    </div>

    <!-- Filter Bar -->
    <div class="filter-bar">
      <div class="filter-search">
        <input
          class="form-input"
          type="search"
          id="cat-search"
          placeholder="Search categories…"
          value="${sanitize(_state.searchTerm)}"
        />
      </div>
      <button class="btn btn-ghost btn-sm" id="cat-clear-btn">
        <i class="fa-solid fa-xmark"></i> Clear
      </button>
    </div>

    <!-- Table -->
    <div class="card" style="padding:0;">
      <div id="categories-table-container"></div>
      <div id="categories-pagination"></div>
    </div>
  `;

  // Bind events
  document.getElementById('add-category-btn')?.addEventListener('click', () => {
    showCategoryModal(null, () => loadAndRender());
  });

  document.getElementById('cat-search')?.addEventListener('input', debounce((e) => {
    _state.searchTerm = e.target.value.trim();
    _state.page = 1;
    renderTable();
  }, 300));

  document.getElementById('cat-clear-btn')?.addEventListener('click', () => {
    _state.searchTerm = '';
    _state.page = 1;
    document.getElementById('cat-search').value = '';
    renderTable();
  });

  // Event delegation on table
  document.getElementById('categories-table-container')?.addEventListener('click', async (e) => {
    const btn    = e.target.closest('[data-action][data-id]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id     = parseInt(btn.dataset.id, 10);

    if (action === 'edit') {
      const cat = _state.categories.find(c => c.id === id);
      if (cat) showCategoryModal(cat, () => loadAndRender());
    }

    if (action === 'delete') {
      await handleDeleteCategory(id);
    }
  });

  await loadAndRender();
}

async function loadAndRender() {
  // Load categories with product counts
  const categories = await db.categories.orderBy('name').toArray();
  const products   = await db.products.where('is_active').equals(1).toArray();

  // Count active products per category
  const countMap = {};
  products.forEach(p => {
    if (p.category_id) {
      countMap[p.category_id] = (countMap[p.category_id] || 0) + 1;
    }
  });

  _state.categories = categories.map(c => ({
    ...c,
    product_count: countMap[c.id] || 0
  }));

  renderTable();
}

function renderTable() {
  const container = document.getElementById('categories-table-container');
  const pagWrap   = document.getElementById('categories-pagination');
  if (!container) return;

  const user    = getSession();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  // Apply search
  const filtered = filterBySearch(
    _state.categories,
    _state.searchTerm,
    ['name', 'description']
  );

  // Sort
  const sorted = sortBy(filtered, _state.sortKey, _state.sortDir);
  _state.filtered = sorted;

  const { data, total } = paginate(sorted, _state.page, _state.pageSize);

  if (!data.length) {
    container.innerHTML = renderEmptyState(
      _state.searchTerm
        ? 'No categories match your search.'
        : 'No categories found. Add your first category!',
      'fa-solid fa-tags',
      canEdit
        ? `<button class="btn btn-primary btn-sm" onclick="document.getElementById('add-category-btn').click()">
             <i class="fa-solid fa-plus"></i> Add Category
           </button>`
        : ''
    );
    if (pagWrap) pagWrap.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th class="sortable ${_state.sortKey === 'name' ? (_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}"
                data-sort="name" style="cursor:pointer;">Name</th>
            <th>Description</th>
            <th class="sortable ${_state.sortKey === 'product_count' ? (_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}"
                data-sort="product_count" style="cursor:pointer;">Products</th>
            <th class="sortable ${_state.sortKey === 'created_at' ? (_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}"
                data-sort="created_at" style="cursor:pointer;">Created</th>
            ${canEdit ? '<th style="width:120px;">Actions</th>' : ''}
          </tr>
        </thead>
        <tbody>
          ${data.map(cat => `
            <tr>
              <td>
                <div style="display:flex;align-items:center;gap:var(--space-sm);">
                  <div style="
                    width:32px;height:32px;border-radius:var(--radius-md);
                    background:var(--color-primary-light);display:flex;
                    align-items:center;justify-content:center;
                    color:var(--color-primary);font-weight:700;font-size:var(--text-sm);
                    flex-shrink:0;
                  ">${sanitize(cat.name.charAt(0).toUpperCase())}</div>
                  <span class="font-semibold">${sanitize(cat.name)}</span>
                </div>
              </td>
              <td class="text-muted">${sanitize(cat.description || '—')}</td>
              <td>
                <span class="badge ${cat.product_count > 0 ? 'badge-primary' : 'badge-neutral'}">
                  ${cat.product_count} product${cat.product_count !== 1 ? 's' : ''}
                </span>
              </td>
              <td class="text-muted">${formatDate(cat.created_at)}</td>
              ${canEdit ? `
                <td>
                  <div class="table-actions">
                    <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${cat.id}" title="Edit">
                      <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn btn-ghost btn-sm text-danger" data-action="delete" data-id="${cat.id}" title="Delete">
                      <i class="fa-solid fa-trash"></i>
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

  // Sortable column headers
  container.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      _state.sortDir = (_state.sortKey === key && _state.sortDir === 'asc') ? 'desc' : 'asc';
      _state.sortKey = key;
      _state.page    = 1;
      renderTable();
    });
  });

  // Pagination
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

// ─── ADD / EDIT MODAL ─────────────────────────────────────────────────────────
function showCategoryModal(category = null, onSaved) {
  const isEditing = !!category;

  showModal({
    title: isEditing ? `Edit Category: ${category.name}` : 'Add New Category',
    body: `
      <form id="category-form" novalidate autocomplete="off">
        <div class="form-group">
          <label class="form-label" for="cat-name">
            Category Name <span class="required">*</span>
          </label>
          <input
            class="form-input"
            type="text"
            id="cat-name"
            name="name"
            value="${sanitize(category?.name || '')}"
            required
            placeholder="e.g. Pharmaceuticals"
            autofocus
          />
          <span class="form-error-text" id="cat-name-err"></span>
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label class="form-label" for="cat-desc">Description</label>
          <textarea
            class="form-textarea"
            id="cat-desc"
            name="description"
            rows="3"
            placeholder="Optional description of this category…"
          >${sanitize(category?.description || '')}</textarea>
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn-secondary" id="cat-cancel-btn">Cancel</button>
      <button class="btn btn-primary" id="cat-save-btn">
        <span class="btn-text">
          <i class="fa-solid fa-${isEditing ? 'floppy-disk' : 'plus'}"></i>
          ${isEditing ? 'Save Changes' : 'Add Category'}
        </span>
        <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
      </button>
    `,
    onOpen: () => {
      document.getElementById('cat-cancel-btn')?.addEventListener('click', closeModal);
      document.getElementById('cat-save-btn')?.addEventListener('click', async () => {
        await handleSaveCategory(isEditing ? category : null, onSaved);
      });

      // Submit on Enter in name field
      document.getElementById('cat-name')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('cat-save-btn')?.click();
        }
      });

      document.getElementById('cat-name')?.focus();
    }
  });
}

async function handleSaveCategory(existingCategory, onSaved) {
  const nameInput  = document.getElementById('cat-name');
  const descInput  = document.getElementById('cat-desc');
  const nameErrEl  = document.getElementById('cat-name-err');
  const btnText    = document.querySelector('#cat-save-btn .btn-text');
  const btnSpinner = document.querySelector('#cat-save-btn .btn-spinner');

  // Clear errors
  if (nameErrEl) nameErrEl.textContent = '';
  if (nameInput) nameInput.classList.remove('is-invalid');

  const name = nameInput?.value.trim() || '';
  const desc = descInput?.value.trim() || '';

  // Validate
  if (!name) {
    if (nameErrEl) nameErrEl.textContent = 'Category name is required.';
    if (nameInput) nameInput.classList.add('is-invalid');
    nameInput?.focus();
    return;
  }

  if (name.length > 100) {
    if (nameErrEl) nameErrEl.textContent = 'Category name must be under 100 characters.';
    if (nameInput) nameInput.classList.add('is-invalid');
    return;
  }

  // Check for duplicate name (excluding current)
  const existing = await db.categories
    .where('name')
    .equalsIgnoreCase(name)
    .first();

  if (existing && (!existingCategory || existing.id !== existingCategory.id)) {
    if (nameErrEl) nameErrEl.textContent = 'A category with this name already exists.';
    if (nameInput) nameInput.classList.add('is-invalid');
    return;
  }

  btnText?.classList.add('hidden');
  btnSpinner?.classList.remove('hidden');

  try {
    if (existingCategory) {
      // Update
      const old = { ...existingCategory };
      await db.categories.update(existingCategory.id, {
        name,
        description: desc
      });

      await writeAuditLog({
        action:      'update',
        entity_type: 'categories',
        entity_id:   existingCategory.id,
        old_values:  old,
        new_values:  { name, description: desc }
      });

      showToast(`Category "${name}" updated successfully.`, 'success');

    } else {
      // Create
      const id = await db.categories.add({
        name,
        description: desc,
        created_at:  new Date().toISOString()
      });

      await writeAuditLog({
        action:      'create',
        entity_type: 'categories',
        entity_id:   id,
        new_values:  { name, description: desc }
      });

      showToast(`Category "${name}" created successfully.`, 'success');
    }

    closeModal();
    if (typeof onSaved === 'function') onSaved();

  } catch (err) {
    console.error('[Categories] Save error:', err);
    showToast('Failed to save category. Please try again.', 'error');
  } finally {
    btnText?.classList.remove('hidden');
    btnSpinner?.classList.add('hidden');
  }
}

// ─── DELETE CATEGORY ──────────────────────────────────────────────────────────
async function handleDeleteCategory(id) {
  const category = _state.categories.find(c => c.id === id);
  if (!category) return;

  // Check how many active products use this category
  const productCount = await db.products
    .where('category_id').equals(id)
    .and(p => p.is_active)
    .count();

  if (productCount > 0) {
    // Has products — show reassignment modal
    showReassignAndDeleteModal(category, productCount);
  } else {
    // No products — simple confirmation
    showConfirmModal({
      title:       'Delete Category',
      message:     `Are you sure you want to delete "${category.name}"? This action cannot be undone.`,
      confirmText: 'Delete',
      confirmClass:'btn-danger',
      onConfirm:   () => executeDeleteCategory(id, null)
    });
  }
}

function showReassignAndDeleteModal(category, productCount) {
  const otherCategories = _state.categories.filter(c => c.id !== category.id);

  showModal({
    title: `Delete Category: ${category.name}`,
    body: `
      <div class="alert alert-warning" style="margin-bottom:var(--space-lg);">
        <i class="fa-solid fa-triangle-exclamation"></i>
        This category has <strong>${productCount} active product${productCount !== 1 ? 's' : ''}</strong>.
        Before deleting, you must reassign these products to another category.
      </div>

      <div class="form-group">
        <label class="form-label" for="reassign-category">
          Reassign products to <span class="required">*</span>
        </label>
        <select class="form-select" id="reassign-category">
          <option value="">-- Select a category --</option>
          ${otherCategories.map(c => `
            <option value="${c.id}">${sanitize(c.name)} (${c.product_count} products)</option>
          `).join('')}
        </select>
        <span class="form-error-text" id="reassign-err"></span>
      </div>

      <p class="text-sm text-muted">
        After reassigning, the category "${sanitize(category.name)}" will be permanently deleted.
      </p>
    `,
    footer: `
      <button class="btn btn-secondary" id="reassign-cancel-btn">Cancel</button>
      <button class="btn btn-danger" id="reassign-confirm-btn">
        <span class="btn-text"><i class="fa-solid fa-trash"></i> Reassign & Delete</span>
        <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
      </button>
    `,
    onOpen: () => {
      document.getElementById('reassign-cancel-btn')?.addEventListener('click', closeModal);
      document.getElementById('reassign-confirm-btn')?.addEventListener('click', async () => {
        const newCategoryId = parseInt(document.getElementById('reassign-category')?.value, 10);
        const errEl         = document.getElementById('reassign-err');
        const btnText       = document.querySelector('#reassign-confirm-btn .btn-text');
        const btnSpinner    = document.querySelector('#reassign-confirm-btn .btn-spinner');

        if (!newCategoryId) {
          if (errEl) errEl.textContent = 'Please select a category to reassign products to.';
          return;
        }

        if (errEl) errEl.textContent = '';
        btnText?.classList.add('hidden');
        btnSpinner?.classList.remove('hidden');

        try {
          await executeDeleteCategory(category.id, newCategoryId);
          closeModal();
        } catch (err) {
          console.error('[Categories] Reassign & delete error:', err);
          showToast('Failed to delete category.', 'error');
          btnText?.classList.remove('hidden');
          btnSpinner?.classList.add('hidden');
        }
      });
    }
  });
}

async function executeDeleteCategory(categoryId, reassignToCategoryId) {
  const category = await db.categories.get(categoryId);
  if (!category) {
    showToast('Category not found.', 'error');
    return;
  }

  await db.transaction('rw', [db.categories, db.products, db.audit_logs], async () => {
    // Reassign products if needed
    if (reassignToCategoryId) {
      const productsToMove = await db.products
        .where('category_id').equals(categoryId)
        .toArray();

      for (const product of productsToMove) {
        await db.products.update(product.id, {
          category_id: reassignToCategoryId,
          updated_at:  new Date().toISOString()
        });
      }
    }

    // Delete the category
    await db.categories.delete(categoryId);

    await db.audit_logs.add({
      user_id:            (await import('./auth.js')).getSession()?.id || 0,
      user_name_snapshot: (await import('./auth.js')).getSession()?.name || 'System',
      action:             'delete',
      entity_type:        'categories',
      entity_id:          categoryId,
      old_values:         JSON.stringify(category),
      new_values:         JSON.stringify({ reassigned_to: reassignToCategoryId }),
      created_at:         new Date().toISOString()
    });
  });

  const movedMsg = reassignToCategoryId
    ? ` Products reassigned to new category.`
    : '';

  showToast(`Category "${category.name}" deleted.${movedMsg}`, 'success');
  await loadAndRender();
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export { init, destroy };
