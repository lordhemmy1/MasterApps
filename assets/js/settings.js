/**
 * Stockdity IMS — Settings Module
 * Handles: Business Profile, Preferences, Notifications,
 * Licence, Change Password, Data Management tabs.
 */

import db, {
  getAllSettings, setSetting, exportAllData,
  importAllData, clearAllData, validateBackupStructure
} from './db.js';
import {
  getSession, changePassword, validatePasswordStrength,
  clearActivationRecord, getActivationRecord
} from './auth.js';
import {
  showToast, showModal, closeModal, showConfirmModal,
  showTypedConfirmModal, applyPrimaryColor,
  sanitize, toggleVisible
} from './ui.js';
import {
  formatDate, formatDateTime,
  validateEmail, validatePhone,
  fileToBase64, validateImageFile, exportJSON
} from './utils.js';
import { sendTestEmail } from './notifications.js';
import { writeAuditLog } from './audit.js';
import AppConfig from '../../config.js';

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _activeTab  = 'profile';
let _settings   = {};
let _destroyed  = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init(params = {}) {
  _destroyed = false;

  // If invoked with action='change-password', go directly to that tab
  if (params.action === 'change-password') {
    _activeTab = 'password';
  } else if (params.query?.tab) {
    _activeTab = params.query.tab;
  }

  const user = getSession();
  if (!user) return;

  _settings = await getAllSettings();
  renderSettingsPage(user);
}

function destroy() {
  _destroyed = true;
}

// ─── SETTINGS SHELL ───────────────────────────────────────────────────────────
function renderSettingsPage(user) {
  const content = document.getElementById('app-content');
  if (!content) return;

  const isAdmin = user.role === 'admin';

  const tabs = [
    { key: 'profile',     label: 'Business Profile',  icon: 'fa-building',          show: isAdmin },
    { key: 'preferences', label: 'Preferences',       icon: 'fa-sliders',           show: isAdmin },
    { key: 'notifications',label:'Notifications',      icon: 'fa-bell',              show: isAdmin },
    { key: 'licence',     label: 'Licence',           icon: 'fa-shield-halved',     show: isAdmin },
    { key: 'password',    label: 'Change Password',   icon: 'fa-key',               show: true    },
    { key: 'data',        label: 'Data Management',   icon: 'fa-database',          show: isAdmin }
  ].filter(t => t.show);

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-gear"></i> Settings</h1>
        <p class="page-subtitle">Configure your application, account, and business settings.</p>
      </div>
    </div>

    <div class="tab-bar">
      ${tabs.map(tab => `
        <button
          class="tab-btn ${_activeTab === tab.key ? 'active' : ''}"
          data-tab="${tab.key}"
        >
          <i class="fa-solid ${tab.icon}"></i> ${sanitize(tab.label)}
        </button>
      `).join('')}
    </div>

    <div id="settings-tab-content"></div>
  `;

  // Tab switching
  content.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      if (tab === _activeTab) return;
      _activeTab = tab;

      content.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
      });

      renderActiveTab(user);
    });
  });

  renderActiveTab(user);
}

function renderActiveTab(user) {
  const area = document.getElementById('settings-tab-content');
  if (!area) return;

  switch (_activeTab) {
    case 'profile':       renderProfileTab(area);       break;
    case 'preferences':   renderPreferencesTab(area);   break;
    case 'notifications': renderNotificationsTab(area); break;
    case 'licence':       renderLicenceTab(area);       break;
    case 'password':      renderPasswordTab(area, user); break;
    case 'data':          renderDataTab(area);           break;
    default:              renderProfileTab(area);
  }
}

// ─── TAB 1: BUSINESS PROFILE ──────────────────────────────────────────────────
function renderProfileTab(area) {
  area.innerHTML = `
    <div class="card" style="max-width:760px;">
      <div class="card-header">
        <h3 class="card-title">Business Profile</h3>
      </div>
      <form id="profile-form" novalidate autocomplete="off">

        <!-- Logo -->
        <div class="form-group">
          <label class="form-label">Business Logo</label>
          <div style="display:flex;align-items:flex-start;gap:var(--space-xl);">
            <div class="image-preview-wrap" id="logo-preview-wrap" style="width:100px;height:100px;">
              ${_settings.business_logo_base64
                ? `<img src="${_settings.business_logo_base64}" alt="Logo" style="width:100%;height:100%;object-fit:contain;" id="logo-preview-img" />`
                : `<div class="image-preview-placeholder"><i class="fa-solid fa-building"></i><span>No logo</span></div>`
              }
              ${_settings.business_logo_base64
                ? `<button type="button" class="image-remove-btn" id="remove-logo-btn"><i class="fa-solid fa-xmark"></i></button>`
                : ''
              }
            </div>
            <div>
              <input type="file" id="logo-file-input" accept="image/jpeg,image/png,image/webp" style="display:none;" />
              <button type="button" class="btn btn-secondary btn-sm" id="upload-logo-btn">
                <i class="fa-solid fa-upload"></i> Upload Logo
              </button>
              <p class="form-helper-text" style="margin-top:var(--space-xs);">Max 1MB. JPG, PNG or WEBP.</p>
              <span class="form-error-text" id="logo-err"></span>
            </div>
          </div>
          <input type="hidden" id="logo-b64" name="business_logo_base64" value="${_settings.business_logo_base64 ? '1' : ''}" />
        </div>

        <div class="section-divider"><div class="section-divider-line"></div></div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="biz-name">Business Name <span class="required">*</span></label>
            <input class="form-input" type="text" id="biz-name" name="business_name"
              value="${sanitize(_settings.business_name || '')}"
              placeholder="e.g. Sunshine Pharmacy" required />
            <span class="form-error-text" id="biz-name-err"></span>
          </div>
          <div class="form-group">
            <label class="form-label" for="biz-phone">Business Phone</label>
            <input class="form-input" type="tel" id="biz-phone" name="business_phone"
              value="${sanitize(_settings.business_phone || '')}"
              placeholder="e.g. +234 801 234 5678" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="biz-email">Business Email</label>
          <input class="form-input" type="email" id="biz-email" name="business_email"
            value="${sanitize(_settings.business_email || '')}"
            placeholder="e.g. info@sunshine.com" />
          <span class="form-error-text" id="biz-email-err"></span>
        </div>

        <div class="form-group">
          <label class="form-label" for="biz-address">Business Address</label>
          <textarea class="form-textarea" id="biz-address" name="business_address" rows="3"
            placeholder="Full business address…">${sanitize(_settings.business_address || '')}</textarea>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:var(--space-md);">
          <button type="submit" class="btn btn-primary" id="profile-save-btn">
            <span class="btn-text"><i class="fa-solid fa-floppy-disk"></i> Save Profile</span>
            <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
          </button>
        </div>
      </form>
    </div>
  `;

  let currentLogoB64 = _settings.business_logo_base64 || null;

  // Logo upload
  const fileInput   = document.getElementById('logo-file-input');
  const uploadBtn   = document.getElementById('upload-logo-btn');
  const previewWrap = document.getElementById('logo-preview-wrap');
  const logoB64El   = document.getElementById('logo-b64');
  const logoErrEl   = document.getElementById('logo-err');

  uploadBtn?.addEventListener('click', () => fileInput?.click());

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    const validation = validateImageFile(file, AppConfig.MAX_LOGO_SIZE_BYTES);
    if (!validation.valid) {
      if (logoErrEl) logoErrEl.textContent = validation.error;
      return;
    }
    if (logoErrEl) logoErrEl.textContent = '';

    try {
      const b64 = await fileToBase64(file);
      currentLogoB64 = b64;
      if (logoB64El) logoB64El.value = b64;

      if (previewWrap) {
        previewWrap.innerHTML = `
          <img src="${b64}" alt="Logo Preview" style="width:100%;height:100%;object-fit:contain;" />
          <button type="button" class="image-remove-btn" id="remove-logo-btn">
            <i class="fa-solid fa-xmark"></i>
          </button>
        `;
        document.getElementById('remove-logo-btn')?.addEventListener('click', removeLogo);
      }
    } catch {
      if (logoErrEl) logoErrEl.textContent = 'Failed to read image.';
    }
  });

  function removeLogo() {
    currentLogoB64 = null;
    if (logoB64El) logoB64El.value = '';
    if (previewWrap) {
      previewWrap.innerHTML = `<div class="image-preview-placeholder"><i class="fa-solid fa-building"></i><span>No logo</span></div>`;
    }
  }

  document.getElementById('remove-logo-btn')?.addEventListener('click', removeLogo);

  // Form submit
  document.getElementById('profile-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const bizNameEl  = document.getElementById('biz-name');
    const nameErrEl  = document.getElementById('biz-name-err');
    const emailErrEl = document.getElementById('biz-email-err');
    const btnText    = document.querySelector('#profile-save-btn .btn-text');
    const btnSpinner = document.querySelector('#profile-save-btn .btn-spinner');

    if (nameErrEl) nameErrEl.textContent  = '';
    if (emailErrEl) emailErrEl.textContent = '';

    const bizName  = bizNameEl?.value.trim() || '';
    const bizEmail = document.getElementById('biz-email')?.value.trim() || '';

    if (!bizName) {
      if (nameErrEl) nameErrEl.textContent = 'Business name is required.';
      bizNameEl?.classList.add('is-invalid');
      return;
    }

    if (bizEmail && !validateEmail(bizEmail)) {
      if (emailErrEl) emailErrEl.textContent = 'Please enter a valid email address.';
      document.getElementById('biz-email')?.classList.add('is-invalid');
      return;
    }

    btnText?.classList.add('hidden');
    btnSpinner?.classList.remove('hidden');

    try {
      const updates = {
        business_name:         bizName,
        business_phone:        document.getElementById('biz-phone')?.value.trim()   || '',
        business_email:        bizEmail,
        business_address:      document.getElementById('biz-address')?.value.trim() || '',
        business_logo_base64:  currentLogoB64 || ''
      };

      for (const [key, value] of Object.entries(updates)) {
        await setSetting(key, value);
      }

      // Update global settings cache
      Object.assign(window.AppState.settings, updates);
      window._appSettings = window.AppState.settings;

      // Dispatch settings updated event
      window.dispatchEvent(new CustomEvent('settings:updated'));

      showToast('Business profile saved.', 'success');

    } catch (err) {
      console.error('[Settings] Profile save error:', err);
      showToast('Failed to save settings.', 'error');
    } finally {
      btnText?.classList.remove('hidden');
      btnSpinner?.classList.add('hidden');
    }
  });
}

// ─── TAB 2: PREFERENCES ───────────────────────────────────────────────────────
function renderPreferencesTab(area) {
  const currentColor = _settings.primary_color || AppConfig.DEFAULT_PRIMARY_COLOR;

  area.innerHTML = `
    <div class="card" style="max-width:760px;">
      <div class="card-header">
        <h3 class="card-title">Application Preferences</h3>
      </div>
      <form id="prefs-form" novalidate autocomplete="off">

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="pref-currency">Currency Symbol</label>
            <input class="form-input" type="text" id="pref-currency" name="currency_symbol"
              value="${sanitize(_settings.currency_symbol || AppConfig.DEFAULT_CURRENCY_SYMBOL)}"
              placeholder="e.g. ₦, $, £, €" maxlength="5"
              style="font-size:var(--text-xl);text-align:center;font-weight:700;" />
            <span class="form-helper-text">Used throughout the app in prices and totals.</span>
          </div>
          <div class="form-group">
            <label class="form-label" for="pref-date-format">Date Format</label>
            <select class="form-select" id="pref-date-format" name="date_format">
              <option value="DD/MM/YYYY" ${_settings.date_format === 'DD/MM/YYYY' ? 'selected' : ''}>DD/MM/YYYY (31/01/2024)</option>
              <option value="MM/DD/YYYY" ${_settings.date_format === 'MM/DD/YYYY' ? 'selected' : ''}>MM/DD/YYYY (01/31/2024)</option>
              <option value="YYYY-MM-DD" ${_settings.date_format === 'YYYY-MM-DD' ? 'selected' : ''}>YYYY-MM-DD (2024-01-31)</option>
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="pref-threshold">Default Low Stock Threshold</label>
            <input class="form-input" type="number" id="pref-threshold" name="default_low_stock_threshold"
              min="1" step="1"
              value="${sanitize(_settings.default_low_stock_threshold || String(AppConfig.DEFAULT_LOW_STOCK_THRESHOLD))}" />
            <span class="form-helper-text">Applied to new products unless overridden.</span>
          </div>
          <div class="form-group">
            <label class="form-label" for="pref-sidebar">Sidebar Default State</label>
            <select class="form-select" id="pref-sidebar" name="sidebar_collapsed">
              <option value="false" ${_settings.sidebar_collapsed !== 'true' ? 'selected' : ''}>Expanded</option>
              <option value="true"  ${_settings.sidebar_collapsed === 'true'  ? 'selected' : ''}>Collapsed</option>
            </select>
          </div>
        </div>

        <!-- Primary Colour -->
        <div class="form-group">
          <label class="form-label">Primary Colour</label>
          <div class="color-picker-wrap">
            <input type="color" id="pref-color" name="primary_color"
              value="${sanitize(currentColor)}" />
            <input class="form-input color-value-input" type="text" id="pref-color-hex"
              value="${sanitize(currentColor)}"
              placeholder="#4F46E5" maxlength="7" style="width:120px;" />
            <div style="
              width:40px;height:40px;border-radius:var(--radius-md);
              background:${sanitize(currentColor)};
              border:1px solid var(--color-border);
              flex-shrink:0;
            " id="color-preview-box"></div>
            <button type="button" class="btn btn-secondary btn-sm" id="reset-color-btn">
              Reset Default
            </button>
          </div>
          <span class="form-helper-text">Changes apply instantly. Refresh if needed.</span>
        </div>

        <div style="display:flex;justify-content:flex-end;">
          <button type="submit" class="btn btn-primary" id="prefs-save-btn">
            <span class="btn-text"><i class="fa-solid fa-floppy-disk"></i> Save Preferences</span>
            <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
          </button>
        </div>
      </form>
    </div>
  `;

  // Live colour picker sync
  const colorPicker = document.getElementById('pref-color');
  const colorHex    = document.getElementById('pref-color-hex');
  const colorPreview= document.getElementById('color-preview-box');

  colorPicker?.addEventListener('input', (e) => {
    const val = e.target.value;
    if (colorHex)     colorHex.value     = val;
    if (colorPreview) colorPreview.style.background = val;
    applyPrimaryColor(val);
  });

  colorHex?.addEventListener('input', (e) => {
    const val = e.target.value;
    if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
      if (colorPicker) colorPicker.value = val;
      if (colorPreview) colorPreview.style.background = val;
      applyPrimaryColor(val);
    }
  });

  document.getElementById('reset-color-btn')?.addEventListener('click', () => {
    const def = AppConfig.DEFAULT_PRIMARY_COLOR;
    if (colorPicker)  colorPicker.value  = def;
    if (colorHex)     colorHex.value     = def;
    if (colorPreview) colorPreview.style.background = def;
    applyPrimaryColor(def);
  });

  // Form submit
  document.getElementById('prefs-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnText    = document.querySelector('#prefs-save-btn .btn-text');
    const btnSpinner = document.querySelector('#prefs-save-btn .btn-spinner');

    btnText?.classList.add('hidden');
    btnSpinner?.classList.remove('hidden');

    try {
      const updates = {
        currency_symbol:           document.getElementById('pref-currency')?.value.trim()     || '₦',
        date_format:               document.getElementById('pref-date-format')?.value          || 'DD/MM/YYYY',
        default_low_stock_threshold:document.getElementById('pref-threshold')?.value          || '10',
        sidebar_collapsed:         document.getElementById('pref-sidebar')?.value             || 'false',
        primary_color:             document.getElementById('pref-color')?.value               || AppConfig.DEFAULT_PRIMARY_COLOR
      };

      for (const [key, value] of Object.entries(updates)) {
        await setSetting(key, value);
      }

      Object.assign(window.AppState.settings, updates);
      window._appSettings = window.AppState.settings;
      window.dispatchEvent(new CustomEvent('settings:updated'));

      showToast('Preferences saved.', 'success');

    } catch (err) {
      console.error('[Settings] Prefs save error:', err);
      showToast('Failed to save preferences.', 'error');
    } finally {
      btnText?.classList.remove('hidden');
      btnSpinner?.classList.add('hidden');
    }
  });
}

// ─── TAB 3: NOTIFICATIONS ─────────────────────────────────────────────────────
function renderNotificationsTab(area) {
  const emailEnabled = _settings.email_alerts_enabled === 'true';

  area.innerHTML = `
    <div class="card" style="max-width:760px;">
      <div class="card-header">
        <h3 class="card-title">Email Alert Settings</h3>
      </div>

      <div class="alert alert-info" style="margin-bottom:var(--space-xl);">
        <i class="fa-solid fa-circle-info"></i>
        Email alerts are sent via <a href="https://www.emailjs.com" target="_blank" rel="noopener">EmailJS</a>
        (free plan: 200 emails/month). Create a free account, set up a service and template, then enter the details below.
      </div>

      <form id="notif-form" novalidate autocomplete="off">

        <div class="form-group">
          <div class="toggle-wrap">
            <label class="toggle-switch">
              <input type="checkbox" id="email-enabled-toggle"
                ${emailEnabled ? 'checked' : ''} />
              <span class="toggle-slider"></span>
            </label>
            <span class="toggle-label">Enable Email Alerts</span>
          </div>
          <span class="form-helper-text" style="margin-top:var(--space-xs);">
            Sends alerts for low stock and expiry events.
          </span>
        </div>

        <div id="emailjs-fields" style="${emailEnabled ? '' : 'opacity:0.5;pointer-events:none;'}">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="ejs-service-id">EmailJS Service ID</label>
              <input class="form-input" type="text" id="ejs-service-id"
                value="${sanitize(_settings.emailjs_service_id || '')}"
                placeholder="e.g. service_abc123" autocomplete="off" spellcheck="false" />
            </div>
            <div class="form-group">
              <label class="form-label" for="ejs-public-key">EmailJS Public Key</label>
              <input class="form-input" type="text" id="ejs-public-key"
                value="${sanitize(_settings.emailjs_public_key || '')}"
                placeholder="e.g. user_xyz789" autocomplete="off" spellcheck="false" />
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="ejs-template-lowstock">Low Stock Template ID</label>
              <input class="form-input" type="text" id="ejs-template-lowstock"
                value="${sanitize(_settings.emailjs_template_id_lowstock || '')}"
                placeholder="e.g. template_lowstock" autocomplete="off" spellcheck="false" />
            </div>
            <div class="form-group">
              <label class="form-label" for="ejs-template-expiry">Expiry Template ID</label>
              <input class="form-input" type="text" id="ejs-template-expiry"
                value="${sanitize(_settings.emailjs_template_id_expiry || '')}"
                placeholder="e.g. template_expiry" autocomplete="off" spellcheck="false" />
            </div>
          </div>

          <div class="alert alert-info" style="margin-bottom:var(--space-lg);">
            <i class="fa-solid fa-circle-info"></i>
            <div>
              <strong>Template Variables for Low Stock:</strong>
              <code>{{product_name}}</code>, <code>{{current_quantity}}</code>,
              <code>{{threshold}}</code>, <code>{{business_name}}</code><br>
              <strong>Template Variables for Expiry:</strong>
              <code>{{product_name}}</code>, <code>{{expiry_date}}</code>,
              <code>{{days_remaining}}</code>, <code>{{business_name}}</code>
            </div>
          </div>

          <div style="margin-bottom:var(--space-lg);">
            <button type="button" class="btn btn-secondary" id="test-email-btn">
              <span class="btn-text"><i class="fa-solid fa-paper-plane"></i> Send Test Email</span>
              <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
            </button>
            <span class="form-helper-text" style="margin-left:var(--space-md);">
              Uses the Low Stock template with dummy data.
            </span>
          </div>
        </div>

        <div style="display:flex;justify-content:flex-end;">
          <button type="submit" class="btn btn-primary" id="notif-save-btn">
            <span class="btn-text"><i class="fa-solid fa-floppy-disk"></i> Save Notification Settings</span>
            <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
          </button>
        </div>
      </form>
    </div>
  `;

  // Toggle fields opacity
  document.getElementById('email-enabled-toggle')?.addEventListener('change', (e) => {
    const fields = document.getElementById('emailjs-fields');
    if (fields) {
      fields.style.opacity        = e.target.checked ? '1'    : '0.5';
      fields.style.pointerEvents  = e.target.checked ? 'auto' : 'none';
    }
  });

  // Test email button
  document.getElementById('test-email-btn')?.addEventListener('click', async () => {
    const btnText    = document.querySelector('#test-email-btn .btn-text');
    const btnSpinner = document.querySelector('#test-email-btn .btn-spinner');

    btnText?.classList.add('hidden');
    btnSpinner?.classList.remove('hidden');

    try {
      // Save current values first so sendTestEmail reads the latest
      const tempSettings = {
        emailjs_service_id:           document.getElementById('ejs-service-id')?.value.trim()       || '',
        emailjs_public_key:           document.getElementById('ejs-public-key')?.value.trim()        || '',
        emailjs_template_id_lowstock: document.getElementById('ejs-template-lowstock')?.value.trim() || '',
        emailjs_template_id_expiry:   document.getElementById('ejs-template-expiry')?.value.trim()   || '',
        email_alerts_enabled:         'true'
      };
      Object.assign(window.AppState.settings, tempSettings);
      window._appSettings = window.AppState.settings;

      const result = await sendTestEmail();
      if (result.success) {
        showToast('Test email sent successfully!', 'success');
      } else {
        showToast(result.error || 'Test email failed.', 'error');
      }
    } finally {
      btnText?.classList.remove('hidden');
      btnSpinner?.classList.add('hidden');
    }
  });

  // Form submit
  document.getElementById('notif-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btnText    = document.querySelector('#notif-save-btn .btn-text');
    const btnSpinner = document.querySelector('#notif-save-btn .btn-spinner');

    btnText?.classList.add('hidden');
    btnSpinner?.classList.remove('hidden');

    try {
      const updates = {
        email_alerts_enabled:           document.getElementById('email-enabled-toggle')?.checked ? 'true' : 'false',
        emailjs_service_id:             document.getElementById('ejs-service-id')?.value.trim()       || '',
        emailjs_public_key:             document.getElementById('ejs-public-key')?.value.trim()        || '',
        emailjs_template_id_lowstock:   document.getElementById('ejs-template-lowstock')?.value.trim() || '',
        emailjs_template_id_expiry:     document.getElementById('ejs-template-expiry')?.value.trim()   || ''
      };

      for (const [key, value] of Object.entries(updates)) {
        await setSetting(key, value);
      }

      Object.assign(window.AppState.settings, updates);
      window._appSettings = window.AppState.settings;

      showToast('Notification settings saved.', 'success');

    } catch (err) {
      console.error('[Settings] Notification save error:', err);
      showToast('Failed to save notification settings.', 'error');
    } finally {
      btnText?.classList.remove('hidden');
      btnSpinner?.classList.add('hidden');
    }
  });
}

// ─── TAB 4: LICENCE ───────────────────────────────────────────────────────────
function renderLicenceTab(area) {
  const activation = getActivationRecord();

  area.innerHTML = `
    <div class="card" style="max-width:600px;">
      <div class="card-header">
        <h3 class="card-title"><i class="fa-solid fa-shield-halved"></i> Licence Information</h3>
      </div>

      ${activation ? `
        <div style="display:flex;flex-direction:column;gap:var(--space-md);">
          <div class="stat-row">
            <div class="stat-row-item">
              <span class="stat-row-label">Business Name</span>
              <span class="font-semibold" style="font-size:var(--text-base);">${sanitize(activation.business_name)}</span>
            </div>
            <div class="stat-row-item">
              <span class="stat-row-label">Activated On</span>
              <span class="font-semibold" style="font-size:var(--text-base);">${formatDate(activation.activated_at)}</span>
            </div>
            <div class="stat-row-item">
              <span class="stat-row-label">Status</span>
              <span class="badge badge-success"><i class="fa-solid fa-circle-check"></i> Active</span>
            </div>
          </div>

          <div class="form-print-row" style="margin-top:var(--space-md);">
            <span class="form-print-label">App Version:</span>
            <span>${sanitize(AppConfig.APP_VERSION)}</span>
          </div>
          <div class="form-print-row">
            <span class="form-print-label">Release Date:</span>
            <span>${sanitize(AppConfig.APP_RELEASE_DATE)}</span>
          </div>
        </div>

        <div style="margin-top:var(--space-xl);padding-top:var(--space-xl);border-top:1px solid var(--color-border);">
          <h4 style="margin-bottom:var(--space-sm);font-size:var(--text-base);font-weight:600;">Deactivate Licence</h4>
          <p class="text-sm text-muted" style="margin-bottom:var(--space-md);">
            Deactivating will lock the application and require re-entry of your licence key.
            Use this only when reinstalling or transferring to a different device.
            Your data is preserved.
          </p>
          <button class="btn btn-danger" id="deactivate-licence-btn">
            <i class="fa-solid fa-power-off"></i> Deactivate Licence
          </button>
        </div>
      ` : `
        <div class="alert alert-warning">
          <i class="fa-solid fa-triangle-exclamation"></i>
          No licence activation record found. Please reload and activate.
        </div>
      `}
    </div>
  `;

  document.getElementById('deactivate-licence-btn')?.addEventListener('click', () => {
    showConfirmModal({
      title:       'Deactivate Licence',
      message:     'Are you sure you want to deactivate the licence? The application will be locked and require your licence key to reactivate. Your data will not be affected.',
      confirmText: 'Deactivate',
      confirmClass:'btn-danger',
      onConfirm:   () => {
        clearActivationRecord();
        showToast('Licence deactivated. Reloading…', 'info');
        setTimeout(() => window.location.reload(), 1500);
      }
    });
  });
}

// ─── TAB 5: CHANGE PASSWORD ───────────────────────────────────────────────────
function renderPasswordTab(area, user) {
  area.innerHTML = `
    <div class="card" style="max-width:520px;">
      <div class="card-header">
        <h3 class="card-title"><i class="fa-solid fa-key"></i> Change Password</h3>
      </div>

      <form id="change-pwd-form" novalidate autocomplete="off">
        <div class="form-group">
          <label class="form-label" for="cp-current">Current Password <span class="required">*</span></label>
          <div class="input-icon-wrap">
            <input class="form-input" type="password" id="cp-current"
              placeholder="Your current password" required
              autocomplete="current-password" />
            <i class="fa-solid fa-lock input-icon"></i>
          </div>
          <span class="form-error-text" id="cp-current-err"></span>
        </div>

        <div class="form-group">
          <label class="form-label" for="cp-new">New Password <span class="required">*</span></label>
          <div class="input-icon-wrap">
            <input class="form-input" type="password" id="cp-new"
              placeholder="Min 8 chars, upper, number, symbol" required
              autocomplete="new-password" />
            <i class="fa-solid fa-lock input-icon"></i>
            <button type="button" class="password-toggle" id="cp-new-toggle">
              <i class="fa-solid fa-eye"></i>
            </button>
          </div>
          <div class="progress-bar-wrap" id="cp-strength-wrap" style="margin-top:var(--space-xs);">
            <div class="progress-bar" id="cp-strength-bar"></div>
          </div>
          <span class="form-helper-text" id="cp-strength-label"></span>
          <span class="form-error-text" id="cp-new-err"></span>
        </div>

        <div class="form-group">
          <label class="form-label" for="cp-confirm">Confirm New Password <span class="required">*</span></label>
          <div class="input-icon-wrap">
            <input class="form-input" type="password" id="cp-confirm"
              placeholder="Repeat new password" required
              autocomplete="new-password" />
            <i class="fa-solid fa-lock input-icon"></i>
          </div>
          <span class="form-error-text" id="cp-confirm-err"></span>
        </div>

        <div id="cp-error" class="alert alert-danger hidden" role="alert"></div>

        <div style="display:flex;justify-content:flex-end;">
          <button type="submit" class="btn btn-primary" id="change-pwd-btn">
            <span class="btn-text"><i class="fa-solid fa-floppy-disk"></i> Change Password</span>
            <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
          </button>
        </div>
      </form>
    </div>
  `;

  // Password visibility toggle
  document.getElementById('cp-new-toggle')?.addEventListener('click', () => {
    const input    = document.getElementById('cp-new');
    const icon     = document.querySelector('#cp-new-toggle i');
    const isText   = input.type === 'text';
    input.type     = isText ? 'password' : 'text';
    icon.className = isText ? 'fa-solid fa-eye' : 'fa-solid fa-eye-slash';
  });

  // Strength meter
  document.getElementById('cp-new')?.addEventListener('input', (e) => {
    const val        = e.target.value;
    const bar        = document.getElementById('cp-strength-bar');
    const label      = document.getElementById('cp-strength-label');
    if (!val) {
      if (bar)   bar.className   = 'progress-bar';
      if (label) label.textContent = '';
      return;
    }
    const result = validatePasswordStrength(val);
    if (bar)   bar.className   = `progress-bar strength-${result.level}`;
    if (label) {
      label.textContent = result.level
        ? result.level.charAt(0).toUpperCase() + result.level.slice(1)
        : '';
      label.style.color = result.level === 'strong' ? 'var(--color-success)'
        : result.level === 'good' ? 'var(--color-info)'
        : 'var(--color-warning)';
    }
  });

  // Form submit
  document.getElementById('change-pwd-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const currentInput = document.getElementById('cp-current');
    const newInput     = document.getElementById('cp-new');
    const confirmInput = document.getElementById('cp-confirm');
    const currentErr   = document.getElementById('cp-current-err');
    const newErr       = document.getElementById('cp-new-err');
    const confirmErr   = document.getElementById('cp-confirm-err');
    const errorBox     = document.getElementById('cp-error');
    const btnText      = document.querySelector('#change-pwd-btn .btn-text');
    const btnSpinner   = document.querySelector('#change-pwd-btn .btn-spinner');

    [currentErr, newErr, confirmErr].forEach(el => { if (el) el.textContent = ''; });
    if (errorBox) errorBox.classList.add('hidden');
    [currentInput, newInput, confirmInput].forEach(el => el?.classList.remove('is-invalid'));

    const current = currentInput?.value || '';
    const newPwd  = newInput?.value     || '';
    const confirm = confirmInput?.value || '';

    let hasError = false;

    if (!current) {
      if (currentErr) currentErr.textContent = 'Current password is required.';
      currentInput?.classList.add('is-invalid');
      hasError = true;
    }

    if (!newPwd) {
      if (newErr) newErr.textContent = 'New password is required.';
      newInput?.classList.add('is-invalid');
      hasError = true;
    } else {
      const strength = validatePasswordStrength(newPwd);
      if (!strength.valid) {
        if (newErr) newErr.textContent = strength.message;
        newInput?.classList.add('is-invalid');
        hasError = true;
      }
    }

    if (newPwd && confirm !== newPwd) {
      if (confirmErr) confirmErr.textContent = 'Passwords do not match.';
      confirmInput?.classList.add('is-invalid');
      hasError = true;
    }

    if (hasError) return;

    btnText?.classList.add('hidden');
    btnSpinner?.classList.remove('hidden');

    try {
      const result = await changePassword(current, newPwd);

      if (result.success) {
        showToast('Password changed successfully!', 'success');
        document.getElementById('change-pwd-form')?.reset();
        const bar   = document.getElementById('cp-strength-bar');
        const label = document.getElementById('cp-strength-label');
        if (bar)   bar.className   = 'progress-bar';
        if (label) label.textContent = '';

        await writeAuditLog({
          action:      'update',
          entity_type: 'users',
          entity_id:   user.id,
          new_values:  { changed_field: 'password' }
        });
      } else {
        if (errorBox) {
          errorBox.textContent = result.error || 'Failed to change password.';
          errorBox.classList.remove('hidden');
        }
        currentInput?.focus();
      }
    } catch (err) {
      console.error('[Settings] Change password error:', err);
      if (errorBox) {
        errorBox.textContent = 'A system error occurred. Please try again.';
        errorBox.classList.remove('hidden');
      }
    } finally {
      btnText?.classList.remove('hidden');
      btnSpinner?.classList.add('hidden');
    }
  });
}

// ─── TAB 6: DATA MANAGEMENT ───────────────────────────────────────────────────
function renderDataTab(area) {
  area.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:var(--space-xl);">

      <!-- Export -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><i class="fa-solid fa-download"></i> Export All Data</h3>
        </div>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-lg);">
          Download a complete backup of all application data as a JSON file.
          This can be used to restore data or migrate to a new installation.
          Note: passwords are excluded from exports for security.
        </p>
        <button class="btn btn-primary" id="export-data-btn">
          <span class="btn-text"><i class="fa-solid fa-file-arrow-down"></i> Download Backup</span>
          <span class="btn-spinner hidden"><i class="fa-solid fa-circle-notch fa-spin"></i></span>
        </button>
      </div>

      <!-- Import -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><i class="fa-solid fa-upload"></i> Import Data</h3>
        </div>
        <div class="alert alert-warning" style="margin-bottom:var(--space-lg);">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <strong>Warning:</strong> Importing data will overwrite all existing data. This cannot be undone.
          All users will be given a temporary password and must change it on login.
        </div>
        <div style="display:flex;gap:var(--space-md);align-items:center;">
          <label class="btn btn-secondary" style="cursor:pointer;">
            <i class="fa-solid fa-file-import"></i> Select Backup File
            <input type="file" id="import-file-input" accept=".json" style="display:none;" />
          </label>
          <span id="import-file-name" class="text-sm text-muted"></span>
        </div>
        <div id="import-validation-result" style="margin-top:var(--space-lg);"></div>
      </div>

      <!-- Clear All Data -->
      <div class="card" style="border-color:var(--color-danger);">
        <div class="card-header">
          <h3 class="card-title" style="color:var(--color-danger);">
            <i class="fa-solid fa-skull-crossbones"></i> Clear All Data
          </h3>
        </div>
        <p class="text-sm text-muted" style="margin-bottom:var(--space-lg);">
          Permanently delete all products, sales, stock movements, users, and settings.
          The licence activation will be preserved. The default admin account will be re-created.
          This action is irreversible.
        </p>
        <button class="btn btn-danger" id="clear-data-btn">
          <i class="fa-solid fa-trash-can"></i> Clear All Application Data
        </button>
      </div>

    </div>
  `;

  // Export
  document.getElementById('export-data-btn')?.addEventListener('click', async () => {
    const btnText    = document.querySelector('#export-data-btn .btn-text');
    const btnSpinner = document.querySelector('#export-data-btn .btn-spinner');

    btnText?.classList.add('hidden');
    btnSpinner?.classList.remove('hidden');

    try {
      const backup = await exportAllData();
      const date   = new Date().toISOString().slice(0, 10);
      exportJSON(backup, `Stockdity-backup-${date}`);
      showToast('Backup downloaded successfully.', 'success');
    } catch (err) {
      console.error('[Settings] Export error:', err);
      showToast('Export failed.', 'error');
    } finally {
      btnText?.classList.remove('hidden');
      btnSpinner?.classList.add('hidden');
    }
  });

  // Import
  document.getElementById('import-file-input')?.addEventListener('change', async (e) => {
    const file    = e.target.files[0];
    const nameEl  = document.getElementById('import-file-name');
    const resultEl= document.getElementById('import-validation-result');

    if (!file) return;
    if (nameEl) nameEl.textContent = file.name;

    try {
      const text   = await file.text();
      const backup = JSON.parse(text);
      const { valid, errors } = validateBackupStructure(backup);

      if (!valid) {
        if (resultEl) {
          resultEl.innerHTML = `
            <div class="alert alert-danger">
              <i class="fa-solid fa-xmark"></i>
              <div>
                <strong>Invalid backup file:</strong>
                <ul style="margin:var(--space-xs) 0 0 var(--space-lg);">
                  ${errors.map(err => `<li>${sanitize(err)}</li>`).join('')}
                </ul>
              </div>
            </div>
          `;
        }
        return;
      }

      const productCount  = backup.products?.length  || 0;
      const saleCount     = backup.sales?.length     || 0;
      const userCount     = backup.users?.length     || 0;

      if (resultEl) {
        resultEl.innerHTML = `
          <div class="alert alert-success" style="margin-bottom:var(--space-md);">
            <i class="fa-solid fa-circle-check"></i>
            Valid backup file. Exported at: ${sanitize(backup._meta?.exported_at || 'unknown')}
          </div>
          <div class="stat-row" style="margin-bottom:var(--space-md);">
            <div class="stat-row-item">
              <span class="stat-row-label">Products</span>
              <span class="font-bold">${productCount}</span>
            </div>
            <div class="stat-row-item">
              <span class="stat-row-label">Sales</span>
              <span class="font-bold">${saleCount}</span>
            </div>
            <div class="stat-row-item">
              <span class="stat-row-label">Users</span>
              <span class="font-bold">${userCount}</span>
            </div>
          </div>
          <button class="btn btn-danger" id="confirm-import-btn">
            <i class="fa-solid fa-file-import"></i> Import & Overwrite All Data
          </button>
        `;

        document.getElementById('confirm-import-btn')?.addEventListener('click', () => {
          showConfirmModal({
            title:       'Import Data',
            message:     'This will permanently replace all current data with the backup. All users will need to reset their passwords. Are you absolutely sure?',
            confirmText: 'Yes, Import',
            confirmClass:'btn-danger',
            onConfirm:   async () => {
              try {
                showToast('Importing data…', 'info');
                await importAllData(backup);
                showToast('Data imported successfully. Reloading…', 'success');

                // Clear session and reload
                sessionStorage.clear();
                setTimeout(() => window.location.reload(), 1500);
              } catch (err) {
                console.error('[Settings] Import error:', err);
                showToast('Import failed: ' + (err.message || 'Unknown error'), 'error');
              }
            }
          });
        });
      }

    } catch (err) {
      if (resultEl) {
        resultEl.innerHTML = `
          <div class="alert alert-danger">
            <i class="fa-solid fa-xmark"></i>
            Failed to parse file. Please ensure it is a valid Stockdity JSON backup.
          </div>
        `;
      }
    }
  });

  // Clear all data
  document.getElementById('clear-data-btn')?.addEventListener('click', () => {
    showTypedConfirmModal({
      title:       'Clear All Application Data',
      message:     'This will permanently delete ALL products, sales, stock movements, notifications, audit logs, and user accounts. The default admin will be recreated. Type DELETE to confirm.',
      confirmWord: 'DELETE',
      onConfirm:   async () => {
        try {
          showToast('Clearing all data…', 'info');
          await clearAllData();
          showToast('All data cleared. The page will now reload.', 'success');

          await writeAuditLog({
            action:      'delete',
            entity_type: 'system',
            entity_id:   0,
            new_values:  { action: 'clear_all_data' }
          });

          sessionStorage.clear();
          setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
          console.error('[Settings] Clear data error:', err);
          showToast('Failed to clear data: ' + (err.message || 'Unknown error'), 'error');
        }
      }
    });
  });
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export { init, destroy };
