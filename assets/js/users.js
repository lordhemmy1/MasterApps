/**
 * Stockdity IMS — User Management Module
 * Handles: user list, add user, edit user, reset password,
 * activate/deactivate users. Admin only.
 */

import db from './db.js';
import { getSession, hashPassword, adminResetPassword, generateInitials, getAvatarColorClass } from './auth.js';
import {
  showToast, showModal, closeModal, showConfirmModal,
  renderEmptyState, renderPagination, roleBadge,
  activeBadge, renderAvatar, sanitize
} from './ui.js';
import {
  formatDate, formatDateTime, debounce,
  filterBySearch, sortBy, paginate, validateEmail
} from './utils.js';
import { writeAuditLog } from './audit.js';

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _state = {
  users:      [],
  filtered:   [],
  page:       1,
  pageSize:   20,
  sortKey:    'name',
  sortDir:    'asc',
  searchTerm: ''
};
let _destroyed = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  _destroyed = false;

  const user = getSession();
  if (user?.role !== 'admin') {
    const content = document.getElementById('app-content');
    if (content) {
      content.innerHTML = `
        <div class="unauthorized-page">
          <div class="unauthorized-code">403</div>
          <h2 class="unauthorized-title">Access Denied</h2>
          <p class="unauthorized-text">User management is only available to administrators.</p>
          <a href="#/dashboard" class="btn btn-primary">Back to Dashboard</a>
        </div>
      `;
    }
    return;
  }

  await renderUserList();
}

function destroy() {
  _destroyed = true;
}

// ─── USER LIST ────────────────────────────────────────────────────────────────
async function renderUserList() {
  const content = document.getElementById('app-content');
  if (!content) return;

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-users-gear"></i> User Management</h1>
        <p class="page-subtitle">Manage system users, roles, and access permissions.</p>
      </div>
      <div class="page-actions">
        <button class="btn btn-primary" id="add-user-btn">
          <i class="fa-solid fa-user-plus"></i> Add User
        </button>
      </div>
    </div>

    <div class="filter-bar">
      <div class="filter-search">
        <input
          class="form-input"
          type="search"
          id="user-search"
          placeholder="Search by name or email…"
          value="${sanitize(_state.searchTerm)}"
        />
      </div>
      <button class="btn btn-ghost btn-sm" id="user-clear-btn">
        <i class="fa-solid fa-xmark"></i> Clear
      </button>
    </div>

    <div class="card" style="padding:0;">
      <div id="users-table-container"></div>
      <div id="users-pagination"></div>
    </div>
  `;

  // Events
  document.getElementById('add-user-btn')?.addEventListener('click', () => {
    showAddUserModal(() => loadAndRender());
  });

  document.getElementById('user-search')?.addEventListener('input', debounce((e) => {
    _state.searchTerm = e.target.value.trim();
    _state.page = 1;
    renderTable();
  }, 300));

  document.getElementById('user-clear-btn')?.addEventListener('click', () => {
    _state.searchTerm = '';
    _state.page       = 1;
    document.getElementById('user-search').value = '';
    renderTable();
  });

  // Event delegation for table actions
  document.getElementById('users-table-container')?.addEventListener('click', async (e) => {
    const btn    = e.target.closest('[data-action][data-id]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id     = parseInt(btn.dataset.id, 10);
    const user   = _state.users.find(u => u.id === id);

    if (action === 'edit')           showEditUserModal(user, () => loadAndRender());
    if (action === 'reset-password') showResetPasswordModal(user);
    if (action === 'toggle-active')  await handleToggleActive(user);
  });

  await loadAndRender();
}

async function loadAndRender() {
  // FIX: 'name' is not indexed – load all, sort in JS
  const allUsers = await db.users.toArray();
  allUsers.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  _state.users = allUsers;
  renderTable();
}

function renderTable() {
  const container = document.getElementById('users-table-container');
  const pagWrap   = document.getElementById('users-pagination');
  if (!container) return;

  const currentUser = getSession();

  const filtered = filterBySearch(_state.users, _state.searchTerm, ['name', 'email', 'role']);
  const sorted   = sortBy(filtered, _state.sortKey, _state.sortDir);
  _state.filtered = sorted;

  const { data, total } = paginate(sorted, _state.page, _state.pageSize);

  if (!data.length) {
    container.innerHTML = renderEmptyState(
      _state.searchTerm ? 'No users match your search.' : 'No users found.',
      'fa-solid fa-users'
    );
    if (pagWrap) pagWrap.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th style="width:48px;"></th>
            <th data-sort="name" class="sortable ${_state.sortKey === 'name' ? (_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}" style="cursor:pointer;">
              Name
            </th>
            <th>Email</th>
            <th data-sort="role" class="sortable ${_state.sortKey === 'role' ? (_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc') : ''}" style="cursor:pointer;">
              Role
            </th>
            <th>Status</th>
            <th>Last Login</th>
            <th>Created</th>
            <th style="width:160px;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(user => {
            const initials   = user.avatar_initials || generateInitials(user.name);
            const colorClass = getAvatarColorClass(user.name);
            const isSelf     = user.id === currentUser?.id;

            return `
              <tr>
                <td>${renderAvatar(initials, colorClass, 'sm')}</td>
                <td>
                  <div class="font-semibold">${sanitize(user.name)}</div>
                  ${user.force_password_change
                    ? `<span class="badge badge-warning" style="font-size:10px;">
                        <i class="fa-solid fa-key"></i> Must change password
                      </span>`
                    : ''
                  }
                </td>
                <td class="text-muted">${sanitize(user.email)}</td>
                <td>${roleBadge(user.role)}</td>
                <td>${activeBadge(user.is_active)}</td>
                <td class="text-muted text-xs">
                  ${user.last_login ? formatDateTime(user.last_login) : 'Never'}
                </td>
                <td class="text-muted text-xs">${formatDate(user.created_at)}</td>
                <td>
                  <div class="table-actions">
                    <button class="btn btn-ghost btn-sm" data-action="edit" data-id="${user.id}" title="Edit user">
                      <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn btn-ghost btn-sm" data-action="reset-password" data-id="${user.id}" title="Reset password">
                      <i class="fa-solid fa-key"></i>
                    </button>
                    <button
                      class="btn btn-ghost btn-sm ${user.is_active ? 'text-danger' : 'text-success'}"
                      data-action="toggle-active"
                      data-id="${user.id}"
                      title="${user.is_active ? 'Deactivate' : 'Activate'}"
                      ${isSelf ? 'disabled title="Cannot deactivate your own account"' : ''}
                    >
                      <i class="fa-solid fa-${user.is_active ? 'ban' : 'circle-check'}"></i>
                    </button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
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

// ─── ADD USER MODAL ───────────────────────────────────────────────────────────
function showAddUserModal(onSaved) {
  showModal({
    title: 'Add New User',
    size:  'lg',
    body: `
      <form id="add-user-form" novalidate autocomplete="off">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="new-user-name">Full Name <span class="required">*</span></label>
            <input class="form-input" type="text" id="new-user-name" name="name"
              placeholder="e.g. John Smith" required autofocus />
            <span class="form-error-text" id="new-user-name-err"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="new-user-email">Email Address <span class="required">*</span></label>
            <input class="form-input" type="email" id="new-user-email" name="email"
              placeholder="e.g. john@business.com" required />
            <span class="form-error-text" id="new-user-email-err"></span>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="new-user-role">Role <span class="required">*</span></label>
            <select class="form-select" id="new-user-role" name="role">
              <option value="staff">Staff</option>
              <option value="manager">Manager</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="new-user-password">Initial Password <span class="required">*</span></label>
            <div class="input-icon-wrap">
              <input class="form-input" type="password" id="new-user-password" name="password"
                placeholder="Min 8 chars" required autocomplete="new-password" />
              <button type="button" class="password-toggle" id="new-pwd-toggle">
                <i class="fa-solid fa-eye"></i>
              </button>
            </div>
            <span class="form-error-text" id="new-user-password-err"></span>
          </div>
        </div>

        <div class="alert alert-info" style="margin-top:var(--space-sm);">
          <i class="fa-solid fa-circle-info"></i>
          The user will be required to change their password on first login.
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn-secondary" id="add-user-cancel-btn">Cancel</button>
      <button class="btn btn-primary" id="add-user-save-btn">
        <span class="btn-text"><i class="fa-solid fa-user-plus"></i> Add User</span>
        <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
      </button>
    `,
    onOpen: () => {
      document.getElementById('add-user-cancel-btn')?.addEventListener('click', closeModal);
      document.getElementById('add-user-save-btn')?.addEventListener('click', () => handleAddUser(onSaved));

      // Toggle password visibility
      document.getElementById('new-pwd-toggle')?.addEventListener('click', () => {
        const input = document.getElementById('new-user-password');
        const icon  = document.querySelector('#new-pwd-toggle i');
        const isText = input.type === 'text';
        input.type   = isText ? 'password' : 'text';
        icon.className = isText ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
      });
    }
  });
}

async function handleAddUser(onSaved) {
  const nameInput  = document.getElementById('new-user-name');
  const emailInput = document.getElementById('new-user-email');
  const roleInput  = document.getElementById('new-user-role');
  const pwdInput   = document.getElementById('new-user-password');
  const nameErr    = document.getElementById('new-user-name-err');
  const emailErr   = document.getElementById('new-user-email-err');
  const pwdErr     = document.getElementById('new-user-password-err');
  const btnText    = document.querySelector('#add-user-save-btn .btn-text');
  const btnSpinner = document.querySelector('#add-user-save-btn .btn-spinner');

  // Clear errors
  [nameErr, emailErr, pwdErr].forEach(el => { if (el) el.textContent = ''; });
  [nameInput, emailInput, pwdInput].forEach(el => el?.classList.remove('is-invalid'));

  const name     = nameInput?.value.trim()  || '';
  const email    = emailInput?.value.trim().toLowerCase() || '';
  const role     = roleInput?.value         || 'staff';
  const password = pwdInput?.value          || '';

  let hasError = false;

  if (!name) {
    if (nameErr)  nameErr.textContent  = 'Full name is required.';
    nameInput?.classList.add('is-invalid');
    hasError = true;
  }

  if (!email || !validateEmail(email)) {
    if (emailErr) emailErr.textContent = 'A valid email address is required.';
    emailInput?.classList.add('is-invalid');
    hasError = true;
  }

  if (!password || password.length < 8) {
    if (pwdErr) pwdErr.textContent = 'Password must be at least 8 characters.';
    pwdInput?.classList.add('is-invalid');
    hasError = true;
  }

  if (hasError) return;

  // Check email uniqueness
  const existing = await db.users.where('email').equals(email).first();
  if (existing) {
    if (emailErr) emailErr.textContent = 'An account with this email already exists.';
    emailInput?.classList.add('is-invalid');
    return;
  }

  btnText?.classList.add('hidden');
  btnSpinner?.classList.remove('hidden');

  try {
    const { hash, salt } = await hashPassword(password);
    const initials       = generateInitials(name);
    const now            = new Date().toISOString();

    const id = await db.users.add({
      name,
      email,
      password_hash:         hash,
      password_salt:         salt,
      role,
      is_active:             1,
      avatar_initials:       initials,
      force_password_change: true,
      last_login:            null,
      created_at:            now
    });

    await writeAuditLog({
      action:      'create',
      entity_type: 'users',
      entity_id:   id,
      new_values:  { name, email, role }
    });

    showToast(`User "${name}" created successfully.`, 'success');
    closeModal();
    if (typeof onSaved === 'function') onSaved();

  } catch (err) {
    console.error('[Users] Add user error:', err);
    showToast('Failed to create user.', 'error');
  } finally {
    btnText?.classList.remove('hidden');
    btnSpinner?.classList.add('hidden');
  }
}

// ─── EDIT USER MODAL ──────────────────────────────────────────────────────────
function showEditUserModal(user, onSaved) {
  if (!user) return;

  showModal({
    title: `Edit User: ${user.name}`,
    size:  'lg',
    body: `
      <form id="edit-user-form" novalidate autocomplete="off">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="edit-user-name">Full Name <span class="required">*</span></label>
            <input class="form-input" type="text" id="edit-user-name"
              value="${sanitize(user.name)}" required autofocus />
            <span class="form-error-text" id="edit-user-name-err"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="edit-user-email">Email Address <span class="required">*</span></label>
            <input class="form-input" type="email" id="edit-user-email"
              value="${sanitize(user.email)}" required />
            <span class="form-error-text" id="edit-user-email-err"></span>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-user-role">Role</label>
          <select class="form-select" id="edit-user-role">
            <option value="staff"   ${user.role === 'staff'   ? 'selected' : ''}>Staff</option>
            <option value="manager" ${user.role === 'manager' ? 'selected' : ''}>Manager</option>
            <option value="admin"   ${user.role === 'admin'   ? 'selected' : ''}>Admin</option>
          </select>
        </div>
        <div class="alert alert-info" style="margin-top:var(--space-sm);">
          <i class="fa-solid fa-circle-info"></i>
          To change this user's password, use the Reset Password button instead.
        </div>
      </form>
    `,
    footer: `
      <button class="btn btn-secondary" id="edit-user-cancel-btn">Cancel</button>
      <button class="btn btn-primary" id="edit-user-save-btn">
        <span class="btn-text"><i class="fa-solid fa-floppy-disk"></i> Save Changes</span>
        <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
      </button>
    `,
    onOpen: () => {
      document.getElementById('edit-user-cancel-btn')?.addEventListener('click', closeModal);
      document.getElementById('edit-user-save-btn')?.addEventListener('click', () => handleEditUser(user, onSaved));
    }
  });
}

async function handleEditUser(user, onSaved) {
  const nameInput  = document.getElementById('edit-user-name');
  const emailInput = document.getElementById('edit-user-email');
  const roleInput  = document.getElementById('edit-user-role');
  const nameErr    = document.getElementById('edit-user-name-err');
  const emailErr   = document.getElementById('edit-user-email-err');
  const btnText    = document.querySelector('#edit-user-save-btn .btn-text');
  const btnSpinner = document.querySelector('#edit-user-save-btn .btn-spinner');

  [nameErr, emailErr].forEach(el => { if (el) el.textContent = ''; });
  [nameInput, emailInput].forEach(el => el?.classList.remove('is-invalid'));

  const name  = nameInput?.value.trim()             || '';
  const email = emailInput?.value.trim().toLowerCase() || '';
  const role  = roleInput?.value                    || user.role;

  let hasError = false;

  if (!name) {
    if (nameErr) nameErr.textContent = 'Full name is required.';
    nameInput?.classList.add('is-invalid');
    hasError = true;
  }

  if (!email || !validateEmail(email)) {
    if (emailErr) emailErr.textContent = 'A valid email address is required.';
    emailInput?.classList.add('is-invalid');
    hasError = true;
  }

  if (hasError) return;

  // Check email uniqueness (excluding self)
  const existing = await db.users.where('email').equals(email).first();
  if (existing && existing.id !== user.id) {
    if (emailErr) emailErr.textContent = 'Another account already uses this email.';
    emailInput?.classList.add('is-invalid');
    return;
  }

  btnText?.classList.add('hidden');
  btnSpinner?.classList.remove('hidden');

  try {
    const initials = generateInitials(name);
    const old      = { name: user.name, email: user.email, role: user.role };

    await db.users.update(user.id, { name, email, role, avatar_initials: initials });

    await writeAuditLog({
      action:      'update',
      entity_type: 'users',
      entity_id:   user.id,
      old_values:  old,
      new_values:  { name, email, role }
    });

    showToast(`User "${name}" updated.`, 'success');
    closeModal();
    if (typeof onSaved === 'function') onSaved();

  } catch (err) {
    console.error('[Users] Edit user error:', err);
    showToast('Failed to update user.', 'error');
  } finally {
    btnText?.classList.remove('hidden');
    btnSpinner?.classList.add('hidden');
  }
}

// ─── RESET PASSWORD MODAL ─────────────────────────────────────────────────────
function showResetPasswordModal(user) {
  if (!user) return;

  showModal({
    title: `Reset Password: ${user.name}`,
    size:  'sm',
    body: `
      <div class="alert alert-warning" style="margin-bottom:var(--space-lg);">
        <i class="fa-solid fa-triangle-exclamation"></i>
        The user will be required to change this password on their next login.
      </div>
      <div class="form-group">
        <label class="form-label" for="reset-pwd-input">New Password <span class="required">*</span></label>
        <div class="input-icon-wrap">
          <input class="form-input" type="password" id="reset-pwd-input"
            placeholder="Min 8 characters" autofocus autocomplete="new-password" />
          <button type="button" class="password-toggle" id="reset-pwd-toggle">
            <i class="fa-solid fa-eye"></i>
          </button>
        </div>
        <span class="form-error-text" id="reset-pwd-err"></span>
      </div>
      <div class="form-group" style="margin-bottom:0;">
        <label class="form-label" for="reset-pwd-confirm">Confirm Password <span class="required">*</span></label>
        <input class="form-input" type="password" id="reset-pwd-confirm"
          placeholder="Repeat new password" autocomplete="new-password" />
        <span class="form-error-text" id="reset-pwd-confirm-err"></span>
      </div>
    `,
    footer: `
      <button class="btn btn-secondary" id="reset-pwd-cancel-btn">Cancel</button>
      <button class="btn btn-primary" id="reset-pwd-save-btn">
        <span class="btn-text"><i class="fa-solid fa-key"></i> Reset Password</span>
        <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
      </button>
    `,
    onOpen: () => {
      document.getElementById('reset-pwd-cancel-btn')?.addEventListener('click', closeModal);

      document.getElementById('reset-pwd-toggle')?.addEventListener('click', () => {
        const input = document.getElementById('reset-pwd-input');
        const icon  = document.querySelector('#reset-pwd-toggle i');
        const isText = input.type === 'text';
        input.type   = isText ? 'password' : 'text';
        icon.className = isText ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
      });

      document.getElementById('reset-pwd-save-btn')?.addEventListener('click', async () => {
        const pwdInput     = document.getElementById('reset-pwd-input');
        const confirmInput = document.getElementById('reset-pwd-confirm');
        const pwdErr       = document.getElementById('reset-pwd-err');
        const confirmErr   = document.getElementById('reset-pwd-confirm-err');
        const btnText      = document.querySelector('#reset-pwd-save-btn .btn-text');
        const btnSpinner   = document.querySelector('#reset-pwd-save-btn .btn-spinner');

        pwdErr.textContent     = '';
        confirmErr.textContent = '';

        const newPassword = pwdInput?.value    || '';
        const confirm     = confirmInput?.value || '';

        if (newPassword.length < 8) {
          pwdErr.textContent = 'Password must be at least 8 characters.';
          return;
        }
        if (newPassword !== confirm) {
          confirmErr.textContent = 'Passwords do not match.';
          return;
        }

        btnText?.classList.add('hidden');
        btnSpinner?.classList.remove('hidden');

        try {
          const result = await adminResetPassword(user.id, newPassword);
          if (result.success) {
            showToast(`Password reset for "${user.name}". They must change it on next login.`, 'success');
            closeModal();
            await loadAndRender();
          } else {
            pwdErr.textContent = result.error || 'Failed to reset password.';
          }
        } catch (err) {
          console.error('[Users] Reset password error:', err);
          pwdErr.textContent = 'An error occurred. Please try again.';
        } finally {
          btnText?.classList.remove('hidden');
          btnSpinner?.classList.add('hidden');
        }
      });

      document.getElementById('reset-pwd-input')?.focus();
    }
  });
}

// ─── TOGGLE ACTIVE ────────────────────────────────────────────────────────────
async function handleToggleActive(user) {
  if (!user) return;

  const currentUser = getSession();
  if (user.id === currentUser?.id) {
    showToast('You cannot deactivate your own account.', 'warning');
    return;
  }

  const newState = !user.is_active;
  const verb     = newState ? 'activate' : 'deactivate';

  showConfirmModal({
    title:       `${newState ? 'Activate' : 'Deactivate'} User`,
    message:     `Are you sure you want to ${verb} "${user.name}"? ${!newState ? 'They will be unable to log in until reactivated.' : ''}`,
    confirmText: newState ? 'Activate' : 'Deactivate',
    confirmClass:newState ? 'btn-success' : 'btn-warning',
    onConfirm:   async () => {
      try {
        await db.users.update(user.id, { is_active: newState ? 1 : 0 });

        await writeAuditLog({
          action:      'update',
          entity_type: 'users',
          entity_id:   user.id,
          old_values:  { is_active: user.is_active },
          new_values:  { is_active: newState ? 1 : 0 }
        });

        showToast(`User "${user.name}" ${verb}d.`, 'success');
        await loadAndRender();

      } catch (err) {
        console.error('[Users] Toggle active error:', err);
        showToast(`Failed to ${verb} user.`, 'error');
      }
    }
  });
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export { init, destroy };
