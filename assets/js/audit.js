/**
 * Stockdity IMS — Audit Log Module
 * Provides: writeAuditLog() helper used by all modules,
 * and the audit log viewer page for admin users.
 */

import db from './db.js';
import { getSession } from './auth.js';
import {
  showToast, renderEmptyState, renderPagination,
  sanitize
} from './ui.js';
import {
  formatDateTime, debounce, filterBySearch,
  sortBy, paginate, exportCSV
} from './utils.js';

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _state = {
  logs:       [],
  filtered:   [],
  page:       1,
  pageSize:   20,
  sortKey:    'created_at',
  sortDir:    'desc',
  searchTerm: '',
  filters:    { action: '', entity_type: '', dateFrom: '', dateTo: '' }
};
let _destroyed = false;

// ─── AUDIT LOG WRITER ─────────────────────────────────────────────────────────
/**
 * Write an entry to the audit_logs table.
 * This is the canonical helper used by all modules.
 * Failures are caught and logged non-fatally.
 *
 * @param {Object} entry
 * @param {string}  entry.action       - 'create'|'update'|'delete'|'login'|'logout'|'void'
 * @param {string}  entry.entity_type  - e.g. 'products', 'sales', 'users'
 * @param {number}  [entry.entity_id]
 * @param {Object}  [entry.old_values]
 * @param {Object}  [entry.new_values]
 * @returns {Promise<number|null>}     New log ID, or null on failure
 */
async function writeAuditLog(entry) {
  try {
    const user = getSession();

    return await db.audit_logs.add({
      user_id:           user?.id           || 0,
      user_name_snapshot:user?.name         || 'System',
      action:            entry.action       || 'update',
      entity_type:       entry.entity_type  || '',
      entity_id:         entry.entity_id    || 0,
      old_values:        entry.old_values
                           ? JSON.stringify(entry.old_values)
                           : '{}',
      new_values:        entry.new_values
                           ? JSON.stringify(entry.new_values)
                           : '{}',
      created_at:        new Date().toISOString()
    });

  } catch (err) {
    // Audit log failures must never crash the main operation
    console.error('[Audit] Failed to write audit log:', err);
    return null;
  }
}

// ─── INIT (Audit Log Viewer Page) ─────────────────────────────────────────────
async function init() {
  _destroyed = false;
  await renderAuditLogPage();
}

function destroy() {
  _destroyed = true;
}

// ─── AUDIT LOG PAGE ───────────────────────────────────────────────────────────
async function renderAuditLogPage() {
  const content = document.getElementById('app-content');
  if (!content) return;

  const user = getSession();
  if (user?.role !== 'admin') {
    content.innerHTML = `
      <div class="unauthorized-page">
        <div class="unauthorized-code">403</div>
        <h2 class="unauthorized-title">Access Denied</h2>
        <p class="unauthorized-text">The audit log is only accessible by administrators.</p>
        <a href="#/dashboard" class="btn btn-primary">Back to Dashboard</a>
      </div>
    `;
    return;
  }

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-file-shield"></i> Audit Log</h1>
        <p class="page-subtitle">Complete record of all significant actions performed in the system.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="export-audit-btn">
          <i class="fa-solid fa-file-csv"></i> Export CSV
        </button>
      </div>
    </div>

    <!-- Filters -->
    <div class="filter-bar">
      <div class="filter-search">
        <input class="form-input" type="search" id="audit-search"
          placeholder="Search by user, entity type…"
          value="${sanitize(_state.searchTerm)}" />
      </div>
      <select class="form-select" id="audit-filter-action" style="width:150px;">
        <option value="">All Actions</option>
        <option value="create"  ${_state.filters.action === 'create'  ? 'selected':''}>Create</option>
        <option value="update"  ${_state.filters.action === 'update'  ? 'selected':''}>Update</option>
        <option value="delete"  ${_state.filters.action === 'delete'  ? 'selected':''}>Delete</option>
        <option value="login"   ${_state.filters.action === 'login'   ? 'selected':''}>Login</option>
        <option value="logout"  ${_state.filters.action === 'logout'  ? 'selected':''}>Logout</option>
        <option value="void"    ${_state.filters.action === 'void'    ? 'selected':''}>Void</option>
      </select>
      <select class="form-select" id="audit-filter-entity" style="width:160px;">
        <option value="">All Entities</option>
        <option value="products"   ${_state.filters.entity_type === 'products'   ? 'selected':''}>Products</option>
        <option value="sales"      ${_state.filters.entity_type === 'sales'      ? 'selected':''}>Sales</option>
        <option value="users"      ${_state.filters.entity_type === 'users'      ? 'selected':''}>Users</option>
        <option value="categories" ${_state.filters.entity_type === 'categories' ? 'selected':''}>Categories</option>
        <option value="suppliers"  ${_state.filters.entity_type === 'suppliers'  ? 'selected':''}>Suppliers</option>
      </select>
      <input class="form-input" type="date" id="audit-date-from"
        value="${sanitize(_state.filters.dateFrom)}" style="width:150px;" />
      <input class="form-input" type="date" id="audit-date-to"
        value="${sanitize(_state.filters.dateTo)}" style="width:150px;" />
      <button class="btn btn-ghost btn-sm" id="audit-clear-btn">
        <i class="fa-solid fa-xmark"></i> Clear
      </button>
    </div>

    <!-- Table -->
    <div class="card" style="padding:0;">
      <div id="audit-table-container"></div>
      <div id="audit-pagination"></div>
    </div>
  `;

  // Load logs
  _state.logs = await db.audit_logs
    .orderBy('created_at')
    .reverse()
    .toArray();

  // Bind filter events
  document.getElementById('audit-search')?.addEventListener('input', debounce((e) => {
    _state.searchTerm = e.target.value.trim();
    _state.page = 1;
    applyFiltersAndRender();
  }, 300));

  document.getElementById('audit-filter-action')?.addEventListener('change', (e) => {
    _state.filters.action = e.target.value;
    _state.page = 1;
    applyFiltersAndRender();
  });

  document.getElementById('audit-filter-entity')?.addEventListener('change', (e) => {
    _state.filters.entity_type = e.target.value;
    _state.page = 1;
    applyFiltersAndRender();
  });

  document.getElementById('audit-date-from')?.addEventListener('change', (e) => {
    _state.filters.dateFrom = e.target.value;
    _state.page = 1;
    applyFiltersAndRender();
  });

  document.getElementById('audit-date-to')?.addEventListener('change', (e) => {
    _state.filters.dateTo = e.target.value;
    _state.page = 1;
    applyFiltersAndRender();
  });

  document.getElementById('audit-clear-btn')?.addEventListener('click', () => {
    _state.searchTerm = '';
    _state.filters    = { action: '', entity_type: '', dateFrom: '', dateTo: '' };
    _state.page       = 1;
    document.getElementById('audit-search').value          = '';
    document.getElementById('audit-filter-action').value   = '';
    document.getElementById('audit-filter-entity').value   = '';
    document.getElementById('audit-date-from').value       = '';
    document.getElementById('audit-date-to').value         = '';
    applyFiltersAndRender();
  });

  document.getElementById('export-audit-btn')?.addEventListener('click', handleExport);

  // Detail view delegation
  document.getElementById('audit-table-container')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="view-detail"][data-id]');
    if (!btn) return;
    const id  = parseInt(btn.dataset.id, 10);
    const log = _state.logs.find(l => l.id === id);
    if (log) showAuditDetail(log);
  });

  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  let filtered = [..._state.logs];

  // Text search
  if (_state.searchTerm) {
    const term = _state.searchTerm.toLowerCase();
    filtered = filtered.filter(l =>
      (l.user_name_snapshot || '').toLowerCase().includes(term) ||
      (l.entity_type        || '').toLowerCase().includes(term) ||
      (l.action             || '').toLowerCase().includes(term)
    );
  }

  // Action filter
  if (_state.filters.action) {
    filtered = filtered.filter(l => l.action === _state.filters.action);
  }

  // Entity type filter
  if (_state.filters.entity_type) {
    filtered = filtered.filter(l => l.entity_type === _state.filters.entity_type);
  }

  // Date from
  if (_state.filters.dateFrom) {
    const from = new Date(_state.filters.dateFrom);
    from.setHours(0, 0, 0, 0);
    filtered = filtered.filter(l => new Date(l.created_at) >= from);
  }

  // Date to
  if (_state.filters.dateTo) {
    const to = new Date(_state.filters.dateTo);
    to.setHours(23, 59, 59, 999);
    filtered = filtered.filter(l => new Date(l.created_at) <= to);
  }

  _state.filtered = filtered;
  renderAuditTable();
}

function renderAuditTable() {
  const container = document.getElementById('audit-table-container');
  const pagWrap   = document.getElementById('audit-pagination');
  if (!container) return;

  const { data, total } = paginate(_state.filtered, _state.page, _state.pageSize);

  if (!data.length) {
    container.innerHTML = renderEmptyState(
      'No audit log entries found.',
      'fa-solid fa-file-shield'
    );
    if (pagWrap) pagWrap.innerHTML = '';
    return;
  }

  const actionConfig = {
    create: { cls: 'badge-success', icon: 'fa-plus',           label: 'Create'  },
    update: { cls: 'badge-info',    icon: 'fa-pen',            label: 'Update'  },
    delete: { cls: 'badge-danger',  icon: 'fa-trash',          label: 'Delete'  },
    login:  { cls: 'badge-primary', icon: 'fa-right-to-bracket',label: 'Login'  },
    logout: { cls: 'badge-neutral', icon: 'fa-right-from-bracket',label:'Logout'},
    void:   { cls: 'badge-warning', icon: 'fa-ban',            label: 'Void'    }
  };

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Date & Time</th>
            <th>User</th>
            <th>Action</th>
            <th>Entity</th>
            <th>Entity ID</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(log => {
            const config = actionConfig[log.action] || {
              cls: 'badge-neutral', icon: 'fa-circle', label: log.action
            };
            const entityLabel = log.entity_type
              ? log.entity_type.charAt(0).toUpperCase() + log.entity_type.slice(1)
              : '—';

            return `
              <tr>
                <td class="text-muted text-xs">${log.id}</td>
                <td style="white-space:nowrap;">${formatDateTime(log.created_at)}</td>
                <td>
                  <div class="font-semibold text-sm">${sanitize(log.user_name_snapshot || 'System')}</div>
                </td>
                <td>
                  <span class="badge ${config.cls}">
                    <i class="fa-solid ${config.icon}"></i> ${sanitize(config.label)}
                  </span>
                </td>
                <td>${sanitize(entityLabel)}</td>
                <td class="text-muted">${log.entity_id || '—'}</td>
                <td>
                  <button class="btn btn-ghost btn-sm" data-action="view-detail" data-id="${log.id}">
                    <i class="fa-solid fa-eye"></i> View
                  </button>
                </td>
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
      page:         _state.page,
      pageSize:     _state.pageSize,
      onPageChange: (p) => { _state.page = p; renderAuditTable(); },
      onSizeChange: (s) => { _state.pageSize = s; _state.page = 1; renderAuditTable(); }
    });
  }
}

// ─── AUDIT DETAIL MODAL ───────────────────────────────────────────────────────
function showAuditDetail(log) {
  const { showModal, closeModal } = window._uiHelpers || {};

  let oldVals = {};
  let newVals = {};

  try { oldVals = JSON.parse(log.old_values || '{}'); } catch { oldVals = {}; }
  try { newVals = JSON.parse(log.new_values || '{}'); } catch { newVals = {}; }

  const formatJson = (obj) => {
    if (!obj || !Object.keys(obj).length) return '<span class="text-muted">No data</span>';

    return Object.entries(obj).map(([key, val]) => {
      // Skip base64 image data — too large to display
      if (key === 'image_base64' || key === 'business_logo_base64') {
        val = val ? '[image data]' : null;
      }
      if (val === null || val === undefined) return '';

      return `
        <div style="display:flex;gap:var(--space-sm);padding:4px 0;border-bottom:1px solid var(--color-border);font-size:var(--text-xs);">
          <span style="font-weight:600;min-width:140px;color:var(--color-text-secondary);">${sanitize(key)}</span>
          <span style="word-break:break-all;">${sanitize(String(val))}</span>
        </div>
      `;
    }).filter(Boolean).join('');
  };

  import('./ui.js').then(({ showModal, closeModal }) => {
    showModal({
      title: `Audit Log Entry #${log.id}`,
      size:  'lg',
      body: `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-sm);margin-bottom:var(--space-lg);">
          <div class="form-print-row"><span class="form-print-label">Date:</span><span>${formatDateTime(log.created_at)}</span></div>
          <div class="form-print-row"><span class="form-print-label">User:</span><span>${sanitize(log.user_name_snapshot || 'System')}</span></div>
          <div class="form-print-row"><span class="form-print-label">Action:</span><span class="font-semibold">${sanitize(log.action)}</span></div>
          <div class="form-print-row"><span class="form-print-label">Entity:</span><span>${sanitize(log.entity_type || '—')} #${log.entity_id || '—'}</span></div>
        </div>

        <div class="section-divider">
          <span class="section-divider-label">Before</span>
          <div class="section-divider-line"></div>
        </div>
        <div style="background:var(--color-danger-light);border-radius:var(--radius-md);padding:var(--space-md);margin-bottom:var(--space-lg);max-height:200px;overflow-y:auto;">
          ${formatJson(oldVals)}
        </div>

        <div class="section-divider">
          <span class="section-divider-label">After</span>
          <div class="section-divider-line"></div>
        </div>
        <div style="background:var(--color-success-light);border-radius:var(--radius-md);padding:var(--space-md);max-height:200px;overflow-y:auto;">
          ${formatJson(newVals)}
        </div>
      `,
      footer: `<button class="btn btn-secondary" id="audit-detail-close-btn">Close</button>`,
      onOpen: () => {
        document.getElementById('audit-detail-close-btn')?.addEventListener('click', closeModal);
      }
    });
  });
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
function handleExport() {
  try {
    const exportData = _state.filtered.map(l => ({
      ID:          l.id,
      Date:        formatDateTime(l.created_at),
      User:        l.user_name_snapshot || 'System',
      Action:      l.action,
      Entity_Type: l.entity_type,
      Entity_ID:   l.entity_id,
      Old_Values:  l.old_values || '{}',
      New_Values:  l.new_values || '{}'
    }));

    const { exportCSV } = window._utils || {};
    if (exportCSV) {
      exportCSV(exportData, `audit-log-${new Date().toISOString().slice(0, 10)}`);
    } else {
      import('./utils.js').then(({ exportCSV }) => {
        exportCSV(exportData, `audit-log-${new Date().toISOString().slice(0, 10)}`);
      });
    }
    showToast(`Exported ${exportData.length} audit log entries.`, 'success');
  } catch (err) {
    console.error('[Audit] Export error:', err);
    showToast('Export failed.', 'error');
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export { init, destroy, writeAuditLog };
