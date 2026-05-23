/**
 * Stockdity IMS — Utility Helpers
 * Pure helper functions: date formatting, currency formatting, SKU generation,
 * CSV export, debounce, throttle, validation, and miscellaneous utilities.
 * No side effects, no DOM access, no imports from other app modules.
 */

import AppConfig from '../../config.js';

// ─── CURRENCY FORMATTING ──────────────────────────────────────────────────────
/**
 * Format a number as a currency string using the app's currency symbol.
 * @param {number}  amount
 * @param {string}  [symbol]   - Override currency symbol (defaults to AppConfig)
 * @param {number}  [decimals] - Decimal places (default 2)
 * @returns {string}
 */
function formatCurrency(amount, symbol = null, decimals = 2) {
  const currencySymbol = symbol || _getCurrencySymbol();
  const num = Number(amount);
  if (isNaN(num)) return `${currencySymbol}0.00`;

  const formatted = num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });

  return `${currencySymbol}${formatted}`;
}

/**
 * Parse a currency string back to a float.
 * Strips any non-numeric characters except '.' and '-'.
 * @param {string} str
 * @returns {number}
 */
function parseCurrency(str) {
  if (typeof str === 'number') return str;
  return parseFloat(String(str).replace(/[^0-9.\-]/g, '')) || 0;
}

/**
 * Get the stored currency symbol from app settings (cached in memory).
 * Falls back to AppConfig default.
 * @returns {string}
 */
function _getCurrencySymbol() {
  try {
    // Try to read from a globally cached settings object if available
    return window._appSettings?.currency_symbol || AppConfig.DEFAULT_CURRENCY_SYMBOL;
  } catch {
    return AppConfig.DEFAULT_CURRENCY_SYMBOL;
  }
}

// ─── DATE FORMATTING ──────────────────────────────────────────────────────────
/**
 * Format a date string or Date object using the app's date format setting.
 * @param {string|Date|null} date
 * @param {string} [format]  - 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'
 * @returns {string}
 */
function formatDate(date, format = null) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '—';

  const usedFormat = format
    || window._appSettings?.date_format
    || AppConfig.DEFAULT_DATE_FORMAT;

  const day   = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year  = String(d.getFullYear());

  switch (usedFormat) {
    case 'MM/DD/YYYY': return `${month}/${day}/${year}`;
    case 'YYYY-MM-DD': return `${year}-${month}-${day}`;
    case 'DD/MM/YYYY':
    default:           return `${day}/${month}/${year}`;
  }
}

/**
 * Format a date with time component.
 * @param {string|Date|null} date
 * @returns {string}  e.g. "15/05/2024 14:32"
 */
function formatDateTime(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '—';

  const hours   = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(d)} ${hours}:${minutes}`;
}

/**
 * Format a date as a short label for chart axes.
 * @param {string|Date} date
 * @returns {string}  e.g. "15 May"
 */
function formatDateShort(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * Return a human-readable "time ago" string.
 * @param {string|Date} date
 * @returns {string}  e.g. "3 minutes ago", "2 days ago"
 */
function timeSince(date) {
  if (!date) return '';
  const d       = date instanceof Date ? date : new Date(date);
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);

  if (isNaN(seconds)) return '';
  if (seconds < 5)    return 'just now';
  if (seconds < 60)   return `${seconds} seconds ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)   return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24)     return `${hours} hour${hours !== 1 ? 's' : ''} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7)       return `${days} day${days !== 1 ? 's' : ''} ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5)      return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;

  const months = Math.floor(days / 30);
  if (months < 12)    return `${months} month${months !== 1 ? 's' : ''} ago`;

  const years = Math.floor(days / 365);
  return `${years} year${years !== 1 ? 's' : ''} ago`;
}

/**
 * Get days remaining until an expiry date.
 * Negative means already expired.
 * @param {string|Date|null} expiryDate
 * @returns {number|null}
 */
function daysUntilExpiry(expiryDate) {
  if (!expiryDate) return null;
  const exp  = new Date(expiryDate);
  const now  = new Date();
  now.setHours(0, 0, 0, 0);
  exp.setHours(0, 0, 0, 0);
  return Math.floor((exp - now) / (1000 * 60 * 60 * 24));
}

/**
 * Return an expiry label string with colour class.
 * @param {string|null} expiryDate
 * @returns {{ label: string, cssClass: string }}
 */
function expiryStatus(expiryDate) {
  if (!expiryDate) return { label: 'No expiry', cssClass: 'expiry-ok' };

  const days = daysUntilExpiry(expiryDate);

  if (days === null) return { label: 'No expiry', cssClass: 'expiry-ok' };
  if (days < 0)      return { label: `Expired ${Math.abs(days)}d ago`, cssClass: 'expiry-expired' };
  if (days === 0)    return { label: 'Expires today!',                  cssClass: 'expiry-critical' };
  if (days <= 7)     return { label: `Expires in ${days}d`,             cssClass: 'expiry-critical' };
  if (days <= 30)    return { label: `Expires in ${days}d`,             cssClass: 'expiry-warning' };
  return               { label: `Expires ${formatDate(expiryDate)}`,    cssClass: 'expiry-ok' };
}

/**
 * Get the start and end Date objects for a date range preset.
 * @param {string} preset - 'today'|'yesterday'|'this_week'|'last_week'|
 *                          'this_month'|'last_month'|'last_30'|'last_90'|'this_year'
 * @returns {{ start: Date, end: Date }}
 */
function getDateRange(preset) {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (preset) {
    case 'today':
      return { start: today, end: new Date(today.getTime() + 86399999) };

    case 'yesterday': {
      const y = new Date(today);
      y.setDate(y.getDate() - 1);
      return { start: y, end: new Date(y.getTime() + 86399999) };
    }

    case 'this_week': {
      const dayOfWeek = today.getDay(); // 0=Sun
      const start = new Date(today);
      start.setDate(today.getDate() - dayOfWeek);
      return { start, end: new Date(today.getTime() + 86399999) };
    }

    case 'last_week': {
      const dayOfWeek = today.getDay();
      const end   = new Date(today);
      end.setDate(today.getDate() - dayOfWeek - 1);
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      return { start, end: new Date(end.getTime() + 86399999) };
    }

    case 'this_month':
      return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end:   new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
      };

    case 'last_month':
      return {
        start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
        end:   new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999)
      };

    case 'last_30': {
      const start = new Date(today);
      start.setDate(today.getDate() - 29);
      return { start, end: new Date(today.getTime() + 86399999) };
    }

    case 'last_90': {
      const start = new Date(today);
      start.setDate(today.getDate() - 89);
      return { start, end: new Date(today.getTime() + 86399999) };
    }

    case 'this_year':
      return {
        start: new Date(now.getFullYear(), 0, 1),
        end:   new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)
      };

    default:
      return { start: today, end: new Date(today.getTime() + 86399999) };
  }
}

// ─── SKU GENERATION ───────────────────────────────────────────────────────────
/**
 * Generate a product SKU in the format: CATCODE-XXXX
 * where CATCODE is the first 3 letters of the category name (uppercase)
 * and XXXX is a random 4-digit number.
 * @param {string} [categoryName]
 * @returns {string}  e.g. "GEN-7342"
 */
function generateSKU(categoryName = '') {
  const prefix = categoryName
    ? categoryName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X')
    : 'PRD';

  const suffix = String(Math.floor(1000 + Math.random() * 9000));
  return `${prefix}-${suffix}`;
}

/**
 * Generate a unique ID string (not cryptographically secure — for UI purposes only).
 * @returns {string}
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── PROFIT MARGIN ────────────────────────────────────────────────────────────
/**
 * Calculate the profit margin percentage.
 * @param {number} costPrice
 * @param {number} sellingPrice
 * @returns {number}  Percentage (e.g. 25.5 means 25.5%)
 */
function calculateProfitMargin(costPrice, sellingPrice) {
  const cost   = Number(costPrice)   || 0;
  const sell   = Number(sellingPrice) || 0;
  if (sell <= 0) return 0;
  return ((sell - cost) / sell) * 100;
}

/**
 * Calculate gross profit amount.
 * @param {number} costPrice
 * @param {number} sellingPrice
 * @param {number} [quantity]
 * @returns {number}
 */
function calculateProfit(costPrice, sellingPrice, quantity = 1) {
  return (sellingPrice - costPrice) * quantity;
}

// ─── VALIDATION ───────────────────────────────────────────────────────────────
/**
 * Validate a plain object against an array of rules.
 * @param {Object} data
 * @param {Array}  rules - [{ field, type, value, message }]
 * @returns {{ isValid: boolean, errors: Object }}
 *
 * Rule types:
 *   required    — field is non-empty string / non-null
 *   minLength   — string length >= value
 *   maxLength   — string length <= value
 *   numeric     — is a finite number
 *   positiveNum — is a number > 0
 *   nonNegative — is a number >= 0
 *   email       — valid email format
 *   pattern     — matches regex in value
 *   custom      — value is a function(fieldValue, data) => bool
 *   match       — field === data[value] (for confirm password)
 */
function validate(rules, data) {
  const errors = {};

  for (const rule of rules) {
    const { field, type, value, message } = rule;
    const fieldValue = data[field];

    let failed = false;

    switch (type) {
      case 'required':
        failed = fieldValue === null
              || fieldValue === undefined
              || String(fieldValue).trim() === '';
        break;

      case 'minLength':
        failed = String(fieldValue || '').length < value;
        break;

      case 'maxLength':
        failed = String(fieldValue || '').length > value;
        break;

      case 'numeric':
        failed = fieldValue !== '' && fieldValue !== null && isNaN(Number(fieldValue));
        break;

      case 'positiveNum':
        failed = !(Number(fieldValue) > 0);
        break;

      case 'nonNegative':
        failed = !(Number(fieldValue) >= 0);
        break;

      case 'email':
        failed = fieldValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fieldValue));
        break;

      case 'pattern':
        failed = fieldValue && !new RegExp(value).test(String(fieldValue));
        break;

      case 'custom':
        if (typeof value === 'function') {
          failed = !value(fieldValue, data);
        }
        break;

      case 'match':
        failed = fieldValue !== data[value];
        break;

      default:
        break;
    }

    if (failed && !errors[field]) {
      errors[field] = message || `${field} is invalid.`;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Validate an email address format.
 * @param {string} email
 * @returns {boolean}
 */
function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

/**
 * Validate a phone number (very loose — allows +, spaces, dashes, parens, digits).
 * @param {string} phone
 * @returns {boolean}
 */
function validatePhone(phone) {
  return /^[\d\s\+\-\(\)]{7,20}$/.test(String(phone || ''));
}

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
/**
 * Convert an array of objects to a CSV string.
 * @param {Array}    data     - Array of plain objects
 * @param {string[]} [columns] - Column keys to include (default: all keys from first row)
 * @param {Object}   [headers] - Column key → header label map
 * @returns {string}
 */
function objectsToCSV(data, columns = null, headers = {}) {
  if (!data || !data.length) return '';

  const cols = columns || Object.keys(data[0]);

  const headerRow = cols
    .map(col => csvEscape(headers[col] || col))
    .join(',');

  const rows = data.map(row =>
    cols.map(col => csvEscape(row[col] ?? '')).join(',')
  );

  return [headerRow, ...rows].join('\r\n');
}

/**
 * Escape a value for CSV output.
 * Wraps in quotes if it contains commas, quotes, or newlines.
 * @param {any} value
 * @returns {string}
 */
function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Trigger a file download from a string of content.
 * @param {string} content
 * @param {string} filename
 * @param {string} [mimeType]
 */
function downloadFile(content, filename, mimeType = 'text/csv;charset=utf-8;') {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();

  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

/**
 * Export data as a CSV file download.
 * @param {Array}    data
 * @param {string}   filename      - Without extension
 * @param {string[]} [columns]
 * @param {Object}   [headers]
 */
function exportCSV(data, filename, columns = null, headers = {}) {
  const csv = objectsToCSV(data, columns, headers);
  downloadFile(csv, `${filename}.csv`, 'text/csv;charset=utf-8;');
}

/**
 * Export data as a JSON file download.
 * @param {any}    data
 * @param {string} filename  - Without extension
 */
function exportJSON(data, filename) {
  const json = JSON.stringify(data, null, 2);
  downloadFile(json, `${filename}.json`, 'application/json;charset=utf-8;');
}

// ─── DEBOUNCE & THROTTLE ──────────────────────────────────────────────────────
/**
 * Return a debounced version of a function.
 * The function will only be called after `delay` ms of no calls.
 * @param {Function} fn
 * @param {number}   delay - Milliseconds
 * @returns {Function}
 */
function debounce(fn, delay = AppConfig.SEARCH_DEBOUNCE_MS) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Return a throttled version of a function.
 * The function will be called at most once per `limit` ms.
 * @param {Function} fn
 * @param {number}   limit - Milliseconds
 * @returns {Function}
 */
function throttle(fn, limit = 16) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      fn.apply(this, args);
    }
  };
}

// ─── SORTING ──────────────────────────────────────────────────────────────────
/**
 * Sort an array of objects by a key.
 * Returns a new sorted array (does not mutate the original).
 * @param {Array}   arr
 * @param {string}  key
 * @param {string}  [dir] - 'asc' | 'desc'
 * @returns {Array}
 */
function sortBy(arr, key, dir = 'asc') {
  return [...arr].sort((a, b) => {
    let valA = a[key];
    let valB = b[key];

    // Handle null / undefined
    if (valA == null) valA = '';
    if (valB == null) valB = '';

    // Numeric sort
    if (typeof valA === 'number' && typeof valB === 'number') {
      return dir === 'asc' ? valA - valB : valB - valA;
    }

    // Date string sort
    if (isDateString(valA) && isDateString(valB)) {
      return dir === 'asc'
        ? new Date(valA) - new Date(valB)
        : new Date(valB) - new Date(valA);
    }

    // String sort (locale-aware)
    const cmp = String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
  });
}

/**
 * Detect whether a string looks like an ISO date.
 * @param {string} str
 * @returns {boolean}
 */
function isDateString(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}/.test(str);
}

// ─── FILTERING & SEARCHING ────────────────────────────────────────────────────
/**
 * Filter an array of objects by a search term across specified keys.
 * Case-insensitive, accent-insensitive.
 * @param {Array}    arr
 * @param {string}   term
 * @param {string[]} keys  - Which fields to search
 * @returns {Array}
 */
function filterBySearch(arr, term, keys) {
  if (!term || !term.trim()) return arr;

  const lower = term.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return arr.filter(item =>
    keys.some(key => {
      const val = String(item[key] ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return val.includes(lower);
    })
  );
}

/**
 * Client-side paginate an array.
 * @param {Array}  arr
 * @param {number} page     - 1-based
 * @param {number} pageSize
 * @returns {{ data: Array, total: number, totalPages: number }}
 */
function paginate(arr, page, pageSize) {
  const total      = arr.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage   = Math.min(Math.max(1, page), totalPages);
  const start      = (safePage - 1) * pageSize;
  const data       = arr.slice(start, start + pageSize);
  return { data, total, totalPages, page: safePage };
}

// ─── NUMBER HELPERS ───────────────────────────────────────────────────────────
/**
 * Clamp a number between min and max.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Round a number to a given number of decimal places.
 * @param {number} value
 * @param {number} [places]
 * @returns {number}
 */
function round(value, places = 2) {
  const factor = Math.pow(10, places);
  return Math.round(value * factor) / factor;
}

/**
 * Format a large number with abbreviated suffix.
 * @param {number} n
 * @returns {string}  e.g. "1.2K", "3.4M"
 */
function abbreviateNumber(n) {
  if (n >= 1_000_000) return `${round(n / 1_000_000, 1)}M`;
  if (n >= 1_000)     return `${round(n / 1_000,     1)}K`;
  return String(round(n, 0));
}

// ─── STRING HELPERS ───────────────────────────────────────────────────────────
/**
 * Capitalise the first letter of a string.
 * @param {string} str
 * @returns {string}
 */
function capitalise(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Convert a camelCase or snake_case string to Title Case.
 * @param {string} str
 * @returns {string}
 */
function toTitleCase(str) {
  return String(str)
    .replace(/[_-]/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .split(' ')
    .map(word => capitalise(word.toLowerCase()))
    .join(' ');
}

/**
 * Truncate a string to a maximum length with an ellipsis.
 * @param {string} str
 * @param {number} [maxLength]
 * @returns {string}
 */
function truncate(str, maxLength = 50) {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Strip all HTML tags from a string.
 * @param {string} html
 * @returns {string}
 */
function stripHTML(html) {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent || el.innerText || '';
}

// ─── OBJECT HELPERS ───────────────────────────────────────────────────────────
/**
 * Deep clone a plain object or array using JSON serialisation.
 * Not suitable for objects containing functions, Dates (will be strings), or circular refs.
 * @param {any} obj
 * @returns {any}
 */
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Pick only the specified keys from an object.
 * @param {Object}   obj
 * @param {string[]} keys
 * @returns {Object}
 */
function pick(obj, keys) {
  return Object.fromEntries(
    keys.filter(k => k in obj).map(k => [k, obj[k]])
  );
}

/**
 * Omit specified keys from an object.
 * @param {Object}   obj
 * @param {string[]} keys
 * @returns {Object}
 */
function omit(obj, keys) {
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !keys.includes(k))
  );
}

/**
 * Check if two objects are shallowly equal.
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
function shallowEqual(a, b) {
  if (a === b) return true;
  const keysA = Object.keys(a || {});
  const keysB = Object.keys(b || {});
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => a[k] === b[k]);
}

// ─── ARRAY HELPERS ────────────────────────────────────────────────────────────
/**
 * Group an array of objects by a key.
 * @param {Array}  arr
 * @param {string} key
 * @returns {Object}  { [keyValue]: item[] }
 */
function groupBy(arr, key) {
  return arr.reduce((groups, item) => {
    const val = item[key];
    if (!groups[val]) groups[val] = [];
    groups[val].push(item);
    return groups;
  }, {});
}

/**
 * Sum an array of numbers or the values of a key across an array of objects.
 * @param {Array}          arr
 * @param {string|Function} [keyOrFn]
 * @returns {number}
 */
function sum(arr, keyOrFn = null) {
  return arr.reduce((total, item) => {
    const val = typeof keyOrFn === 'function'
      ? keyOrFn(item)
      : keyOrFn
      ? item[keyOrFn]
      : item;
    return total + (Number(val) || 0);
  }, 0);
}

/**
 * Return the unique values of an array (primitives only).
 * @param {Array} arr
 * @returns {Array}
 */
function unique(arr) {
  return [...new Set(arr)];
}

/**
 * Chunk an array into sub-arrays of a given size.
 * @param {Array}  arr
 * @param {number} size
 * @returns {Array[]}
 */
function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── RECEIPT NUMBER FORMATTER ─────────────────────────────────────────────────
/**
 * Format a sale ID as a receipt number.
 * @param {number} id
 * @returns {string}  e.g. "REC-000042"
 */
function formatReceiptNumber(id) {
  return `REC-${String(id).padStart(6, '0')}`;
}

// ─── STOCK MOVEMENT DISPLAY ───────────────────────────────────────────────────
/**
 * Return a signed quantity string for display in movement history.
 * @param {number} quantity  - Raw stored quantity (may be negative for deductions)
 * @param {string} type      - Movement type
 * @returns {string}  e.g. "+50", "-12"
 */
function formatMovementQuantity(quantity, type) {
  const deductions = ['stock_out', 'sale'];
  const num        = Math.abs(quantity);
  if (deductions.includes(type)) return `-${num}`;
  if (type === 'adjustment') return quantity >= 0 ? `+${num}` : `-${num}`;
  return `+${num}`;
}

/**
 * Return a human-readable label for a stock movement type.
 * @param {string} type
 * @returns {string}
 */
function movementTypeLabel(type) {
  const labels = {
    stock_in:   'Stock In',
    stock_out:  'Stock Out',
    adjustment: 'Adjustment',
    sale:       'Sale',
    return:     'Return'
  };
  return labels[type] || toTitleCase(type);
}

/**
 * Return a badge HTML string for a stock movement type.
 * @param {string} type
 * @returns {string}
 */
function movementTypeBadge(type) {
  const configs = {
    stock_in:   ['badge-success', 'fa-arrow-down-to-line'],
    stock_out:  ['badge-warning', 'fa-arrow-up-from-line'],
    adjustment: ['badge-info',    'fa-sliders'],
    sale:       ['badge-primary', 'fa-cash-register'],
    return:     ['badge-neutral', 'fa-rotate-left']
  };
  const [cls, icon] = configs[type] || ['badge-neutral', 'fa-question'];
  return `<span class="badge ${cls}"><i class="fa-solid ${icon}"></i> ${movementTypeLabel(type)}</span>`;
}

// ─── IMAGE VALIDATION ─────────────────────────────────────────────────────────
/**
 * Validate an image File object against the app's size and type limits.
 * @param {File}   file
 * @param {number} [maxBytes]
 * @returns {{ valid: boolean, error: string }}
 */
function validateImageFile(file, maxBytes = AppConfig.MAX_IMAGE_SIZE_BYTES) {
  if (!file) return { valid: false, error: 'No file selected.' };

  if (!AppConfig.ALLOWED_IMAGE_TYPES.includes(file.type)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed: JPG, PNG, WEBP.`
    };
  }

  if (file.size > maxBytes) {
    const maxMB = (maxBytes / 1048576).toFixed(0);
    return {
      valid: false,
      error: `File too large. Maximum size is ${maxMB}MB.`
    };
  }

  return { valid: true, error: '' };
}

/**
 * Convert a File to a base64 data URL string.
 * @param {File} file
 * @returns {Promise<string>}
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

// ─── CHART COLOUR PALETTE ─────────────────────────────────────────────────────
/**
 * Return a set of chart colours for Chart.js datasets.
 * @param {number} [count]
 * @returns {{ backgrounds: string[], borders: string[] }}
 */
function chartColors(count = 10) {
  const palette = [
    '#4F46E5', '#10B981', '#F59E0B', '#EF4444', '#3B82F6',
    '#8B5CF6', '#EC4899', '#14B8A6', '#F97316', '#6366F1'
  ];
  const backgrounds = [];
  const borders     = [];

  for (let i = 0; i < count; i++) {
    const color = palette[i % palette.length];
    backgrounds.push(color + 'CC'); // 80% opacity
    borders.push(color);
  }

  return { backgrounds, borders };
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export {
  // Currency
  formatCurrency,
  parseCurrency,

  // Dates
  formatDate,
  formatDateTime,
  formatDateShort,
  timeSince,
  daysUntilExpiry,
  expiryStatus,
  getDateRange,

  // SKU & IDs
  generateSKU,
  generateId,

  // Financial
  calculateProfitMargin,
  calculateProfit,

  // Validation
  validate,
  validateEmail,
  validatePhone,

  // CSV / Export
  objectsToCSV,
  csvEscape,
  downloadFile,
  exportCSV,
  exportJSON,

  // Async helpers
  debounce,
  throttle,

  // Data manipulation
  sortBy,
  filterBySearch,
  paginate,
  groupBy,
  sum,
  unique,
  chunk,

  // Numbers
  clamp,
  round,
  abbreviateNumber,

  // Strings
  capitalise,
  toTitleCase,
  truncate,
  stripHTML,

  // Objects
  deepClone,
  pick,
  omit,
  shallowEqual,

  // Domain-specific
  formatReceiptNumber,
  formatMovementQuantity,
  movementTypeLabel,
  movementTypeBadge,

  // Images
  validateImageFile,
  fileToBase64,

  // Charts
  chartColors
};
