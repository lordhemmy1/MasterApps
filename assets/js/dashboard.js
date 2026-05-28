/**
 * Stockdity IMS — Dashboard Module
 * Renders: KPI cards, sales trend chart, top products chart,
 * category distribution chart, recent sales table,
 * low stock panel, expiry alert panel, quick actions.
 * Runs expiry and low stock notification checks on every load.
 */

import db, {
  getLowStockProducts,
  getExpiringProducts,
  getTodaysSales,
  getTotalStockValue,
  getDailyRevenueTrend,
  getTopSellingProducts,
  getCategoryStockDistribution,
  getActiveProducts
} from './db.js';
import { decryptAll, isEncryptionReady } from './crypto-store.js';
import { getSession } from './auth.js';
import {
  showToast,
  renderEmptyState,
  renderKPISkeletons,
  renderSkeletons,
  stockStatusBadge,
  sanitize
} from './ui.js';
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatReceiptNumber,
  daysUntilExpiry,
  expiryStatus,
  chartColors,
  abbreviateNumber
} from './utils.js';
import { generateNotificationsForDashboard } from './notifications.js';
import { refreshNotificationBadge } from './app.js';

// ─── MODULE STATE ──────────────────────────────────────────────────────────────
let chartInstances = {};
let _destroyed     = false;

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  _destroyed = false;

  const content = document.getElementById('app-content');
  if (!content) return;

  // Render the page shell immediately with skeleton loaders
  content.innerHTML = buildDashboardShell();

  // Run notification checks (non-blocking)
  generateNotificationsForDashboard().then(() => {
    refreshNotificationBadge();
  }).catch(err => console.warn('[Dashboard] Notification check error:', err));

  // Load all data in parallel
  try {
    await Promise.all([
      loadKPICards(),
      loadQuickActions(),
      loadSalesTrendChart(),
      loadTopProductsChart(),
      loadCategoryChart(),
      loadRecentSalesTable(),
      loadLowStockPanel(),
      loadExpiryPanel()
    ]);
  } catch (err) {
    console.error('[Dashboard] Load error:', err);
    showToast('Dashboard failed to load some data.', 'error');
  }
}

// ─── DESTROY ──────────────────────────────────────────────────────────────────
function destroy() {
  _destroyed = true;
  // Destroy all Chart.js instances to prevent "canvas already in use" errors
  Object.values(chartInstances).forEach(chart => {
    try { chart.destroy(); } catch { /* ignore */ }
  });
  chartInstances = {};
}

// ─── SHELL HTML ───────────────────────────────────────────────────────────────
function buildDashboardShell() {
  const user = getSession();
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return `
    <div class="page-header">
      <div>
        <h1 class="page-title">${greeting}, ${sanitize(user?.name?.split(' ')[0] || 'there')} 👋</h1>
        <p class="page-subtitle">Here's what's happening with your inventory today.</p>
      </div>
      <div class="page-actions">
        <span class="text-sm text-muted" id="dashboard-last-updated"></span>
        <button class="btn btn-secondary btn-sm" id="dashboard-refresh-btn">
          <i class="fa-solid fa-rotate"></i> Refresh
        </button>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="quick-actions" id="quick-actions-area">
      <div class="skeleton" style="height:52px;width:160px;border-radius:var(--radius-lg);"></div>
      <div class="skeleton" style="height:52px;width:160px;border-radius:var(--radius-lg);"></div>
      <div class="skeleton" style="height:52px;width:160px;border-radius:var(--radius-lg);"></div>
    </div>

    <!-- KPI Cards -->
    <div class="kpi-grid" id="kpi-grid">
      <!-- Skeleton loaded inline -->
    </div>

    <!-- Charts Row -->
    <div class="dashboard-grid" style="margin-bottom:var(--space-xl);">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><i class="fa-solid fa-chart-line"></i> Sales Trend (Last 30 Days)</h3>
        </div>
        <div class="chart-canvas-wrap" id="sales-trend-wrap">
          <div class="skeleton skeleton-chart"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><i class="fa-solid fa-trophy"></i> Top 5 Products This Month</h3>
        </div>
        <div class="chart-canvas-wrap" id="top-products-wrap">
          <div class="skeleton skeleton-chart"></div>
        </div>
      </div>
    </div>

    <!-- Second Charts Row -->
    <div class="dashboard-grid-3" style="margin-bottom:var(--space-xl);">
      <div class="card">
        <div class="card-header">
          <h3 class="card-title"><i class="fa-solid fa-chart-pie"></i> Stock by Category</h3>
        </div>
        <div class="chart-canvas-wrap" id="category-chart-wrap" style="height:220px;">
          <div class="skeleton skeleton-chart" style="height:220px;"></div>
        </div>
      </div>

      <!-- Low Stock Panel -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title" style="color:var(--color-warning);">
            <i class="fa-solid fa-triangle-exclamation"></i> Low Stock Alerts
          </h3>
          <a href="#/stock/in" class="btn btn-warning btn-sm">
            <i class="fa-solid fa-plus"></i> Stock In
          </a>
        </div>
        <div id="low-stock-panel">
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text w-75"></div>
          <div class="skeleton skeleton-text w-50"></div>
        </div>
      </div>

      <!-- Expiry Panel -->
      <div class="card">
        <div class="card-header">
          <h3 class="card-title" style="color:var(--color-danger);">
            <i class="fa-solid fa-clock"></i> Expiry Alerts
          </h3>
          <a href="#/reports?report=expiry" class="btn btn-outline-primary btn-sm">
            <i class="fa-solid fa-file-lines"></i> Report
          </a>
        </div>
        <div id="expiry-panel">
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text w-75"></div>
          <div class="skeleton skeleton-text w-50"></div>
        </div>
      </div>
    </div>

    <!-- Recent Sales Table -->
    <div class="card">
      <div class="card-header">
        <h3 class="card-title"><i class="fa-solid fa-receipt"></i> Recent Sales</h3>
        <a href="#/sales" class="btn btn-ghost btn-sm">
          View All <i class="fa-solid fa-arrow-right"></i>
        </a>
      </div>
      <div id="recent-sales-table">
        <div class="skeleton skeleton-table-row"></div>
        <div class="skeleton skeleton-table-row"></div>
        <div class="skeleton skeleton-table-row"></div>
        <div class="skeleton skeleton-table-row"></div>
        <div class="skeleton skeleton-table-row"></div>
      </div>
    </div>
  `;
}

// ─── KPI CARDS ────────────────────────────────────────────────────────────────
async function loadKPICards() {
  const grid = document.getElementById('kpi-grid');
  if (!grid) return;

  renderKPISkeletons(grid);

  try {
   const [
      storedProducts,
      categories,
      stockValue,
      lowStockProducts,
      expiringProducts,
      todaysSales
    ] = await Promise.all([
      db.products.toArray(),   // ← changed: get all, decrypt below
      db.categories.count(),
      getTotalStockValue(),
      getLowStockProducts(),
      getExpiringProducts(30),
      getTodaysSales()
    ]);

    const activeProductCount = isEncryptionReady()
      ? (await decryptAll(storedProducts)).filter(p => !!p.is_active).length
      : storedProducts.filter(p => !!p.is_active).length;    
    
    if (_destroyed) return;

    const todaysRevenue = todaysSales.reduce((s, sale) => s + sale.total_amount, 0);
    const currency      = window.AppState.settings?.currency_symbol || window.AppConfig?.DEFAULT_CURRENCY_SYMBOL || '₦';

    const kpis = [
      {
        icon:    'fa-boxes-stacked',
        iconCls: 'kpi-icon-blue',
        value:   products.toLocaleString(),
        label:   'Total Products',
        href:    '#/products'
      },
      {
        icon:    'fa-tags',
        iconCls: 'kpi-icon-purple',
        value:   categories.toLocaleString(),
        label:   'Categories',
        href:    '#/categories'
      },
      {
        icon:    'fa-sack-dollar',
        iconCls: 'kpi-icon-green',
        value:   formatCurrency(stockValue, currency),
        label:   'Total Stock Value',
        href:    '#/reports'
      },
      {
        icon:    'fa-triangle-exclamation',
        iconCls: 'kpi-icon-amber',
        value:   lowStockProducts.length.toLocaleString(),
        label:   'Low Stock Items',
        href:    '#/reports?report=lowstock'
      },
      {
        icon:    'fa-clock',
        iconCls: 'kpi-icon-red',
        value:   expiringProducts.length.toLocaleString(),
        label:   'Expiring Soon (30d)',
        href:    '#/reports?report=expiry'
      },
      {
        icon:    'fa-cash-register',
        iconCls: 'kpi-icon-teal',
        value:   formatCurrency(todaysRevenue, currency),
        label:   "Today's Revenue",
        href:    '#/sales'
      }
    ];

    grid.innerHTML = kpis.map(kpi => `
      <a href="${kpi.href}" class="kpi-card" style="text-decoration:none;color:inherit;">
        <div class="kpi-card-icon ${kpi.iconCls}">
          <i class="fa-solid ${kpi.icon}"></i>
        </div>
        <div class="kpi-card-value">${sanitize(String(kpi.value))}</div>
        <div class="kpi-card-label">${sanitize(kpi.label)}</div>
      </a>
    `).join('');

    // Update last refreshed timestamp
    const lastUpdated = document.getElementById('dashboard-last-updated');
    if (lastUpdated) {
      lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    }

  } catch (err) {
    console.error('[Dashboard] KPI error:', err);
    grid.innerHTML = `<div class="alert alert-danger" style="grid-column:1/-1;">Failed to load KPIs.</div>`;
  }
}

// ─── QUICK ACTIONS ────────────────────────────────────────────────────────────
async function loadQuickActions() {
  const area = document.getElementById('quick-actions-area');
  if (!area) return;

  area.innerHTML = `
    <a href="#/products/add" class="quick-action-btn">
      <i class="fa-solid fa-plus"></i> Add Product
    </a>
    <a href="#/sales/new" class="quick-action-btn">
      <i class="fa-solid fa-cash-register"></i> New Sale
    </a>
    <a href="#/stock/in" class="quick-action-btn">
      <i class="fa-solid fa-arrow-down-to-line"></i> Stock In
    </a>
    <a href="#/reports" class="quick-action-btn">
      <i class="fa-solid fa-chart-bar"></i> Reports
    </a>
  `;

  // Refresh button
  document.getElementById('dashboard-refresh-btn')?.addEventListener('click', () => {
    destroy();
    init();
  });
}

// ─── SALES TREND CHART ────────────────────────────────────────────────────────
async function loadSalesTrendChart() {
  const wrap = document.getElementById('sales-trend-wrap');
  if (!wrap) return;

  try {
    const trend    = await getDailyRevenueTrend(30);
    if (_destroyed) return;

    const currency = window.AppState.settings?.currency_symbol || '₦';
    const colors   = chartColors(1);

    wrap.innerHTML = `<canvas id="sales-trend-chart" style="width:100%;height:100%;"></canvas>`;
    const ctx      = document.getElementById('sales-trend-chart')?.getContext('2d');
    if (!ctx) return;

    // Destroy existing instance if any
    if (chartInstances.salesTrend) {
      chartInstances.salesTrend.destroy();
    }

    chartInstances.salesTrend = new Chart(ctx, {
      type: 'line',
      data: {
        labels:   trend.map(d => {
          const date = new Date(d.date);
          return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        }),
        datasets: [{
          label:           'Revenue',
          data:            trend.map(d => d.revenue),
          borderColor:     colors.borders[0],
          backgroundColor: colors.borders[0] + '22',
          borderWidth:     2.5,
          fill:            true,
          tension:         0.4,
          pointRadius:     3,
          pointHoverRadius:6
        }]
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `${currency}${ctx.parsed.y.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
            }
          }
        },
        scales: {
          x: {
            grid:   { display: false },
            ticks:  { maxTicksLimit: 7, font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            ticks: {
              callback: v => `${currency}${abbreviateNumber(v)}`,
              font: { size: 11 }
            }
          }
        }
      }
    });

  } catch (err) {
    console.error('[Dashboard] Sales trend chart error:', err);
    if (wrap) wrap.innerHTML = renderEmptyState('No sales data available.', 'fa-solid fa-chart-line');
  }
}

// ─── TOP PRODUCTS CHART ───────────────────────────────────────────────────────
async function loadTopProductsChart() {
  const wrap = document.getElementById('top-products-wrap');
  if (!wrap) return;

  try {
    const topProducts = await getTopSellingProducts(5);
    if (_destroyed) return;

    if (!topProducts.length) {
      wrap.innerHTML = renderEmptyState('No sales data this month.', 'fa-solid fa-trophy');
      return;
    }

    const currency = window.AppState.settings?.currency_symbol || '₦';
    const colors   = chartColors(topProducts.length);

    wrap.innerHTML = `<canvas id="top-products-chart" style="width:100%;height:100%;"></canvas>`;
    const ctx = document.getElementById('top-products-chart')?.getContext('2d');
    if (!ctx) return;

    if (chartInstances.topProducts) chartInstances.topProducts.destroy();

    chartInstances.topProducts = new Chart(ctx, {
      type: 'bar',
      data: {
        labels:   topProducts.map(p => truncateLabel(p.product_name, 20)),
        datasets: [{
          label:           'Units Sold',
          data:            topProducts.map(p => p.units_sold),
          backgroundColor: colors.backgrounds,
          borderColor:     colors.borders,
          borderWidth:     1,
          borderRadius:    4
        }]
      },
      options: {
        indexAxis:           'y',
        responsive:          true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: (ctx) => {
                const rev = topProducts[ctx.dataIndex]?.revenue || 0;
                return `Revenue: ${currency}${rev.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { stepSize: 1, font: { size: 11 } }
          },
          y: {
            ticks: { font: { size: 11 } }
          }
        }
      }
    });

  } catch (err) {
    console.error('[Dashboard] Top products chart error:', err);
    if (wrap) wrap.innerHTML = renderEmptyState('Could not load chart.', 'fa-solid fa-trophy');
  }
}

// ─── CATEGORY DISTRIBUTION CHART ─────────────────────────────────────────────
async function loadCategoryChart() {
  const wrap = document.getElementById('category-chart-wrap');
  if (!wrap) return;

  try {
    const distribution = await getCategoryStockDistribution();
    if (_destroyed) return;

    if (!distribution.length || distribution.every(d => d.total_quantity === 0)) {
      wrap.innerHTML = renderEmptyState('No stock data available.', 'fa-solid fa-chart-pie');
      return;
    }

    const colors = chartColors(distribution.length);

    wrap.innerHTML = `<canvas id="category-chart" style="width:100%;height:100%;"></canvas>`;
    const ctx = document.getElementById('category-chart')?.getContext('2d');
    if (!ctx) return;

    if (chartInstances.category) chartInstances.category.destroy();

    chartInstances.category = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels:   distribution.map(d => d.category_name),
        datasets: [{
          data:            distribution.map(d => d.total_quantity),
          backgroundColor: colors.backgrounds,
          borderColor:     colors.borders,
          borderWidth:     2,
          hoverOffset:     6
        }]
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        cutout:              '60%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 12, font: { size: 11 }, padding: 8 }
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed.toLocaleString()} units`
            }
          }
        }
      }
    });

  } catch (err) {
    console.error('[Dashboard] Category chart error:', err);
    if (wrap) wrap.innerHTML = renderEmptyState('Could not load chart.', 'fa-solid fa-chart-pie');
  }
}

// ─── RECENT SALES TABLE ───────────────────────────────────────────────────────
async function loadRecentSalesTable() {
  const container = document.getElementById('recent-sales-table');
  if (!container) return;

  try {
    const storedSales = await db.sales.toArray();
    const allSales    = isEncryptionReady() ? await decryptAll(storedSales) : storedSales;
    const recentSales = allSales
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 10);

    if (_destroyed) return;
    if (!recentSales.length) { /* unchanged empty state */ }

    const currency = window.AppState.settings?.currency_symbol || '₦';

    const saleIds        = recentSales.map(s => s.id);
    const storedItems    = await db.sale_items.toArray();
    const allItems       = isEncryptionReady() ? await decryptAll(storedItems) : storedItems;
    const saleItems      = allItems.filter(i => saleIds.includes(i.sale_id));
    const itemCounts     = {};
    saleItems.forEach(item => {
      itemCounts[item.sale_id] = (itemCounts[item.sale_id] || 0) + 1;
    });
    
    
    container.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Receipt</th>
              <th>Date & Time</th>
              <th>Customer</th>
              <th>Items</th>
              <th>Total</th>
              <th>Payment</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${recentSales.map(sale => {
              const paymentIcons = {
                cash: 'fa-money-bill-wave', card: 'fa-credit-card',
                transfer: 'fa-building-columns', credit: 'fa-clock'
              };
              const payIcon  = paymentIcons[sale.payment_method] || 'fa-question';
              const isVoided = sale.status === 'voided';

              return `
                <tr>
                  <td><strong>${sanitize(formatReceiptNumber(sale.id))}</strong></td>
                  <td style="white-space:nowrap;">${sanitize(formatDateTime(sale.created_at))}</td>
                  <td>${sanitize(sale.customer_name || '—')}</td>
                  <td><span class="badge badge-neutral">${itemCounts[sale.id] || 0} item(s)</span></td>
                  <td><strong>${formatCurrency(sale.total_amount, currency)}</strong></td>
                  <td>
                    <span class="badge badge-info">
                      <i class="fa-solid ${payIcon}"></i>
                      ${sanitize(sale.payment_method)}
                    </span>
                  </td>
                  <td>
                    ${isVoided
                      ? `<span class="badge badge-danger"><i class="fa-solid fa-ban"></i> Voided</span>`
                      : `<span class="badge badge-success"><i class="fa-solid fa-check"></i> Completed</span>`
                    }
                  </td>
                  <td>
                    <a href="#/sales/${sale.id}" class="btn btn-ghost btn-sm">
                      <i class="fa-solid fa-eye"></i> View
                    </a>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

  } catch (err) {
    console.error('[Dashboard] Recent sales error:', err);
    if (container) container.innerHTML = `<div class="alert alert-danger">Failed to load recent sales.</div>`;
  }
}

// ─── LOW STOCK PANEL ──────────────────────────────────────────────────────────
async function loadLowStockPanel() {
  const panel = document.getElementById('low-stock-panel');
  if (!panel) return;

  try {
    const lowStock = await getLowStockProducts();
    if (_destroyed) return;

    if (!lowStock.length) {
      panel.innerHTML = `
        <div class="empty-state" style="padding:var(--space-xl) var(--space-md);">
          <i class="fa-solid fa-circle-check empty-state-icon" style="color:var(--color-success);font-size:2rem;"></i>
          <p class="empty-state-title" style="font-size:var(--text-sm);">All products are well-stocked</p>
        </div>
      `;
      return;
    }

    panel.innerHTML = `
      <div class="alert-panel-list">
        ${lowStock.slice(0, 6).map(p => `
          <div class="alert-panel-item">
            <div class="alert-panel-info">
              <div class="alert-panel-name">${sanitize(p.name)}</div>
              <div class="alert-panel-meta">
                <span class="text-danger font-semibold">${p.quantity} units</span>
                &nbsp;/ threshold: ${p.low_stock_threshold}
              </div>
            </div>
            <a href="#/stock/in" class="btn btn-warning btn-sm">
              <i class="fa-solid fa-plus"></i>
            </a>
          </div>
        `).join('')}
        ${lowStock.length > 6 ? `
          <a href="#/reports?report=lowstock" class="btn btn-ghost btn-sm" style="width:100%;margin-top:var(--space-xs);">
            View all ${lowStock.length} low stock items →
          </a>
        ` : ''}
      </div>
    `;

  } catch (err) {
    console.error('[Dashboard] Low stock panel error:', err);
    if (panel) panel.innerHTML = `<div class="alert alert-danger">Failed to load.</div>`;
  }
}

// ─── EXPIRY ALERT PANEL ───────────────────────────────────────────────────────
async function loadExpiryPanel() {
  const panel = document.getElementById('expiry-panel');
  if (!panel) return;

  try {
    const expiring = await getExpiringProducts(30);
    if (_destroyed) return;

    if (!expiring.length) {
      panel.innerHTML = `
        <div class="empty-state" style="padding:var(--space-xl) var(--space-md);">
          <i class="fa-solid fa-circle-check empty-state-icon" style="color:var(--color-success);font-size:2rem;"></i>
          <p class="empty-state-title" style="font-size:var(--text-sm);">No products expiring soon</p>
        </div>
      `;
      return;
    }

    // Sort: most critical first (lowest days remaining)
    const sorted = [...expiring].sort((a, b) => {
      const dA = daysUntilExpiry(a.expiry_date) ?? 999;
      const dB = daysUntilExpiry(b.expiry_date) ?? 999;
      return dA - dB;
    });

    panel.innerHTML = `
      <div class="alert-panel-list">
        ${sorted.slice(0, 6).map(p => {
          const { label, cssClass } = expiryStatus(p.expiry_date);
          return `
            <div class="alert-panel-item">
              <div class="alert-panel-info">
                <div class="alert-panel-name">${sanitize(p.name)}</div>
                <div class="alert-panel-meta">
                  <span class="${cssClass} font-semibold">${sanitize(label)}</span>
                  &nbsp;· ${p.quantity} units
                </div>
              </div>
            </div>
          `;
        }).join('')}
        ${sorted.length > 6 ? `
          <a href="#/reports?report=expiry" class="btn btn-ghost btn-sm" style="width:100%;margin-top:var(--space-xs);">
            View all ${sorted.length} expiring products →
          </a>
        ` : ''}
      </div>
    `;

  } catch (err) {
    console.error('[Dashboard] Expiry panel error:', err);
    if (panel) panel.innerHTML = `<div class="alert alert-danger">Failed to load.</div>`;
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function truncateLabel(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export { init, destroy };
