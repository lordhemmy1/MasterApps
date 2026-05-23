# Stockdity IMS — Changelog

All notable changes to Stockdity IMS are documented in this file.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.0.0] — 2024-01-01

### 🎉 Initial Release

This is the first public release of Stockdity IMS — a complete,
offline-capable, browser-based inventory management system for small to
medium businesses.

---

### Added — Core Architecture

- **Single Page Application** with hash-based routing
  (`#/dashboard`, `#/products`, `#/sales`, etc.)
- **ES6 module system** — no build tools, no bundlers; browser loads
  modules directly via `<script type="module">`
- **IndexedDB persistence** via Dexie.js 3.2.7 — all data stored locally
  in the browser; works 100% offline
- **Service Worker** with Cache First strategy for full offline support
  after first load
- **PWA manifest** for installability on desktop and mobile
- **MVC-inspired module architecture** — each feature is a self-contained
  JS module with `init()` and `destroy()` lifecycle methods
- **AppState** — centralised in-memory state object shared across modules
- **Hash-based SPA router** with route-level permission guards

---

### Added — Licence & Activation

- **Licence key activation** — application is locked until a valid key is
  entered; validated via SHA-256 hash comparison using Web Crypto API
- **config.js** — single file customised per customer containing the
  licence key hash, app name, currency symbol, and timezone
- **Activation overlay** — full-screen activation screen on first load
- **Deactivation** — admin can deactivate the licence from Settings → Licence
- **Licence details page** — shows business name and activation date

---

### Added — Authentication & Security

- **Password hashing** — SHA-256 with 16-byte random salt via
  `crypto.subtle.digest()` (Web Crypto API); no library required
- **Timing-safe password comparison** — bitwise XOR loop prevents
  timing-based attacks
- **Session management** — authenticated user stored in `sessionStorage`;
  cleared on browser close
- **Login rate limiting** — 5 failed attempts within 10 minutes locks
  the form for 15 minutes with a countdown timer
- **Role-based access control** — three roles (Admin, Manager, Staff)
  with per-route permission enforcement
- **Forced password change** — new users and password-reset users must
  change password before accessing the application
- **XSS protection** — all dynamic DOM insertions use `textContent` or
  a `sanitize()` function that HTML-encodes special characters
- **Image validation** — file type (JPEG/PNG/WEBP) and size (max 2MB)
  checked before FileReader conversion

---

### Added — Dashboard

- 6 KPI summary cards with live data from IndexedDB
- 30-day sales trend line chart (Chart.js 4.4.1)
- Top 5 products this month — horizontal bar chart
- Category stock distribution — doughnut chart
- Recent sales table — last 10 completed sales
- Low stock alert panel — products at or below threshold
- Expiry alert panel — products expiring within 30 days, colour-coded
- Quick action buttons — Add Product, New Sale, Stock In, Reports
- Auto-run notification checks on every dashboard load
- Chart instance cleanup on module destroy to prevent canvas reuse errors

---

### Added — Product Management

- Full product catalogue with SKU, barcode, category, supplier, unit,
  cost price, selling price, quantity, low stock threshold, expiry date
- Auto-generated SKUs in format `CATCODE-XXXX`
- Real-time profit margin calculator — updates as prices are typed
- Product image upload — FileReader converts to base64; stored in IndexedDB
- Sortable, filterable, paginated product list (10/20/50 rows per page)
- URL-reflected filter state — filters are bookmarkable via hash query params
- Stock status badges — In Stock / Low Stock / Out of Stock / Expired
- Expiry row highlighting — amber for expiring soon, red for expired
- Soft delete — sets `is_active = false`; preserves sales history integrity
- Product detail page — full info, stock movements, sales appearances
- CSV bulk import with row-by-row validation report and partial import
- CSV bulk export of all active products
- CSV import template download

---

### Added — Inventory Tracking

- **Stock In** — searchable product dropdown, quantity, supplier, reference,
  date, notes; all recorded in `stock_movements` table
- **Stock Out** — quantity validated against current stock inside a
  Dexie transaction
- **Stock Adjustment** — sets corrected quantity with real-time difference
  display; justification required
- **Movement History** — full paginated table with type, date range,
  product, and user filters; CSV export
- All write operations wrapped in `db.transaction()` for rollback safety
- Low stock notification check triggered after every stock deduction

---

### Added — Sales

- POS-style sales entry with live product search (name or SKU)
- Keyboard navigation in product search dropdown (↑↓ Enter Escape)
- Cart with per-item quantity inputs validated against available stock
- Cart persisted in `sessionStorage` — survives accidental navigation
- Re-validation of all quantities at confirmation time (inside transaction)
- Payment methods: Cash, Card, Bank Transfer, Credit
- Complete sale transaction: sale record + sale_items + stock_movements +
  notifications + audit_log in a single Dexie transaction
- Receipt view — thermal (80mm) receipt layout via CSS + print stylesheet
- `window.print()` for physical receipt printing
- Sales history — sortable, filterable table with date range, status,
  payment method, and customer name search
- Daily summary bar — transaction count, revenue, payment method breakdown
- Sale detail page — full itemised view using snapshotted product names/SKUs
- **Void Sale** — admin/manager only; restores stock via return movements;
  logged to audit trail
- CSV export of sales history

---

### Added — Reports (10 types)

All reports generated client-side from IndexedDB. All support CSV and PDF export.
PDF export uses jsPDF 2.5.1 + AutoTable 3.8.2 with branded header.

1. **Daily Sales Report** — date picker; itemised sales table; payment breakdown
2. **Weekly Sales Summary** — date range; day-by-day revenue bar chart
3. **Monthly Sales Summary** — month picker; day-by-day revenue line chart
4. **Inventory Status Report** — all active products; cost value, retail value,
   profit, margin
5. **Out of Stock Report** — sorted by last stock-in date ascending
6. **Low Stock Report** — sorted by severity ratio; visual stock level bars
7. **Expiry Report** — configurable window (7/14/30/60/90 days or expired only)
8. **Best Sellers** — date range; top 20 products; horizontal bar chart
9. **Stock Movement Report** — date range + type filter; summary totals
10. **Supplier Report** — date range + supplier filter; deliveries and cost value

---

### Added — Categories

- Category list with product count (live query)
- Add/Edit via inline modal (no page navigation)
- Safe deletion with product reassignment modal if category has active products
- Sortable by name, product count, created date

---

### Added — Suppliers

- Supplier list with product count
- Add/Edit via slide-in modal with full contact details
- Supplier profile page — contact card, statistics, linked products,
  full supply history
- Activate/Deactivate suppliers
- Supply statistics: deliveries, total units, estimated cost value

---

### Added — Notifications

- **Low stock alerts** — generated when quantity falls to/below threshold;
  max one per product per day
- **Expiry alerts** — generated for products expiring within 30 days;
  max one per product per day
- **System notifications** — daily out-of-stock summary for admin on first login
- Bell icon in topbar with unread badge count
- Dropdown panel showing 5 most recent notifications
- Full notifications page with All / Unread toggle
- Mark individual or all notifications as read
- Delete individual notifications
- **EmailJS integration** — configurable email alerts for low stock and expiry;
  wrapping in try/catch ensures email failures never block main operations
- Send Test Email button in Settings

---

### Added — User Management

- User list with role badges, status badges, last login date
- Add user modal — name, email, role, initial password;
  `force_password_change: true` set automatically
- Edit user modal — name, email, role (password changed separately)
- Admin password reset — sets new hash + salt; forces password change
- Activate/Deactivate — button disabled for self (cannot deactivate own account)
- Avatar initials generated from name; colour assigned deterministically
  by hashing the user's name

---

### Added — Settings

- **Business Profile** tab — name, address, phone, email, logo upload
- **Preferences** tab — currency symbol, date format, low stock threshold,
  sidebar default state, primary colour with live preview
- **Notifications** tab — EmailJS configuration, test email
- **Licence** tab — activation details, deactivation
- **Change Password** tab — current password verification, strength meter,
  available to all users via profile dropdown
- **Data Management** tab (admin only):
  - Export all data to JSON (passwords excluded)
  - Import from JSON backup (all users force-reset)
  - Clear all data (typed confirmation "DELETE" required)

---

### Added — Audit Log

- Every significant action written to `audit_logs` table:
  create, update, delete, login, logout, void
- `writeAuditLog()` helper used by all modules — failures non-fatal
- Audit log viewer page (admin only) — filterable by action, entity type,
  date range; searchable by user name
- Detail modal — shows before/after JSON (base64 images redacted)
- CSV export of audit log

---

### Added — UI/UX

- Polished admin interface built with vanilla CSS (no Tailwind, no Bootstrap)
- CSS custom properties for full design token system
- Fixed sidebar (260px) with collapse toggle and smooth CSS transition
- Responsive breakpoints: 1200px, 768px, 480px
- Hamburger menu with overlay on mobile
- Topbar with breadcrumb, offline badge, notification bell, user avatar dropdown
- Toast notification system — success, error, warning, info variants;
  auto-dismiss with progress bar; max 5 visible
- Full-page spinner overlay for async operations
- Skeleton loaders for KPI cards, tables, charts during data fetch
- Empty state components with icon, message, and action button
- Sortable table headers with ↑↓ indicators
- Paginated tables (configurable page size: 10/20/50)
- Searchable dropdowns with keyboard navigation for product selection
- Password strength meter with animated progress bar
- Real-time profit margin calculator in product form
- Scroll-to-top button on long pages
- Online/offline banner
- Colour picker with live primary colour preview
- Image upload previews with remove button
- Print-optimised CSS (`print.css`) — hides navigation, receipt-width layout

---

### Added — Performance

- Event delegation on all table containers (no per-row listener memory leaks)
- Debounced search inputs (300ms)
- Throttled scroll events (16ms)
- `DocumentFragment` for batch DOM insertions
- Chart.js instances destroyed before re-creation
- Lazy-loaded modules via dynamic `import()`
- All tables paginated — max 50 rows rendered to DOM at once
- `requestAnimationFrame` for scroll-based UI updates

---

### Added — Offline Capability

- Service Worker (`sw.js`) using Cache First strategy for app shell
- Network First strategy for CDN resources (fonts, libraries)
- Pre-cache of all 30+ local assets on Service Worker install
- Stale cache cleanup on Service Worker activate
- Offline fallback page when both cache and network fail
- Service Worker message handlers: SKIP_WAITING, CLEAR_CACHE, GET_VERSION
- Push notification stubs for future use

---

### Technical Notes

- **No build step required** — deploy the files as-is; the browser handles
  ES6 module resolution
- **No server-side code** — 100% static files; deployable to any CDN,
  static host, or local HTTP server
- **One-time purchase model** — licence key activates the app permanently;
  no subscription, no backend dependency, no ongoing cost
- **Database version:** 1 (Dexie schema); version increment required for
  future schema changes with migration path

---

## Roadmap (Future Versions)

The following features are planned for future releases:

- **v1.1.0** — Barcode scanner integration (camera-based via QuaggaJS)
- **v1.2.0** — Multi-currency support with exchange rate lookup
- **v1.3.0** — Customer account management with purchase history
- **v1.4.0** — Purchase order management and supplier ordering workflow
- **v1.5.0** — PWA background sync for multi-device use via cloud sync API
- **v2.0.0** — Optional cloud backend (Supabase) for multi-location support

---

*Stockdity IMS is developed and maintained as a commercial product.
For support and update notifications, contact your authorised reseller.*
