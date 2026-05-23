# Stockdity IMS — Inventory Management System

**Version:** 1.0.0 | **Release Date:** 2024-01-01
**Technology:** Pure HTML5 · CSS3 · Vanilla JavaScript ES6+ · IndexedDB (Dexie.js)

---

## Overview

Stockdity IMS is a complete, offline-capable inventory management system that
runs entirely in the browser. There is no server, no database server, no PHP,
no Node.js, and no monthly infrastructure cost. All data is stored locally in
IndexedDB via Dexie.js.

The application is sold as a one-time purchase. The buyer receives a licence key
and a zip file containing the application. They deploy the files to any static
web host or run them locally and use the system indefinitely.

---

## Feature Overview

### Dashboard
- 6 KPI cards: total products, categories, stock value, low stock count,
  expiring soon count, today's revenue
- 30-day sales trend line chart
- Top 5 best-selling products this month (horizontal bar chart)
- Category stock distribution doughnut chart
- Recent sales table (last 10 sales)
- Low stock alert panel with direct Stock In link
- Expiry alert panel with colour-coded urgency
- Quick action buttons

### Product Management
- Full product catalogue with image uploads (base64 stored in IndexedDB)
- Auto-generated SKUs based on category code
- Real-time profit margin calculator
- Expiry date tracking with colour-coded status
- Stock status badges (In Stock / Low Stock / Out of Stock / Expired)
- Sortable, filterable, paginated product list
- CSV bulk import with row-by-row validation report
- CSV bulk export
- Product detail page with full stock movement history

### Inventory Tracking
- Stock In: record incoming stock with supplier and invoice reference
- Stock Out: record stock removed for non-sale reasons
- Stock Adjustment: correct quantity discrepancies with justification
- Full stock movement history with filters and CSV export
- All quantity changes wrapped in Dexie transactions for integrity

### Sales
- POS-style sales entry with live product search
- Cart with quantity validation against real-time stock levels
- Payment methods: Cash, Card, Bank Transfer, Credit
- Sale confirmation with print receipt option
- Thermal-width (80mm) and A4 receipt layouts
- Sales history with date range, status, and payment filters
- Sale voiding (admin/manager) with automatic stock restoration
- Daily summary bar showing transaction count and payment breakdown

### Reports (10 report types)
All reports support CSV and PDF export (via jsPDF + AutoTable).
1. Daily Sales Report
2. Weekly Sales Summary (bar chart)
3. Monthly Sales Summary (line chart)
4. Inventory Status Report (with profit margin)
5. Out of Stock Report (sorted by days since last stocked)
6. Low Stock Report (with visual stock level bars)
7. Expiry Report (configurable day window)
8. Best Selling Products (horizontal bar chart)
9. Stock Movement Report (filterable by type and date)
10. Supplier Report (deliveries, units, estimated cost value)

### Categories & Suppliers
- Category management with product count display
- Safe deletion with product reassignment modal
- Supplier management with full contact information
- Supplier profile page with supply history and statistics
- Activate/deactivate suppliers

### Notifications
- Automatic low stock alerts (one per product per day)
- Automatic expiry alerts for products expiring within 30 days
- Daily system notification for out-of-stock products (admin only)
- Bell icon in topbar with unread count badge
- Full notifications page with mark-read and delete functions
- Optional email alerts via EmailJS (configurable in Settings)

### User Management (Admin only)
- Multi-user support with role-based access control
- Roles: Admin, Manager, Staff (ascending privilege)
- Add / Edit / Deactivate users
- Admin password reset for any user
- Force password change on new accounts and resets
- Avatar initials with deterministic colour assignment

### Settings (Admin only)
- Business Profile: name, address, phone, email, logo
- Preferences: currency symbol, date format, low stock threshold,
  sidebar state, primary colour (live preview)
- Notifications: EmailJS configuration, test email button
- Licence: view activation details, deactivate licence
- Change Password: available to all logged-in users
- Data Management: export all data (JSON), import backup, clear all data

### Security
- SHA-256 + random salt password hashing via Web Crypto API
- Timing-safe password comparison
- Login rate limiting (5 attempts / 10 min window → 15-min lockout)
- Role-based route guards on every navigation
- XSS sanitisation on all dynamic DOM insertions
- Licence key validated via SHA-256 hash comparison (key never in source)
- Image type and size validation before FileReader conversion
- Session stored in sessionStorage (cleared on browser close)

---

## System Requirements

### Browser Compatibility
Stockdity IMS requires a modern browser with the following APIs:
- **IndexedDB** — for local data storage (Dexie.js)
- **Web Crypto API** (`crypto.subtle.digest`) — for password and licence hashing
- **FileReader API** — for image uploads
- **Service Worker API** — for offline support (optional; app works without it)

Supported browsers:
| Browser         | Minimum Version |
|-----------------|-----------------|
| Chrome / Edge   | 90+             |
| Firefox         | 89+             |
| Safari          | 15+             |
| Opera           | 76+             |

> Internet Explorer is not supported. Microsoft Edge (Chromium) is fully supported.

### Disk / Storage
- Application files: approximately 500 KB (uncompressed)
- IndexedDB storage: limited by browser quota (typically 50–80% of available disk)
- For 10,000 products and 50,000 sales records, expect approximately 50–200 MB
  of IndexedDB usage depending on image sizes

### Internet Connection
- Required on first load to fetch CDN libraries (Dexie.js, Chart.js, jsPDF, etc.)
- After first load, the Service Worker caches all files for offline use
- Data operations (read, write, reports) work 100% offline once the app is loaded
- EmailJS notifications require an internet connection at the time of sending

---

## Deployment Guide

### Option 1 — Netlify (Recommended for most users)

1. Download and unzip the Stockdity IMS files
2. Go to https://app.netlify.com and sign up for a free account
3. From the Netlify dashboard, click **"Add new site" → "Deploy manually"**
4. Drag and drop your entire Stockdity IMS folder onto the upload area
5. Netlify provides an instant HTTPS URL (e.g., `https://your-site.netlify.app`)
6. Optional: add a custom domain in **Site settings → Domain management**

> The Service Worker requires HTTPS to function. Netlify provides this automatically.

### Option 2 — GitHub Pages

1. Create a new repository on GitHub (public or private with GitHub Pro)
2. Upload all Stockdity IMS files to the repository root
3. Go to **Settings → Pages → Source → Deploy from branch → main → root**
4. GitHub Pages provides a URL at `https://yourusername.github.io/repo-name`

> Note: `sw.js` (Service Worker) scope may be limited on GitHub Pages subdirectory
> paths. For best results, deploy to a custom domain or use Netlify.

### Option 3 — cPanel File Manager (Shared Hosting)

1. Log in to your cPanel control panel
2. Open **File Manager** and navigate to `public_html`
   (or a subdirectory like `public_html/inventory`)
3. Click **Upload** and upload all Stockdity IMS files, preserving the folder structure
4. Access the application at `https://yourdomain.com` or
   `https://yourdomain.com/inventory`

> Ensure your hosting provides HTTPS (most modern shared hosts do via Let's Encrypt).

### Option 4 — Cloudflare Pages

1. Push your Stockdity IMS files to a GitHub or GitLab repository
2. Go to https://pages.cloudflare.com and connect your repository
3. Set the build command to: *(leave blank — no build step needed)*
4. Set the output directory to: `/` (root)
5. Cloudflare Pages provides HTTPS automatically at `your-project.pages.dev`

### Option 5 — Self-Hosted Nginx on Ubuntu

```nginx
server {
    listen 80;
    listen 443 ssl;
    server_name inventory.yourdomain.com;

    # SSL certificate (Let's Encrypt recommended)
    ssl_certificate     /etc/letsencrypt/live/inventory.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/inventory.yourdomain.com/privkey.pem;

    root /var/www/Stockdity;
    index index.html;

    # Serve all routes to index.html (SPA routing via hash — no special config needed)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|webp|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    # Service Worker — must not be cached by the browser
    location = /sw.js {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        expires 0;
    }
}
```

```bash
# Deploy commands
sudo mkdir -p /var/www/Stockdity
sudo cp -r /path/to/Stockdity-ims/* /var/www/Stockdity/
sudo chown -R www-data:www-data /var/www/Stockdity
sudo nginx -t && sudo systemctl reload nginx
```

### Option 6 — Local File System (file:// protocol)

> **Important limitation:** ES6 modules (`<script type="module">`) and
> Service Workers do not work when opened directly from the file system
> (i.e., via `file:///path/to/index.html`) due to browser CORS restrictions.

To run locally without a web server, use one of these approaches:

**Using Python (built-in, no install needed):**
```bash
cd /path/to/Stockdity-ims
python3 -m http.server 8080
# Then open: http://localhost:8080
```

**Using Node.js (if installed):**
```bash
npx serve /path/to/Stockdity-ims
# Then open the URL shown in the terminal
```

**Using VS Code Live Server:**
Install the "Live Server" extension in VS Code, open the Stockdity-IMS
folder, right-click `index.html`, and select "Open with Live Server".

---

## Licence Key Setup (For Sellers)

Each customer receives a unique licence key. Before delivering the files,
the seller must:

### Step 1 — Generate a Unique Licence Key
Choose a random, hard-to-guess key for the customer. A good format is:
