/**
 * Stockdity IMS — Database Layer
 * Dexie.js 3.x wrapper for IndexedDB.
 * Defines all object stores, indexes, and the first-run seed function.
 */

import AppConfig from '../../config.js';
import {
  initEncryption,
  clearEncryptionKey,
  isEncryptionReady,
  encryptRecord,
  decryptRecord,
  decryptAll,
  migrateTableToEncrypted
} from './crypto-store.js';

// ─── DATABASE INITIALISATION ──────────────────────────────────────────────────
const db = new Dexie(AppConfig.DB_NAME);
// Schema Version 1 — kept for upgrade path (Dexie requires all prior versions)
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

/**
 * Schema Version 2 — Encryption-ready schema.
 * Unique indexes removed: &email, &sku — uniqueness is now enforced
 * in application layer (JS-side check before write) because records
 * are stored as AES-GCM encrypted blobs. Dexie cannot index inside
 * encrypted fields.
 */
db.version(2).stores({
  users:
    '++id, role, is_active',
  categories:
    '++id, name',
  suppliers:
    '++id, is_active',
  products:
    '++id, is_active',
  stock_movements:
    '++id, product_id, created_at',
  sales:
    '++id, created_at',
  sale_items:
    '++id, sale_id',
  notifications:
    '++id, is_read',
  audit_logs:
    '++id, created_at',
  app_settings:
    'key'
}).upgrade(async tx => {
  // Migrate plaintext records to encrypted envelopes.
  // This runs only if the encryption key is already initialised
  // (i.e., the user has previously activated the app).
  // If encryption is not initialised (first-ever install), no migration
  // is needed because the DB is empty.
  console.log('[DB] Upgrading schema to version 2 (encryption-ready)...');

  if (!isEncryptionReady()) {
    console.log('[DB] Encryption not yet initialised — skipping migration (DB is new or unactivated).');
    return;
  }

  const tables = [
    tx.table('users'), tx.table('categories'), tx.table('suppliers'),
    tx.table('products'), tx.table('stock_movements'), tx.table('sales'),
    tx.table('sale_items'), tx.table('notifications'), tx.table('audit_logs'),
    tx.table('app_settings')
  ];

  for (const table of tables) {
    try {
      const result = await migrateTableToEncrypted(table);
      console.log(`[DB] Migrated table ${table.name}: ${result.migrated} records, ${result.failed} failed.`);
    } catch (err) {
      console.error(`[DB] Migration error for table ${table.name}:`, err);
    }
  }
});

async function encryptRecord(record, pkField = 'id') {
  if (!record || typeof record !== 'object') {
    throw new Error('[CryptoStore] encryptRecord(): record must be an object.');
  }

  try {
    const envelope = await encrypt(record);
    const stored = { _enc: envelope };
    // Preserve the primary key in plaintext so Dexie can store/retrieve the record.
    if (record[pkField] !== undefined && record[pkField] !== null) {
      stored[pkField] = record[pkField];
    }
    return stored;
  } catch (err) {
    console.error('[CryptoStore] encryptRecord() failed:', err);
    throw err;
  }
}

async function decryptRecord(stored, pkField = 'id') {
  if (!stored) return null;

  if (!stored._enc) {
    return stored; // legacy plaintext record
  }

  try {
    const record = await decrypt(stored._enc);
    if (stored[pkField] !== undefined) {
      record[pkField] = stored[pkField];
    }
    return record;
  } catch (err) {
    console.warn('[CryptoStore] decryptRecord() — skipped (wrong tenant or corrupted):', err.message);
    return null;
  }
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
    const allStored = await db.users.toArray();
    const allUsers  = await decryptAll(allStored);
    if (allUsers.length > 0) return;

    console.log('[DB] First run detected — seeding default data...');

    const { hashPassword } = await import('./auth.js');
    const { hash, salt }   = await hashPassword(AppConfig.SEED_ADMIN_PASSWORD);

    const adminRecord = {
      name:                  AppConfig.SEED_ADMIN_NAME,
      email:                 AppConfig.SEED_ADMIN_EMAIL,
      password_hash:         hash,
      password_salt:         salt,
      role:                  'admin',
      is_active:             1,
      avatar_initials:       'SA',
      force_password_change: true,
      last_login:            null,
      created_at:            new Date().toISOString()
    };

    if (isEncryptionReady()) {
      await db.users.add(await encryptRecord(adminRecord));
    } else {
      await db.users.add(adminRecord);
    }

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

    if (isEncryptionReady()) {
      const encSettings = await Promise.all(
        defaultSettings.map(s => encryptRecord(s, 'key'))
      );
      await db.app_settings.bulkPut(encSettings);
    } else {
      await db.app_settings.bulkAdd(defaultSettings);
    }

    const now = new Date().toISOString();
    const cats = [
      { name: 'General',      description: 'General purpose items',         created_at: now },
      { name: 'Electronics',  description: 'Electronic devices and parts',   created_at: now },
      { name: 'Food & Drink', description: 'Consumable food and beverages',  created_at: now },
      { name: 'Stationery',   description: 'Office and school supplies',     created_at: now },
      { name: 'Healthcare',   description: 'Medical and health products',    created_at: now }
    ];

    if (isEncryptionReady()) {
      const encCats = await Promise.all(cats.map(c => encryptRecord(c)));
      await db.categories.bulkAdd(encCats);
    } else {
      await db.categories.bulkAdd(cats);
    }

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
    const stored = await db.app_settings.get(key);
    if (!stored) return defaultValue;
    const record = await decryptRecord(stored, 'key');
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
  try {
    const record = { key, value: String(value) };
    if (isEncryptionReady()) {
      await db.app_settings.put(await encryptRecord(record, 'key'));
    } else {
      await db.app_settings.put(record);
    }
  } catch (err) {
    console.error('[DB] setSetting() error:', err);
    throw err;
  }
}

/**
 * Retrieve all app settings as a plain key→value object.
 * @returns {Promise<Object>}
 */

async function getAllSettings() {
  try {
    const storedAll = await db.app_settings.toArray();
    const records   = await decryptAll(storedAll.map(s => s._enc ? s : s)); // handles both encrypted and legacy
    // For decryptAll with 'key' pkField, we need a special path:
    const result = {};
    for (const stored of storedAll) {
      try {
        const record = await decryptRecord(stored, 'key');
        if (record) result[record.key] = record.value;
      } catch { /* skip corrupted record */ }
    }
    return result;
  } catch (err) {
    console.error('[DB] getAllSettings() error:', err);
    return {};
  }
}

// ─── PRODUCT HELPERS ──────────────────────────────────────────────────────────
/**
 * Get all active products with their category and supplier names joined.
 * @returns {Promise<Product[]>}
 */
async function getActiveProducts() {
  try {
    const storedProducts   = await db.products.toArray();
    const storedCategories = await db.categories.toArray();
    const storedSuppliers  = await db.suppliers.toArray();

    const products   = await decryptAll(storedProducts);
    const categories = await decryptAll(storedCategories);
    const suppliers  = await decryptAll(storedSuppliers);

    const catMap = Object.fromEntries(categories.map(c => [c.id, c]));
    const supMap = Object.fromEntries(suppliers.map(s => [s.id, s]));

    return products
      .filter(p => !!p.is_active)
      .map(p => ({
        ...p,
        category_name: catMap[p.category_id]?.name || '—',
        supplier_name: supMap[p.supplier_id]?.name  || '—'
      }));
  } catch (err) {
    console.error('[DB] getActiveProducts() error:', err);
    return [];
  }
}

/**
 * Get a single product by ID.
 * @param {number} id
 * @returns {Promise<Product|undefined>}
 */

async function getProductById(id) {
  try {
    const stored = await db.products.get(Number(id));
    if (!stored) return undefined;
    return decryptRecord(stored);
  } catch (err) {
    console.error('[DB] getProductById() error:', err);
    return undefined;
  }
}

/**
 * Check if a SKU already exists (optionally excluding a product by ID).
 * @param {string} sku
 * @param {number|null} excludeId
 * @returns {Promise<boolean>}
 */
async function skuExists(sku, excludeId = null) {
  try {
    const storedAll = await db.products.toArray();
    const products  = await decryptAll(storedAll);
    const found = products.find(p =>
      p.sku === sku && (excludeId === null || p.id !== excludeId)
    );
    return !!found;
  } catch (err) {
    console.error('[DB] skuExists() error:', err);
    return false;
  }
}

// ─── SUPPLIER & USER HELPERS ─────────────────────────────────────────────────
/**
 * Get all active suppliers.
 * @returns {Promise<Supplier[]>}
 */
async function getActiveSuppliers() {
  try {
    const storedAll = await db.suppliers.toArray();
    const records   = await decryptAll(storedAll);
    return records.filter(s => !!s.is_active);
  } catch (err) {
    console.error('[DB] getActiveSuppliers() error:', err);
    return [];
  }
}

/**
 * Get all active users.
 * @returns {Promise<User[]>}
 */

async function getActiveUsers() {
  try {
    const storedAll = await db.users.toArray();
    const records   = await decryptAll(storedAll);
    return records.filter(u => !!u.is_active);
  } catch (err) {
    console.error('[DB] getActiveUsers() error:', err);
    return [];
  }
}

// ─── STOCK MOVEMENT HELPERS ───────────────────────────────────────────────────
/**
 * Get all stock movements for a product, newest first.
 * @param {number} productId
 * @returns {Promise<StockMovement[]>}
 */

async function getMovementsForProduct(productId) {
  try {
    const storedAll = await db.stock_movements.toArray();
    const records   = await decryptAll(storedAll);
    return records
      .filter(m => m.product_id === productId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch (err) {
    console.error('[DB] getMovementsForProduct() error:', err);
    return [];
  }
}

// ─── SALES HELPERS ────────────────────────────────────────────────────────────
/**
 * Get all sale items for a given sale ID.
 * @param {number} saleId
 * @returns {Promise<SaleItem[]>}
 */

async function getSaleItems(saleId) {
  try {
    const storedAll = await db.sale_items.toArray();
    const records   = await decryptAll(storedAll);
    return records.filter(i => i.sale_id === saleId);
  } catch (err) {
    console.error('[DB] getSaleItems() error:', err);
    return [];
  }
}

/**
 * Get today's completed sales.
 * @returns {Promise<Sale[]>}
 */

async function getTodaysSales() {
  try {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
    const storedAll  = await db.sales.toArray();
    const records    = await decryptAll(storedAll);
    return records.filter(s =>
      s.status === 'completed' &&
      s.created_at >= todayStart.toISOString() &&
      s.created_at <= todayEnd.toISOString()
    );
  } catch (err) {
    console.error('[DB] getTodaysSales() error:', err);
    return [];
  }
}

/**
 * Get completed sales within a date range.
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Promise<Sale[]>}
 */

async function getSalesInRange(startDate, endDate) {
  try {
    const storedAll = await db.sales.toArray();
    const records   = await decryptAll(storedAll);
    return records.filter(s =>
      s.status === 'completed' &&
      s.created_at >= startDate.toISOString() &&
      s.created_at <= endDate.toISOString()
    );
  } catch (err) {
    console.error('[DB] getSalesInRange() error:', err);
    return [];
  }
}

// ─── NOTIFICATION HELPERS ─────────────────────────────────────────────────────
/**
 * Get count of unread notifications.
 * @returns {Promise<number>}
 */

async function getUnreadNotificationCount() {
  try {
    const storedAll = await db.notifications.toArray();
    const records   = await decryptAll(storedAll);
    return records.filter(n => !n.is_read || n.is_read === 0).length;
  } catch (err) {
    console.error('[DB] getUnreadNotificationCount() error:', err);
    return 0;
  }
}

/**
 * Check if a notification of a given type for a product was already
 * created today (to prevent duplicate notifications).
 * @param {string} type
 * @param {number} productId
 * @returns {Promise<boolean>}
 */

async function notificationExistsToday(type, productId) {
  try {
    const todayStr  = new Date().toISOString().slice(0, 10);
    const storedAll = await db.notifications.toArray();
    const records   = await decryptAll(storedAll);
    return records.some(n =>
      n.type === type &&
      n.product_id === productId &&
      n.created_at.startsWith(todayStr)
    );
  } catch (err) {
    console.error('[DB] notificationExistsToday() error:', err);
    return false;
  }
}

// ─── AUDIT LOG HELPER ─────────────────────────────────────────────────────────
/**
 * Write an entry to the audit_logs table.
 * This is a low-level helper; use audit.js writeAuditLog() for the full wrapper.
 * @param {Object} entry
 * @returns {Promise<number>} The new log entry ID
 */

async function insertAuditLog(entry) {
  try {
    const record = {
      user_id:            entry.user_id || 0,
      user_name_snapshot: entry.user_name_snapshot || 'System',
      action:             entry.action,
      entity_type:        entry.entity_type || '',
      entity_id:          entry.entity_id   || 0,
      old_values:         entry.old_values  ? JSON.stringify(entry.old_values) : '{}',
      new_values:         entry.new_values  ? JSON.stringify(entry.new_values) : '{}',
      created_at:         new Date().toISOString()
    };

    if (isEncryptionReady()) {
      return db.audit_logs.add(await encryptRecord(record));
    } else {
      return db.audit_logs.add(record);
    }
  } catch (err) {
    console.error('[DB] insertAuditLog() error:', err);
    // Non-fatal — audit failure must not crash the app
    return null;
  }
}

// ─── DATA EXPORT / IMPORT ─────────────────────────────────────────────────────
/**
 * Export the entire database to a plain JS object.
 * Used by Settings → Data Management → Export All Data.
 * @returns {Promise<Object>}
 */

async function exportAllData() {
  try {
    const [
      storedUsers, storedCategories, storedSuppliers, storedProducts,
      storedMovements, storedSales, storedSaleItems,
      storedNotifs, storedAudit, storedSettings
    ] = await Promise.all([
      db.users.toArray(),        db.categories.toArray(),
      db.suppliers.toArray(),    db.products.toArray(),
      db.stock_movements.toArray(), db.sales.toArray(),
      db.sale_items.toArray(),   db.notifications.toArray(),
      db.audit_logs.toArray(),   db.app_settings.toArray()
    ]);

    const [
      users, categories, suppliers, products,
      stock_movements, sales, sale_items,
      notifications, audit_logs
    ] = await Promise.all([
      decryptAll(storedUsers),       decryptAll(storedCategories),
      decryptAll(storedSuppliers),   decryptAll(storedProducts),
      decryptAll(storedMovements),   decryptAll(storedSales),
      decryptAll(storedSaleItems),   decryptAll(storedNotifs),
      decryptAll(storedAudit)
    ]);

    // Decrypt app_settings separately (uses 'key' as PK)
    const app_settings = [];
    for (const s of storedSettings) {
      try {
        const rec = await decryptRecord(s, 'key');
        if (rec) app_settings.push(rec);
      } catch { /* skip */ }
    }

    const safeUsers = users.map(({ password_hash, password_salt, ...rest }) => rest);

    return {
      _meta: {
        app:         AppConfig.APP_NAME,
        version:     AppConfig.APP_VERSION,
        db_version:  AppConfig.DB_VERSION,
        exported_at: new Date().toISOString()
      },
      users: safeUsers,
      categories, suppliers, products, stock_movements,
      sales, sale_items, notifications, audit_logs, app_settings
    };
  } catch (err) {
    console.error('[DB] exportAllData() error:', err);
    throw err;
  }
}

/**
 * Import data from a backup object into the database.
 * WARNING: This overwrites all existing data in the affected stores.
 * Passwords are NOT imported — all users are given a forced-reset flag.
 * @param {Object} backup  - The object returned by exportAllData()
 * @returns {Promise<void>}
 */

async function importAllData(backup) {
  try {
    const { hashPassword } = await import('./auth.js');
    const tempPwd = await hashPassword('TempPass@123');

    await db.transaction('rw', [
      db.users, db.categories, db.suppliers, db.products,
      db.stock_movements, db.sales, db.sale_items,
      db.notifications, db.audit_logs, db.app_settings
    ], async () => {
      await Promise.all([
        db.users.clear(),        db.categories.clear(),
        db.suppliers.clear(),    db.products.clear(),
        db.stock_movements.clear(), db.sales.clear(),
        db.sale_items.clear(),   db.notifications.clear(),
        db.audit_logs.clear(),   db.app_settings.clear()
      ]);

      const encryptIfReady = async (record, pkField = 'id') =>
        isEncryptionReady() ? encryptRecord(record, pkField) : record;

      if (backup.users?.length) {
        const usersToImport = await Promise.all(
          backup.users.map(u => encryptIfReady({
            ...u,
            password_hash:         tempPwd.hash,
            password_salt:         tempPwd.salt,
            force_password_change: true
          }))
        );
        await db.users.bulkAdd(usersToImport);
      }

      const bulkEncrypt = async (arr, pkField = 'id') =>
        isEncryptionReady()
          ? Promise.all(arr.map(r => encryptRecord(r, pkField)))
          : arr;

      if (backup.categories?.length)
        await db.categories.bulkAdd(await bulkEncrypt(backup.categories));
      if (backup.suppliers?.length)
        await db.suppliers.bulkAdd(await bulkEncrypt(backup.suppliers));
      if (backup.products?.length)
        await db.products.bulkAdd(await bulkEncrypt(backup.products));
      if (backup.stock_movements?.length)
        await db.stock_movements.bulkAdd(await bulkEncrypt(backup.stock_movements));
      if (backup.sales?.length)
        await db.sales.bulkAdd(await bulkEncrypt(backup.sales));
      if (backup.sale_items?.length)
        await db.sale_items.bulkAdd(await bulkEncrypt(backup.sale_items));
      if (backup.notifications?.length)
        await db.notifications.bulkAdd(await bulkEncrypt(backup.notifications));
      if (backup.audit_logs?.length)
        await db.audit_logs.bulkAdd(await bulkEncrypt(backup.audit_logs));
      if (backup.app_settings?.length)
        await db.app_settings.bulkPut(await bulkEncrypt(backup.app_settings, 'key'));
    });
  } catch (err) {
    console.error('[DB] importAllData() error:', err);
    throw err;
  }
}

/**
 * Wipe all application data from IndexedDB.
 * Preserves the licence activation in localStorage.
 * After clearing, re-seeds the default admin and settings.
 * @returns {Promise<void>}
 */

async function clearAllData() {
  try {
    await db.transaction('rw', [
      db.users, db.categories, db.suppliers, db.products,
      db.stock_movements, db.sales, db.sale_items,
      db.notifications, db.audit_logs, db.app_settings
    ], async () => {
      await Promise.all([
        db.users.clear(),        db.categories.clear(),
        db.suppliers.clear(),    db.products.clear(),
        db.stock_movements.clear(), db.sales.clear(),
        db.sale_items.clear(),   db.notifications.clear(),
        db.audit_logs.clear(),   db.app_settings.clear()
      ]);
    });
    await seedDatabase();
  } catch (err) {
    console.error('[DB] clearAllData() error:', err);
    throw err;
  }
}

// ─── LOW STOCK / EXPIRY QUERY HELPERS ────────────────────────────────────────
/**
 * Get all active products that are at or below their low_stock_threshold.
 * @returns {Promise<Product[]>}
 */

async function getLowStockProducts() {
  try {
    const storedAll = await db.products.toArray();
    const products  = await decryptAll(storedAll);
    return products.filter(p => !!p.is_active && p.quantity <= p.low_stock_threshold);
  } catch (err) {
    console.error('[DB] getLowStockProducts() error:', err);
    return [];
  }
}

/**
 * Get all active products expiring within the next N days.
 * @param {number} [days=30]
 * @returns {Promise<Product[]>}
 */

async function getExpiringProducts(days = AppConfig.EXPIRY_WARNING_DAYS) {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);
    const storedAll = await db.products.toArray();
    const products  = await decryptAll(storedAll);
    return products.filter(p => {
      if (!p.is_active || !p.expiry_date || p.quantity <= 0) return false;
      return new Date(p.expiry_date) <= cutoff;
    });
  } catch (err) {
    console.error('[DB] getExpiringProducts() error:', err);
    return [];
  }
}

/**
 * Get all active products with quantity === 0.
 * @returns {Promise<Product[]>}
 */
async function getOutOfStockProducts() {
  try {
    const storedAll = await db.products.toArray();
    const products  = await decryptAll(storedAll);
    return products.filter(p => !!p.is_active && p.quantity === 0);
  } catch (err) {
    console.error('[DB] getOutOfStockProducts() error:', err);
    return [];
  }
}

// ─── DASHBOARD AGGREGATION HELPERS ───────────────────────────────────────────
/**
 * Compute total stock value: sum(quantity × cost_price) for all active products.
 * @returns {Promise<number>}
 */

async function getTotalStockValue() {
  try {
    const storedAll = await db.products.toArray();
    const products  = await decryptAll(storedAll);
    return products
      .filter(p => !!p.is_active)
      .reduce((sum, p) => sum + (p.quantity * p.cost_price), 0);
  } catch (err) {
    console.error('[DB] getTotalStockValue() error:', err);
    return 0;
  }
}

/**
 * Get daily revenue for the last N days (for the trend chart).
 * Returns an array of { date: 'YYYY-MM-DD', revenue: number }.
 * @param {number} [days=30]
 * @returns {Promise<Array<{date:string, revenue:number}>>}
 */

async function getDailyRevenueTrend(days = AppConfig.DASHBOARD_TREND_DAYS) {
  try {
    const result  = [];
    const today   = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      result.push({ date: d.toISOString().slice(0, 10), revenue: 0 });
    }

    const startDate = new Date(today);
    startDate.setDate(startDate.getDate() - (days - 1));
    startDate.setHours(0, 0, 0, 0);

    const storedAll = await db.sales.toArray();
    const sales     = await decryptAll(storedAll);
    const filtered  = sales.filter(s =>
      s.status === 'completed' && s.created_at >= startDate.toISOString()
    );

    for (const sale of filtered) {
      const dateStr = sale.created_at.slice(0, 10);
      const bucket  = result.find(r => r.date === dateStr);
      if (bucket) bucket.revenue += sale.total_amount;
    }

    return result;
  } catch (err) {
    console.error('[DB] getDailyRevenueTrend() error:', err);
    return [];
  }
}

/**
 * Get top N best-selling products for the current month.
 * Returns [{ product_id, product_name, units_sold, revenue }]
 * @param {number} [limit=5]
 * @returns {Promise<Array>}
 */

async function getTopSellingProducts(limit = 5) {
  try {
    const now        = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const storedSales = await db.sales.toArray();
    const sales = (await decryptAll(storedSales)).filter(s =>
      s.status === 'completed' && s.created_at >= monthStart.toISOString()
    );

    if (!sales.length) return [];

    const saleIds = sales.map(s => s.id);
    const storedItems = await db.sale_items.toArray();
    const items = (await decryptAll(storedItems)).filter(i => saleIds.includes(i.sale_id));

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
  } catch (err) {
    console.error('[DB] getTopSellingProducts() error:', err);
    return [];
  }
}

/**
 * Get stock quantity distribution by category (for doughnut chart).
 * Returns [{ category_name, total_quantity }]
 * @returns {Promise<Array>}
 */

async function getCategoryStockDistribution() {
  try {
    const storedProducts   = await db.products.toArray();
    const storedCategories = await db.categories.toArray();
    const products   = await decryptAll(storedProducts);
    const categories = await decryptAll(storedCategories);
    const catMap     = Object.fromEntries(categories.map(c => [c.id, c.name]));

    const map = {};
    for (const p of products.filter(p => !!p.is_active)) {
      const catName = catMap[p.category_id] || 'Uncategorised';
      map[catName] = (map[catName] || 0) + p.quantity;
    }

    return Object.entries(map).map(([category_name, total_quantity]) => ({
      category_name, total_quantity
    }));
  } catch (err) {
    console.error('[DB] getCategoryStockDistribution() error:', err);
    return [];
  }
}

// ─── VALIDATE BACKUP STRUCTURE ───────────────────────────────────────────────
/**
 * Validate that an imported backup object has the expected structure.
 * @param {any} data
 * @returns {{ valid: boolean, errors: string[] }}
 */

async function migrateIsActiveValues() {
  try {
    let migrated = 0;

    const migrateTable = async (table) => {
      const storedAll = await table.toArray();
      const records   = await decryptAll(storedAll);
      for (const record of records) {
        if (typeof record.is_active === 'boolean') {
          record.is_active = record.is_active ? 1 : 0;
          const toStore = isEncryptionReady()
            ? await encryptRecord(record)
            : record;
          await table.put(toStore);
          migrated++;
        }
      }
    };

    await migrateTable(db.products);
    await migrateTable(db.users);
    await migrateTable(db.suppliers);

    if (migrated > 0) {
      console.log(`[DB] Migrated ${migrated} boolean is_active values to integers.`);
    }
  } catch (err) {
    console.warn('[DB] Migration warning (non-fatal):', err);
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export {
  db,
  seedDatabase,
  migrateIsActiveValues,
  initEncryption,     
  clearEncryptionKey,

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
