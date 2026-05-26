/**
 * Stockdity IMS — Database Layer
 * Dexie.js 3.x wrapper for IndexedDB.
 * Defines all object stores, indexes, and the first-run seed function.
 */

import AppConfig from '../../config.js';
import { setEncryptionKey, deriveKey, generateSalt, isEncryptionReady, encrypt, decrypt } from './crypto.js';

// ─── DATABASE INITIALISATION ──────────────────────────────────────────────────
const db = new Dexie(AppConfig.DB_NAME);

/**
 * Schema Version 1 (original stores)
 * Version 2 (adds device_registry)
 */
db.version(1).stores({
  users:
    '++id, &email, role, is_active',

  categories:
    '++id, name',

  suppliers:
    '++id, name, is_active',

  products:
    '++id, category_id, supplier_id, &sku, is_active, expiry_date, quantity',

  stock_movements:
    '++id, product_id, user_id, type, created_at',

  sales:
    '++id, user_id, status, created_at, payment_method',

  sale_items:
    '++id, sale_id, product_id',

  notifications:
    '++id, user_id, type, is_read, created_at',

  audit_logs:
    '++id, user_id, entity_type, created_at',

  app_settings:
    'key'
});

// Version 2: adds device_registry store
db.version(2).stores({
  users:
    '++id, &email, role, is_active',

  categories:
    '++id, name',

  suppliers:
    '++id, name, is_active',

  products:
    '++id, category_id, supplier_id, &sku, is_active, expiry_date, quantity',

  stock_movements:
    '++id, product_id, user_id, type, created_at',

  sales:
    '++id, user_id, status, created_at, payment_method',

  sale_items:
    '++id, sale_id, product_id',

  notifications:
    '++id, user_id, type, is_read, created_at',

  audit_logs:
    '++id, user_id, entity_type, created_at',

  app_settings:
    'key',

  device_registry:
    '++id, &device_id, company_hash, registered_at'
});

// ─── ENCRYPTION HOOKS (apply after schema definition) ─────────────────────
async function encryptRecord(record) {
  if (!isEncryptionReady()) return record;
  const { id, ...rest } = record;
  const encryptedValue = await encrypt(rest);
  return { id, _encrypted: encryptedValue };
}

async function decryptRecord(record) {
  if (!record || !record._encrypted) return record;
  const plain = await decrypt(record._encrypted);
  return { ...plain, id: record.id };
}

const sensitiveTables = ['users', 'products', 'sales', 'stock_movements'];
for (const tableName of sensitiveTables) {
  const table = db[tableName];
  if (!table) continue;

  table.hook('creating', async (primKey, obj, trans) => {
    if (!isEncryptionReady()) return;
    const encrypted = await encryptRecord(obj);
    for (const [key, val] of Object.entries(encrypted)) {
      obj[key] = val;
    }
  });

  table.hook('updating', async (modifications, primKey, obj, trans) => {
    if (!isEncryptionReady()) return;
    const encrypted = await encryptRecord(modifications);
    for (const key of Object.keys(modifications)) {
      delete modifications[key];
    }
    Object.assign(modifications, encrypted);
  });

  table.hook('reading', async (obj) => {
    if (!obj || !obj._encrypted) return obj;
    return decryptRecord(obj);
  });
}

// ─── TYPE DEFINITIONS (JSDoc for IDE support) ─────────────────────────────────
/**
 * @typedef {Object} User
 * @property {number}  id
 * @property {string}  name
 * @property {string}  email
 * @property {string}  password_hash
 * @property {string}  password_salt
 * @property {string}  role              - 'admin' | 'manager' | 'staff'
 * @property {boolean} is_active
 * @property {string}  avatar_initials
 * @property {boolean} force_password_change
 * @property {string|null} last_login    - ISO string
 * @property {string}  created_at        - ISO string
 */

/**
 * @typedef {Object} Category
 * @property {number} id
 * @property {string} name
 * @property {string} description
 * @property {string} created_at
 */

/**
 * @typedef {Object} Supplier
 * @property {number}  id
 * @property {string}  name
 * @property {string}  contact_person
 * @property {string}  phone
 * @property {string}  email
 * @property {string}  address
 * @property {boolean} is_active
 * @property {string}  created_at
 */

/**
 * @typedef {Object} Product
 * @property {number}       id
 * @property {number|null}  category_id
 * @property {number|null}  supplier_id
 * @property {string}       name
 * @property {string}       sku
 * @property {string}       barcode
 * @property {string}       description
 * @property {string}       unit
 * @property {number}       cost_price
 * @property {number}       selling_price
 * @property {number}       quantity
 * @property {number}       low_stock_threshold
 * @property {string|null}  expiry_date   - ISO date string YYYY-MM-DD
 * @property {string|null}  image_base64
 * @property {boolean}      is_active
 * @property {string}       created_at
 * @property {string}       updated_at
 */

/**
 * @typedef {Object} StockMovement
 * @property {number} id
 * @property {number} product_id
 * @property {number} user_id
 * @property {string} type - 'stock_in'|'stock_out'|'adjustment'|'sale'|'return'
 * @property {number} quantity  - positive for in, negative for out/sale
 * @property {string} reference_note
 * @property {string} created_at
 */

/**
 * @typedef {Object} Sale
 * @property {number} id
 * @property {number} user_id
 * @property {string} customer_name
 * @property {number} total_amount
 * @property {string} payment_method - 'cash'|'card'|'transfer'|'credit'
 * @property {string} notes
 * @property {string} status         - 'completed'|'voided'
 * @property {string} created_at
 */

/**
 * @typedef {Object} SaleItem
 * @property {number} id
 * @property {number} sale_id
 * @property {number} product_id
 * @property {string} product_name_snapshot
 * @property {string} product_sku_snapshot
 * @property {number} quantity
 * @property {number} unit_price
 * @property {number} subtotal
 */

/**
 * @typedef {Object} Notification
 * @property {number}      id
 * @property {number|null} user_id
 * @property {string}      type       - 'low_stock'|'expiry'|'system'
 * @property {string}      message
 * @property {number|null} product_id
 * @property {boolean}     is_read
 * @property {string}      created_at
 */

/**
 * @typedef {Object} AuditLog
 * @property {number} id
 * @property {number} user_id
 * @property {string} user_name_snapshot
 * @property {string} action  - 'create'|'update'|'delete'|'login'|'logout'|'void'
 * @property {string} entity_type
 * @property {number} entity_id
 * @property {string} old_values  - JSON string
 * @property {string} new_values  - JSON string
 * @property {string} created_at
 */

// ─── SEED FUNCTION ────────────────────────────────────────────────────────────
/**
 * Seeds the database with default data on first run.
 * Called from app.js after DB opens, only if the users store is empty.
 */
async function seedDatabase() {
  try {
    const userCount = await db.users.count();
    if (userCount > 0) return;

    console.log('[DB] First run detected — seeding default data...');

    const { hashPassword } = await import('./auth.js');
    const { hash, salt }   = await hashPassword(AppConfig.SEED_ADMIN_PASSWORD);

    // Store is_active as INTEGER 1 (not boolean true) for Dexie index compatibility
    await db.users.add({
      name:                  AppConfig.SEED_ADMIN_NAME,
      email:                 AppConfig.SEED_ADMIN_EMAIL,
      password_hash:         hash,
      password_salt:         salt,
      role:                  'admin',
      is_active:             1,       // ← integer, not boolean
      avatar_initials:       'SA',
      force_password_change: true,
      last_login:            null,
      created_at:            new Date().toISOString()
    });

    const defaultSettings = [
      { key: 'business_name',                   value: AppConfig.APP_NAME },
      { key: 'business_address',                value: '' },
      { key: 'business_phone',                  value: '' },
      { key: 'business_email',                  value: '' },
      { key: 'business_logo_base64',            value: '' },
      { key: 'default_low_stock_threshold',     value: String(AppConfig.DEFAULT_LOW_STOCK_THRESHOLD) },
      { key: 'currency_symbol',                 value: AppConfig.DEFAULT_CURRENCY_SYMBOL },
      { key: 'date_format',                     value: AppConfig.DEFAULT_DATE_FORMAT },
      { key: 'timezone',                        value: AppConfig.DEFAULT_TIMEZONE },
      { key: 'emailjs_service_id',              value: '' },
      { key: 'emailjs_template_id_lowstock',    value: '' },
      { key: 'emailjs_template_id_expiry',      value: '' },
      { key: 'emailjs_public_key',              value: '' },
      { key: 'email_alerts_enabled',            value: 'false' },
      { key: 'primary_color',                   value: AppConfig.DEFAULT_PRIMARY_COLOR },
      { key: 'sidebar_collapsed',               value: 'false' }
    ];
    await db.app_settings.bulkAdd(defaultSettings);

    const now = new Date().toISOString();
    await db.categories.bulkAdd([
      { name: 'General',      description: 'General purpose items',         created_at: now },
      { name: 'Electronics',  description: 'Electronic devices and parts',   created_at: now },
      { name: 'Food & Drink', description: 'Consumable food and beverages',  created_at: now },
      { name: 'Stationery',   description: 'Office and school supplies',     created_at: now },
      { name: 'Healthcare',   description: 'Medical and health products',    created_at: now }
    ]);

    console.log('[DB] Database seeded successfully.');
  } catch (err) {
    console.error('[DB] Seed error:', err);
    throw err;
  }
}

// ─── ADD: one-time migration for existing boolean is_active values ─────────────
async function migrateIsActiveValues() {
  try {
    let migrated = 0;

    // Products
    const products = await db.products.toArray();
    for (const p of products) {
      if (typeof p.is_active === 'boolean') {
        await db.products.update(p.id, { is_active: p.is_active ? 1 : 0 });
        migrated++;
      }
    }

    // Users
    const users = await db.users.toArray();
    for (const u of users) {
      if (typeof u.is_active === 'boolean') {
        await db.users.update(u.id, { is_active: u.is_active ? 1 : 0 });
        migrated++;
      }
    }

    // Suppliers
    const suppliers = await db.suppliers.toArray();
    for (const s of suppliers) {
      if (typeof s.is_active === 'boolean') {
        await db.suppliers.update(s.id, { is_active: s.is_active ? 1 : 0 });
        migrated++;
      }
    }

    if (migrated > 0) {
      console.log(`[DB] Migrated ${migrated} boolean is_active values to integers.`);
    }
  } catch (err) {
    console.warn('[DB] Migration warning (non-fatal):', err);
  }
}

// ─── SETTINGS HELPERS ─────────────────────────────────────────────────────────
/**
 * Retrieve a single app setting value by key.
 * @param {string} key
 * @param {string} [defaultValue='']
 * @returns {Promise<string>}
 */
async function getSetting(key, defaultValue = '') {
  try {
    const record = await db.app_settings.get(key);
    return record ? record.value : defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Set a single app setting value.
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
async function setSetting(key, value) {
  await db.app_settings.put({ key, value: String(value) });
}

/**
 * Retrieve all app settings as a plain key→value object.
 * @returns {Promise<Object>}
 */
async function getAllSettings() {
  const records = await db.app_settings.toArray();
  const result = {};
  for (const r of records) {
    result[r.key] = r.value;
  }
  return result;
}

// ─── PRODUCT HELPERS ──────────────────────────────────────────────────────────
/**
 * Get all active products with their category and supplier names joined.
 * @returns {Promise<Product[]>}
 */
async function getActiveProducts() {
  // Use filter() not where().equals(1) — avoids boolean vs integer mismatch
  const products   = await db.products.filter(p => !!p.is_active).toArray();
  const categories = await db.categories.toArray();
  const suppliers  = await db.suppliers.toArray();

  const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
  const supMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

  return products.map(p => ({
    ...p,
    category_name: catMap[p.category_id]?.name || '—',
    supplier_name: supMap[p.supplier_id]?.name  || '—'
  }));
}

/**
 * Get a single product by ID.
 * @param {number} id
 * @returns {Promise<Product|undefined>}
 */
async function getProductById(id) {
  return db.products.get(Number(id));
}

/**
 * Check if a SKU already exists (optionally excluding a product by ID).
 * @param {string} sku
 * @param {number|null} excludeId
 * @returns {Promise<boolean>}
 */
async function skuExists(sku, excludeId = null) {
  const product = await db.products.where('sku').equals(sku).first();
  if (!product) return false;
  if (excludeId && product.id === excludeId) return false;
  return true;
}

// ─── SUPPLIER & USER HELPERS ─────────────────────────────────────────────────
/**
 * Get all active suppliers.
 * @returns {Promise<Supplier[]>}
 */
async function getActiveSuppliers() {
  return db.suppliers.filter(s => !!s.is_active).toArray();
}

/**
 * Get all active users.
 * @returns {Promise<User[]>}
 */
async function getActiveUsers() {
  return db.users.filter(u => !!u.is_active).toArray();
}

// ─── STOCK MOVEMENT HELPERS ───────────────────────────────────────────────────
/**
 * Get all stock movements for a product, newest first.
 * @param {number} productId
 * @returns {Promise<StockMovement[]>}
 */
async function getMovementsForProduct(productId) {
  return db.stock_movements
    .where('product_id')
    .equals(productId)
    .reverse()
    .sortBy('created_at');
}

// ─── SALES HELPERS ────────────────────────────────────────────────────────────
/**
 * Get all sale items for a given sale ID.
 * @param {number} saleId
 * @returns {Promise<SaleItem[]>}
 */
async function getSaleItems(saleId) {
  return db.sale_items.where('sale_id').equals(saleId).toArray();
}

/**
 * Get today's completed sales.
 * @returns {Promise<Sale[]>}
 */
async function getTodaysSales() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  return db.sales
    .where('created_at')
    .between(todayStart.toISOString(), todayEnd.toISOString(), true, true)
    .and(s => s.status === 'completed')
    .toArray();
}

/**
 * Get completed sales within a date range.
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Sale[]>}
 */
async function getSalesInRange(startDate, endDate) {
  return db.sales
    .where('created_at')
    .between(startDate.toISOString(), endDate.toISOString(), true, true)
    .and(s => s.status === 'completed')
    .toArray();
}

// ─── NOTIFICATION HELPERS ─────────────────────────────────────────────────────
/**
 * Get count of unread notifications.
 * @returns {Promise<number>}
 */
async function getUnreadNotificationCount() {
  return db.notifications.where('is_read').equals(0).count();
}

/**
 * Check if a notification of a given type for a product was already
 * created today (to prevent duplicate notifications).
 * @param {string} type
 * @param {number} productId
 * @returns {Promise<boolean>}
 */
async function notificationExistsToday(type, productId) {
  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const existing = await db.notifications
    .where('type').equals(type)
    .and(n => n.product_id === productId && n.created_at.startsWith(todayStr))
    .first();
  return !!existing;
}

// ─── AUDIT LOG HELPER ─────────────────────────────────────────────────────────
/**
 * Write an entry to the audit_logs table.
 * This is a low-level helper; use audit.js writeAuditLog() for the full wrapper.
 * @param {Object} entry
 * @returns {Promise<number>} The new log entry ID
 */
async function insertAuditLog(entry) {
  return db.audit_logs.add({
    user_id:           entry.user_id || 0,
    user_name_snapshot:entry.user_name_snapshot || 'System',
    action:            entry.action,
    entity_type:       entry.entity_type || '',
    entity_id:         entry.entity_id   || 0,
    old_values:        entry.old_values  ? JSON.stringify(entry.old_values) : '{}',
    new_values:        entry.new_values  ? JSON.stringify(entry.new_values) : '{}',
    created_at:        new Date().toISOString()
  });
}

// ─── DATA EXPORT / IMPORT ─────────────────────────────────────────────────────
/**
 * Export the entire database to a plain JS object.
 * Used by Settings → Data Management → Export All Data.
 * @returns {Promise<Object>}
 */
async function exportAllData() {
  const [
    users, categories, suppliers, products,
    stock_movements, sales, sale_items,
    notifications, audit_logs, app_settings
  ] = await Promise.all([
    db.users.toArray(),
    db.categories.toArray(),
    db.suppliers.toArray(),
    db.products.toArray(),
    db.stock_movements.toArray(),
    db.sales.toArray(),
    db.sale_items.toArray(),
    db.notifications.toArray(),
    db.audit_logs.toArray(),
    db.app_settings.toArray()
  ]);

  // Strip password data from export for security
  const safeUsers = users.map(({ password_hash, password_salt, ...rest }) => rest);

  return {
    _meta: {
      app:         AppConfig.APP_NAME,
      version:     AppConfig.APP_VERSION,
      db_version:  AppConfig.DB_VERSION,
      exported_at: new Date().toISOString()
    },
    users:           safeUsers,
    categories,
    suppliers,
    products,
    stock_movements,
    sales,
    sale_items,
    notifications,
    audit_logs,
    app_settings
  };
}

/**
 * Import data from a backup object into the database.
 * WARNING: This overwrites all existing data in the affected stores.
 * Passwords are NOT imported — all users are given a forced-reset flag.
 * @param {Object} backup  - The object returned by exportAllData()
 * @returns {Promise<void>}
 */
async function importAllData(backup) {
  const { hashPassword } = await import('./auth.js');
  const tempPwd = await hashPassword('TempPass@123');

  await db.transaction('rw', [
    db.users, db.categories, db.suppliers, db.products,
    db.stock_movements, db.sales, db.sale_items,
    db.notifications, db.audit_logs, db.app_settings
  ], async () => {
    // Clear all stores first
    await Promise.all([
      db.users.clear(),
      db.categories.clear(),
      db.suppliers.clear(),
      db.products.clear(),
      db.stock_movements.clear(),
      db.sales.clear(),
      db.sale_items.clear(),
      db.notifications.clear(),
      db.audit_logs.clear(),
      db.app_settings.clear()
    ]);

    // Re-insert users with temporary password (force change on login)
    if (backup.users?.length) {
      const usersToImport = backup.users.map(u => ({
        ...u,
        password_hash:         tempPwd.hash,
        password_salt:         tempPwd.salt,
        force_password_change: true
      }));
      await db.users.bulkAdd(usersToImport);
    }

    // Re-insert all other stores
    if (backup.categories?.length)     await db.categories.bulkAdd(backup.categories);
    if (backup.suppliers?.length)      await db.suppliers.bulkAdd(backup.suppliers);
    if (backup.products?.length)       await db.products.bulkAdd(backup.products);
    if (backup.stock_movements?.length) await db.stock_movements.bulkAdd(backup.stock_movements);
    if (backup.sales?.length)          await db.sales.bulkAdd(backup.sales);
    if (backup.sale_items?.length)     await db.sale_items.bulkAdd(backup.sale_items);
    if (backup.notifications?.length)  await db.notifications.bulkAdd(backup.notifications);
    if (backup.audit_logs?.length)     await db.audit_logs.bulkAdd(backup.audit_logs);
    if (backup.app_settings?.length)   await db.app_settings.bulkAdd(backup.app_settings);
  });
}

/**
 * Wipe all application data from IndexedDB.
 * Preserves the licence activation in localStorage.
 * After clearing, re-seeds the default admin and settings.
 * @returns {Promise<void>}
 */
async function clearAllData() {
  await db.transaction('rw', [
    db.users, db.categories, db.suppliers, db.products,
    db.stock_movements, db.sales, db.sale_items,
    db.notifications, db.audit_logs, db.app_settings
  ], async () => {
    await Promise.all([
      db.users.clear(),
      db.categories.clear(),
      db.suppliers.clear(),
      db.products.clear(),
      db.stock_movements.clear(),
      db.sales.clear(),
      db.sale_items.clear(),
      db.notifications.clear(),
      db.audit_logs.clear(),
      db.app_settings.clear()
    ]);
  });

  // Re-seed with defaults
  await seedDatabase();
}

// ─── LOW STOCK / EXPIRY QUERY HELPERS ────────────────────────────────────────
/**
 * Get all active products that are at or below their low_stock_threshold.
 * @returns {Promise<Product[]>}
 */
async function getLowStockProducts() {
  const products = await db.products.filter(p => !!p.is_active).toArray();
  return products.filter(p => p.quantity <= p.low_stock_threshold);
}

/**
 * Get all active products expiring within the next N days.
 * @param {number} [days=30]
 * @returns {Promise<Product[]>}
 */
async function getExpiringProducts(days = AppConfig.EXPIRY_WARNING_DAYS) {
  const cutoff  = new Date();
  cutoff.setDate(cutoff.getDate() + days);

  const products = await db.products.filter(p => !!p.is_active).toArray();
  return products.filter(p => {
    if (!p.expiry_date || p.quantity <= 0) return false;
    const exp = new Date(p.expiry_date);
    return exp <= cutoff;
  });
}

/**
 * Get all active products with quantity === 0.
 * @returns {Promise<Product[]>}
 */
async function getOutOfStockProducts() {
  return db.products.filter(p => !!p.is_active && p.quantity === 0).toArray();
}

// ─── DASHBOARD AGGREGATION HELPERS ───────────────────────────────────────────
/**
 * Compute total stock value: sum(quantity × cost_price) for all active products.
 * @returns {Promise<number>}
 */
async function getTotalStockValue() {
  const products = await db.products.filter(p => !!p.is_active).toArray();
  return products.reduce((sum, p) => sum + (p.quantity * p.cost_price), 0);
}

/**
 * Get daily revenue for the last N days (for the trend chart).
 * Returns an array of { date: 'YYYY-MM-DD', revenue: number }.
 * @param {number} [days=30]
 * @returns {Promise<Array<{date:string, revenue:number}>>}
 */
async function getDailyRevenueTrend(days = AppConfig.DASHBOARD_TREND_DAYS) {
  const result  = [];
  const today   = new Date();

  // Build date buckets
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    result.push({ date: d.toISOString().slice(0, 10), revenue: 0 });
  }

  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (days - 1));
  startDate.setHours(0, 0, 0, 0);

  const sales = await db.sales
    .where('created_at').aboveOrEqual(startDate.toISOString())
    .and(s => s.status === 'completed')
    .toArray();

  for (const sale of sales) {
    const dateStr = sale.created_at.slice(0, 10);
    const bucket  = result.find(r => r.date === dateStr);
    if (bucket) bucket.revenue += sale.total_amount;
  }

  return result;
}

/**
 * Get top N best-selling products for the current month.
 * Returns [{ product_id, product_name, units_sold, revenue }]
 * @param {number} [limit=5]
 * @returns {Promise<Array>}
 */
async function getTopSellingProducts(limit = 5) {
  const now        = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const sales = await db.sales
    .where('created_at').aboveOrEqual(monthStart.toISOString())
    .and(s => s.status === 'completed')
    .toArray();

  if (!sales.length) return [];

  const saleIds = sales.map(s => s.id);
  const items   = await db.sale_items
    .where('sale_id').anyOf(saleIds)
    .toArray();

  const map = {};
  for (const item of items) {
    if (!map[item.product_id]) {
      map[item.product_id] = {
        product_id:   item.product_id,
        product_name: item.product_name_snapshot,
        units_sold:   0,
        revenue:      0
      };
    }
    map[item.product_id].units_sold += item.quantity;
    map[item.product_id].revenue    += item.subtotal;
  }

  return Object.values(map)
    .sort((a, b) => b.units_sold - a.units_sold)
    .slice(0, limit);
}

/**
 * Get stock quantity distribution by category (for doughnut chart).
 * Returns [{ category_name, total_quantity }]
 * @returns {Promise<Array>}
 */
async function getCategoryStockDistribution() {
  const products   = await db.products.filter(p => !!p.is_active).toArray();
  const categories = await db.categories.toArray();
  const catMap     = Object.fromEntries(categories.map(c => [c.id, c.name]));

  const map = {};
  for (const p of products) {
    const catName = catMap[p.category_id] || 'Uncategorised';
    map[catName] = (map[catName] || 0) + p.quantity;
  }

  return Object.entries(map).map(([category_name, total_quantity]) => ({
    category_name,
    total_quantity
  }));
}

// ─── VALIDATE BACKUP STRUCTURE ───────────────────────────────────────────────
/**
 * Validate that an imported backup object has the expected structure.
 * @param {any} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateBackupStructure(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    errors.push('File does not contain a valid JSON object.');
    return { valid: false, errors };
  }

  if (!data._meta) {
    errors.push('Missing _meta section — this may not be a StockSense backup file.');
  } else {
    if (data._meta.app !== AppConfig.APP_NAME) {
      errors.push(`App name mismatch: expected "${AppConfig.APP_NAME}", got "${data._meta.app}".`);
    }
  }

  const requiredStores = ['users', 'categories', 'products', 'sales', 'app_settings'];
  for (const store of requiredStores) {
    if (!Array.isArray(data[store])) {
      errors.push(`Missing or invalid store: "${store}".`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export {
  db,
  seedDatabase,
  migrateIsActiveValues,

  // Settings
  getSetting,
  setSetting,
  getAllSettings,

  // Products
  getActiveProducts,
  getProductById,
  skuExists,

  // Suppliers & Users
  getActiveSuppliers,
  getActiveUsers,

  // Stock
  getMovementsForProduct,

  // Sales
  getSaleItems,
  getTodaysSales,
  getSalesInRange,

  // Notifications
  getUnreadNotificationCount,
  notificationExistsToday,

  // Crypto Export
  setEncryptionKey,
  deriveKey,
  generateSalt,
  isEncryptionReady,

  // Audit
  insertAuditLog,

  // Data management
  exportAllData,
  importAllData,
  clearAllData,
  validateBackupStructure,

  // Aggregation
  getLowStockProducts,
  getExpiringProducts,
  getOutOfStockProducts,
  getTotalStockValue,
  getDailyRevenueTrend,
  getTopSellingProducts,
  getCategoryStockDistribution
};

export default db;
