/**
 * Stockdity IMS — Reports Module
 * All report generators: daily sales, weekly/monthly summaries,
 * inventory status, out-of-stock, low stock, expiry,
 * best sellers, stock movements, supplier report, annual summary,
 * executive analysis.
 * Supports CSV and PDF export for every report.
 */

import db, { getSalesInRange, getActiveProducts } from './db.js';
import { getSession } from './auth.js';
import {
  showToast, showSpinner, hideSpinner,
  renderEmptyState, sanitize
} from './ui.js';
import {
  formatCurrency, formatDate, formatDateTime,
  formatDateShort, formatReceiptNumber,
  daysUntilExpiry, expiryStatus,
  getDateRange, exportCSV, chartColors,
  groupBy, sum, sortBy, calculateProfitMargin
} from './utils.js';
import AppConfig from '../../config.js';

// ─── MODULE STATE ─────────────────────────────────────────────────────────────
let _chartInstances = {};
let _destroyed      = false;
let _activeReport   = '';

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init(params = {}) {
  _destroyed = false;

  const content = document.getElementById('app-content');
  if (!content) return;

  // Pre-select report from query param
  _activeReport = params.query?.report || 'daily';

  renderReportsShell();
  bindTabEvents();
  await loadReport(_activeReport);
}

function destroy() {
  _destroyed = true;
  destroyAllCharts();
}

function destroyAllCharts() {
  Object.values(_chartInstances).forEach(chart => {
    try { chart.destroy(); } catch { /* ignore */ }
  });
  _chartInstances = {};
}

// ─── REPORTS SHELL ────────────────────────────────────────────────────────────
function renderReportsShell() {
  const content = document.getElementById('app-content');
  if (!content) return;

  const reports = [
    { key: 'daily',     label: 'Daily Sales',       icon: 'fa-calendar-day'   },
    { key: 'weekly',    label: 'Weekly Summary',     icon: 'fa-calendar-week'  },
    { key: 'monthly',   label: 'Monthly Summary',    icon: 'fa-calendar'       },
    { key: 'annual',    label: 'Annual Summary',     icon: 'fa-calendar-check' },   // ← NEW
    { key: 'executive', label: 'Executive Analysis', icon: 'fa-file-invoice'   },   // ← NEW
    { key: 'inventory', label: 'Inventory Status',   icon: 'fa-boxes-stacked'  },
    { key: 'outofstock',label: 'Out of Stock',       icon: 'fa-xmark-circle'   },
    { key: 'lowstock',  label: 'Low Stock',          icon: 'fa-triangle-exclamation' },
    { key: 'expiry',    label: 'Expiry Report',      icon: 'fa-clock'          },
    { key: 'bestsellers',label:'Best Sellers',       icon: 'fa-trophy'         },
    { key: 'movements', label: 'Stock Movements',    icon: 'fa-clock-rotate-left'},
    { key: 'supplier',  label: 'Supplier Report',    icon: 'fa-truck'          }
  ];

  content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title"><i class="fa-solid fa-chart-bar"></i> Reports</h1>
        <p class="page-subtitle">Generate and export business intelligence reports.</p>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:220px 1fr;gap:var(--space-xl);align-items:start;">

      <!-- Report Menu -->
      <div class="card" style="padding:var(--space-sm);">
        <ul style="list-style:none;margin:0;padding:0;">
          ${reports.map(r => `
            <li>
              <button
                class="report-menu-btn ${_activeReport === r.key ? 'active' : ''}"
                data-report="${r.key}"
                style="
                  display:flex;align-items:center;gap:var(--space-md);
                  width:100%;padding:var(--space-sm) var(--space-md);
                  border-radius:var(--radius-md);font-size:var(--text-sm);
                  font-weight:500;color:var(--color-text-secondary);
                  background:${_activeReport === r.key ? 'var(--color-primary-light)' : 'transparent'};
                  color:${_activeReport === r.key ? 'var(--color-primary)' : 'var(--color-text-secondary)'};
                  transition:all var(--transition-fast);
                  cursor:pointer;border:none;text-align:left;
                  margin-bottom:2px;
                "
              >
                <i class="fa-solid ${r.icon}" style="width:16px;text-align:center;"></i>
                ${sanitize(r.label)}
              </button>
            </li>
          `).join('')}
        </ul>
      </div>

      <!-- Report Content -->
      <div id="report-content-area">
        <div class="card">
          <div class="skeleton skeleton-chart" style="margin-bottom:var(--space-lg);"></div>
          <div class="skeleton skeleton-text"></div>
          <div class="skeleton skeleton-text w-75"></div>
        </div>
      </div>
    </div>
  `;
}

function bindTabEvents() {
  document.querySelectorAll('.report-menu-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const report = btn.dataset.report;
      if (report === _activeReport) return;

      _activeReport = report;

      // Update active state
      document.querySelectorAll('.report-menu-btn').forEach(b => {
        const isActive = b.dataset.report === report;
        b.style.background = isActive ? 'var(--color-primary-light)' : 'transparent';
        b.style.color      = isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)';
      });

      destroyAllCharts();
      await loadReport(report);
    });
  });
}

async function loadReport(report) {
  const area = document.getElementById('report-content-area');
  if (!area) return;

  area.innerHTML = `
    <div class="card">
      <div class="skeleton skeleton-chart" style="margin-bottom:var(--space-lg);"></div>
      <div class="skeleton skeleton-text"></div>
      <div class="skeleton skeleton-text w-75"></div>
    </div>
  `;

  try {
    switch (report) {
      case 'daily':       await renderDailySalesReport(area);      break;
      case 'weekly':      await renderWeeklyReport(area);           break;
      case 'monthly':     await renderMonthlyReport(area);          break;
      case 'annual':      await renderAnnualReport(area);           break;   // ← NEW
      case 'executive':   await renderExecutiveReport(area);        break;   // ← NEW
      case 'inventory':   await renderInventoryReport(area);        break;
      case 'outofstock':  await renderOutOfStockReport(area);       break;
      case 'lowstock':    await renderLowStockReport(area);         break;
      case 'expiry':      await renderExpiryReport(area);           break;
      case 'bestsellers': await renderBestSellersReport(area);      break;
      case 'movements':   await renderMovementsReport(area);        break;
      case 'supplier':    await renderSupplierReport(area);         break;
      default:            await renderDailySalesReport(area);
    }
  } catch (err) {
    console.error(`[Reports] Error loading ${report}:`, err);
    area.innerHTML = `
      <div class="card">
        <div class="alert alert-danger">Failed to generate report. Please try again.</div>
      </div>
    `;
  }
}

// ─── SHARED HELPERS ───────────────────────────────────────────────────────────
const currency = () => window.AppState.settings?.currency_symbol || '₦';

function reportHeader(title, subtitle = '') {
  return `
    <div class="card-header">
      <div>
        <h2 class="card-title" style="font-size:var(--text-xl);">${sanitize(title)}</h2>
        ${subtitle ? `<p class="text-sm text-muted" style="margin-top:2px;">${sanitize(subtitle)}</p>` : ''}
      </div>
      <div style="display:flex;gap:var(--space-sm);">
        <button class="btn btn-secondary btn-sm" id="report-export-csv">
          <i class="fa-solid fa-file-csv"></i> CSV
        </button>
        <button class="btn btn-secondary btn-sm" id="report-export-pdf">
          <i class="fa-solid fa-file-pdf"></i> PDF
        </button>
      </div>
    </div>
  `;
}

function summaryBox(stats) {
  return `
    <div class="stat-row" style="margin-bottom:var(--space-xl);">
      ${stats.map(s => `
        <div class="stat-row-item">
          <span class="stat-row-label">${sanitize(s.label)}</span>
          <span class="stat-row-value">${sanitize(String(s.value))}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function dateRangeControl(id, defaultPreset = 'this_month') {
  const { start, end } = getDateRange(defaultPreset);
  return `
    <div style="display:flex;gap:var(--space-md);align-items:center;flex-wrap:wrap;margin-bottom:var(--space-lg);">
      <div style="display:flex;align-items:center;gap:var(--space-sm);">
        <label class="form-label" style="margin:0;white-space:nowrap;">From:</label>
        <input class="form-input" type="date" id="${id}-from"
          value="${start.toISOString().slice(0,10)}" style="width:150px;" />
      </div>
      <div style="display:flex;align-items:center;gap:var(--space-sm);">
        <label class="form-label" style="margin:0;white-space:nowrap;">To:</label>
        <input class="form-input" type="date" id="${id}-to"
          value="${end.toISOString().slice(0,10)}" style="width:150px;" />
      </div>
      <button class="btn btn-primary btn-sm" id="${id}-run-btn">
        <i class="fa-solid fa-rotate"></i> Generate
      </button>
    </div>
  `;
}

function buildPDFHeader(doc, title, settings) {
  const bizName = settings.business_name || AppConfig.APP_NAME;
  const logoB64 = settings.business_logo_base64 || '';
  const pageW   = doc.internal.pageSize.getWidth();
  const pri     = hexToRgb(settings.primary_color || AppConfig.DEFAULT_PRIMARY_COLOR);

  // Header background
  doc.setFillColor(...pri);
  doc.rect(0, 0, pageW, 28, 'F');

  let xPos = 14;
  if (logoB64) {
    try {
      doc.addImage(logoB64, 'PNG', 14, 4, 20, 20);
      xPos = 40;
    } catch { /* logo failed */ }
  }

  // Business name
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(bizName, xPos, 13);

  // Subtitle
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(settings.business_address || '', xPos, 20);

  // Report title
  doc.setTextColor(51, 51, 51);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 40);

  // Generation date
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120, 120, 120);
  doc.text(`Generated: ${formatDateTime(new Date().toISOString())}`, 14, 47);

  return 55; // Y offset after header
}

function hexToRgb(hex) {
  const clean  = (hex || '#4F46E5').replace('#', '');
  const bigint = parseInt(clean, 16);
  return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
}

function tableStyle(primary) {
  const [r, g, b] = hexToRgb(primary);
  return {
    headStyles:  { fillColor: [r, g, b], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [245, 245, 250] },
    styles:      { fontSize: 9, cellPadding: 3 },
    margin:      { left: 14, right: 14 }
  };
}

// ─── 1. DAILY SALES REPORT ────────────────────────────────────────────────────
async function renderDailySalesReport(area) {
  const today = new Date().toISOString().slice(0, 10);

  area.innerHTML = `
    <div class="card">
      ${reportHeader('Daily Sales Report')}
      <div style="padding:var(--space-lg);">
        <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg);">
          <label class="form-label" style="margin:0;">Select Date:</label>
          <input class="form-input" type="date" id="daily-date" value="${today}" style="width:180px;" />
          <button class="btn btn-primary btn-sm" id="daily-run-btn">
            <i class="fa-solid fa-rotate"></i> Generate
          </button>
        </div>
        <div id="daily-report-body"></div>
      </div>
    </div>
  `;

  async function generate() {
    const date    = document.getElementById('daily-date').value;
    const body    = document.getElementById('daily-report-body');
    if (!date || !body) return;

    body.innerHTML = `<div class="skeleton skeleton-chart"></div>`;

    const start = new Date(date); start.setHours(0, 0, 0, 0);
    const end   = new Date(date); end.setHours(23, 59, 59, 999);

    const sales = await getSalesInRange(start, end);
    const allItems  = await db.sale_items
      .where('sale_id').anyOf(sales.map(s => s.id))
      .toArray();

    const revenue   = sum(sales, 'total_amount');
    const avgTxn    = sales.length ? revenue / sales.length : 0;
    const totalUnits= sum(allItems, 'quantity');

    const payBreakdown = {};
    sales.forEach(s => {
      payBreakdown[s.payment_method] = (payBreakdown[s.payment_method] || 0) + s.total_amount;
    });

    let _reportData = sales;

    if (!sales.length) {
      body.innerHTML = renderEmptyState(`No sales recorded on ${formatDate(date)}.`, 'fa-solid fa-receipt');
      return;
    }

    body.innerHTML = `
      ${summaryBox([
        { label: 'Transactions',      value: sales.length },
        { label: 'Total Revenue',     value: formatCurrency(revenue, currency()) },
        { label: 'Avg. Transaction',  value: formatCurrency(avgTxn, currency()) },
        { label: 'Units Sold',        value: totalUnits.toLocaleString() }
      ])}

      <!-- Payment breakdown -->
      <div style="display:flex;gap:var(--space-xl);margin-bottom:var(--space-xl);flex-wrap:wrap;">
        ${Object.entries(payBreakdown).map(([method, amount]) => `
          <div>
            <div class="text-xs text-muted text-uppercase" style="font-weight:600;letter-spacing:0.05em;">
              ${sanitize(method.toUpperCase())}
            </div>
            <div class="font-bold" style="font-size:var(--text-lg);">
              ${formatCurrency(amount, currency())}
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Sales Table -->
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Receipt</th><th>Customer</th><th>Items</th>
              <th>Total</th><th>Payment</th><th>Time</th>
            </tr>
          </thead>
          <tbody>
            ${sales.map(s => {
              const itemCount = allItems.filter(i => i.sale_id === s.id).length;
              const time      = new Date(s.created_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
              return `
                <tr>
                  <td><strong>${sanitize(formatReceiptNumber(s.id))}</strong></td>
                  <td>${sanitize(s.customer_name || '—')}</td>
                  <td>${itemCount}</td>
                  <td><strong>${formatCurrency(s.total_amount, currency())}</strong></td>
                  <td>${sanitize(s.payment_method)}</td>
                  <td>${sanitize(time)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3"><strong>Total</strong></td>
              <td colspan="3"><strong>${formatCurrency(revenue, currency())}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;

    // Export handlers
    document.getElementById('report-export-csv')?.addEventListener('click', () => {
      const rows = sales.map(s => ({
        Receipt:   formatReceiptNumber(s.id),
        Customer:  s.customer_name || '',
        Total:     s.total_amount,
        Payment:   s.payment_method,
        Time:      formatDateTime(s.created_at)
      }));
      exportCSV(rows, `daily-sales-${date}`);
      showToast('CSV exported.', 'success');
    });

    document.getElementById('report-export-pdf')?.addEventListener('click', () => {
      exportDailySalesPDF(date, sales, allItems, revenue, avgTxn, payBreakdown);
    });
  }

  document.getElementById('daily-run-btn')?.addEventListener('click', generate);
  await generate();
}

function exportDailySalesPDF(date, sales, allItems, revenue, avgTxn, payBreakdown) {
  try {
    const { jsPDF } = window.jspdf;
    const doc       = new jsPDF('p', 'mm', 'a4');
    const settings  = window.AppState.settings || {};
    let   y         = buildPDFHeader(doc, `Daily Sales Report — ${formatDate(date)}`, settings);

    // Summary
    doc.setFontSize(10);
    doc.setTextColor(51, 51, 51);
    doc.text(`Transactions: ${sales.length}`, 14, y);
    doc.text(`Total Revenue: ${formatCurrency(revenue, currency())}`, 80, y);
    doc.text(`Avg Transaction: ${formatCurrency(avgTxn, currency())}`, 150, y);
    y += 10;

    // Payment breakdown
    const payRow = Object.entries(payBreakdown)
      .map(([m, a]) => `${m.toUpperCase()}: ${formatCurrency(a, currency())}`)
      .join('   |   ');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(payRow, 14, y);
    y += 8;

    // Table
    const tableRows = sales.map(s => {
      const itemCount = allItems.filter(i => i.sale_id === s.id).length;
      const time = new Date(s.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return [
        formatReceiptNumber(s.id),
        s.customer_name || '—',
        String(itemCount),
        formatCurrency(s.total_amount, currency()),
        s.payment_method,
        time
      ];
    });

    doc.autoTable({
      startY: y,
      head:   [['Receipt', 'Customer', 'Items', 'Total', 'Payment', 'Time']],
      body:   tableRows,
      foot:   [['', '', '', formatCurrency(revenue, currency()), '', '']],
      ...tableStyle(settings.primary_color)
    });

    doc.save(`daily-sales-${date}.pdf`);
    showToast('PDF exported.', 'success');
  } catch (err) {
    console.error('[Reports] PDF export error:', err);
    showToast('PDF export failed. Ensure jsPDF is loaded.', 'error');
  }
}

// ─── 2. WEEKLY SALES REPORT ───────────────────────────────────────────────────
async function renderWeeklyReport(area) {
  area.innerHTML = `
    <div class="card">
      ${reportHeader('Weekly Sales Summary')}
      <div style="padding:var(--space-lg);">
        ${dateRangeControl('weekly', 'this_week')}
        <div id="weekly-report-body"></div>
      </div>
    </div>
  `;

  async function generate() {
    const from  = document.getElementById('weekly-from')?.value;
    const to    = document.getElementById('weekly-to')?.value;
    const body  = document.getElementById('weekly-report-body');
    if (!from || !to || !body) return;

    body.innerHTML = `<div class="skeleton skeleton-chart"></div>`;
    destroyAllCharts();

    const start = new Date(from); start.setHours(0, 0, 0, 0);
    const end   = new Date(to);   end.setHours(23, 59, 59, 999);

    const sales     = await getSalesInRange(start, end);
    const allItems  = await db.sale_items.where('sale_id').anyOf(sales.map(s => s.id)).toArray();
    const revenue   = sum(sales, 'total_amount');
    const unitsSold = sum(allItems, 'quantity');

    // Group by date
    const byDate   = {};
    const dateMap  = {};
    let   d        = new Date(start);
    while (d <= end) {
      const key = d.toISOString().slice(0, 10);
      byDate[key]  = 0;
      dateMap[key] = formatDateShort(key);
      d = new Date(d.getTime() + 86400000);
    }
    sales.forEach(s => {
      const key = s.created_at.slice(0, 10);
      if (key in byDate) byDate[key] += s.total_amount;
    });

    const bestDay  = Object.entries(byDate).sort(([,a],[,b]) => b - a)[0];
    const labels   = Object.keys(byDate);
    const values   = Object.values(byDate);
    const colors   = chartColors(labels.length);

    if (!body) return;

    body.innerHTML = `
      ${summaryBox([
        { label: 'Total Revenue',  value: formatCurrency(revenue, currency()) },
        { label: 'Transactions',   value: sales.length },
        { label: 'Units Sold',     value: unitsSold.toLocaleString() },
        { label: 'Best Day',       value: bestDay ? `${formatDateShort(bestDay[0])} (${formatCurrency(bestDay[1], currency())})` : '—' }
      ])}
      <div style="height:280px;margin-bottom:var(--space-xl);">
        <canvas id="weekly-chart"></canvas>
      </div>
    `;

    const ctx = document.getElementById('weekly-chart')?.getContext('2d');
    if (ctx) {
      destroyChart('weekly');
      _chartInstances.weekly = new Chart(ctx, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label:           'Revenue',
            data:            values,
            backgroundColor: colors.backgrounds,
            borderColor:     colors.borders,
            borderWidth:     1,
            borderRadius:    4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => formatCurrency(ctx.parsed.y, currency())
              }
            }
          },
          scales: {
            x: { grid: { display: false } },
            y: {
              beginAtZero: true,
              ticks: { callback: v => formatCurrency(v, currency()) }
            }
          }
        }
      });
    }

    document.getElementById('report-export-csv')?.addEventListener('click', () => {
      const rows = sales.map(s => ({
        Date: s.created_at.slice(0,10),
        Receipt: formatReceiptNumber(s.id),
        Customer: s.customer_name || '',
        Total: s.total_amount,
        Payment: s.payment_method
      }));
      exportCSV(rows, `weekly-sales-${from}-to-${to}`);
      showToast('CSV exported.', 'success');
    });

    document.getElementById('report-export-pdf')?.addEventListener('click', () => {
      exportGenericTablePDF('Weekly Sales Summary', `${formatDate(from)} to ${formatDate(to)}`,
        ['Date', 'Receipt', 'Customer', 'Total', 'Payment'],
        sales.map(s => [s.created_at.slice(0,10), formatReceiptNumber(s.id), s.customer_name||'—', formatCurrency(s.total_amount, currency()), s.payment_method])
      );
    });
  }

  document.getElementById('weekly-run-btn')?.addEventListener('click', generate);
  await generate();
}

// ─── 3. MONTHLY SALES REPORT ──────────────────────────────────────────────────
async function renderMonthlyReport(area) {
  const now    = new Date();
  const yr     = now.getFullYear();
  const mo     = String(now.getMonth() + 1).padStart(2, '0');

  area.innerHTML = `
    <div class="card">
      ${reportHeader('Monthly Sales Summary')}
      <div style="padding:var(--space-lg);">
        <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg);">
          <label class="form-label" style="margin:0;">Month:</label>
          <input class="form-input" type="month" id="monthly-month" value="${yr}-${mo}" style="width:180px;" />
          <button class="btn btn-primary btn-sm" id="monthly-run-btn">
            <i class="fa-solid fa-rotate"></i> Generate
          </button>
        </div>
        <div id="monthly-report-body"></div>
      </div>
    </div>
  `;

  async function generate() {
    const monthVal = document.getElementById('monthly-month')?.value;
    const body     = document.getElementById('monthly-report-body');
    if (!monthVal || !body) return;

    body.innerHTML = `<div class="skeleton skeleton-chart"></div>`;
    destroyAllCharts();

    const [year, month] = monthVal.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end   = new Date(year, month, 0, 23, 59, 59, 999);

    const sales    = await getSalesInRange(start, end);
    const allItems = await db.sale_items.where('sale_id').anyOf(sales.map(s => s.id)).toArray();
    const revenue  = sum(sales, 'total_amount');
    const txnCount = sales.length;
    const unitsSold= sum(allItems, 'quantity');
    const avgTxn   = txnCount ? revenue / txnCount : 0;

    // Day-by-day
    const daysInMonth = end.getDate();
    const labels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
    const values = new Array(daysInMonth).fill(0);
    sales.forEach(s => {
      const day = new Date(s.created_at).getDate() - 1;
      if (day >= 0 && day < daysInMonth) values[day] += s.total_amount;
    });

    const bestDayIdx = values.indexOf(Math.max(...values));
    const bestDay    = bestDayIdx >= 0 ? `Day ${bestDayIdx + 1} (${formatCurrency(values[bestDayIdx], currency())})` : '—';

    body.innerHTML = `
      ${summaryBox([
        { label: 'Total Revenue',      value: formatCurrency(revenue, currency()) },
        { label: 'Transactions',       value: txnCount },
        { label: 'Units Sold',         value: unitsSold.toLocaleString() },
        { label: 'Avg Transaction',    value: formatCurrency(avgTxn, currency()) },
        { label: 'Best Day',           value: bestDay }
      ])}
      <div style="height:280px;margin-bottom:var(--space-xl);">
        <canvas id="monthly-chart"></canvas>
      </div>
    `;

    const ctx = document.getElementById('monthly-chart')?.getContext('2d');
    if (ctx) {
      destroyChart('monthly');
      const pri = window.AppState.settings?.primary_color || AppConfig.DEFAULT_PRIMARY_COLOR;
      _chartInstances.monthly = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Revenue',
            data:  values,
            borderColor:     pri,
            backgroundColor: pri + '22',
            borderWidth:     2.5,
            fill:            true,
            tension:         0.4,
            pointRadius:     2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => formatCurrency(ctx.parsed.y, currency()) } }
          },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { callback: v => formatCurrency(v, currency()) } }
          }
        }
      });
    }

    document.getElementById('report-export-csv')?.addEventListener('click', () => {
      const rows = labels.map((d, i) => ({ Day: d, Revenue: values[i] }));
      exportCSV(rows, `monthly-sales-${monthVal}`);
      showToast('CSV exported.', 'success');
    });

    document.getElementById('report-export-pdf')?.addEventListener('click', () => {
      exportGenericTablePDF(
        'Monthly Sales Summary',
        `${new Date(year, month - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`,
        ['Day', 'Revenue'],
        labels.map((d, i) => [d, formatCurrency(values[i], currency())])
      );
    });
  }

  document.getElementById('monthly-run-btn')?.addEventListener('click', generate);
  await generate();
}

// ─── 4. ANNUAL SUMMARY REPORT (NEW) ───────────────────────────────────────────
async function renderAnnualReport(area) {
  const now = new Date();
  const yr  = now.getFullYear();

  area.innerHTML = `
    <div class="card">
      ${reportHeader('Annual Sales Summary')}
      <div style="padding:var(--space-lg);">
        <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg);">
          <label class="form-label" style="margin:0;">Year:</label>
          <input class="form-input" type="number" id="annual-year" value="${yr}" min="2000" max="2100" style="width:120px;" />
          <button class="btn btn-primary btn-sm" id="annual-run-btn">
            <i class="fa-solid fa-rotate"></i> Generate
          </button>
        </div>
        <div id="annual-report-body"></div>
      </div>
    </div>
  `;

  async function generate() {
    const yearVal = parseInt(document.getElementById('annual-year')?.value, 10);
    const body    = document.getElementById('annual-report-body');
    if (!yearVal || !body) return;

    body.innerHTML = `<div class="skeleton skeleton-chart"></div>`;
    destroyAllCharts();

    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const values = new Array(12).fill(0);
    let totalRevenue = 0;
    let totalTxn     = 0;

    for (let m = 0; m < 12; m++) {
      const start = new Date(yearVal, m, 1);
      const end   = new Date(yearVal, m + 1, 0, 23, 59, 59, 999);
      const sales = await getSalesInRange(start, end);
      const revenue = sum(sales, 'total_amount');
      values[m] = revenue;
      totalRevenue += revenue;
      totalTxn     += sales.length;
    }

    const bestMonthIdx = values.indexOf(Math.max(...values));
    const bestMonth    = bestMonthIdx >= 0 ? `${months[bestMonthIdx]} (${formatCurrency(values[bestMonthIdx], currency())})` : '—';
    const avgMonthly   = formatCurrency(totalRevenue / 12, currency());

    body.innerHTML = `
      ${summaryBox([
        { label: 'Total Revenue',  value: formatCurrency(totalRevenue, currency()) },
        { label: 'Transactions',   value: totalTxn.toLocaleString() },
        { label: 'Avg Monthly',    value: avgMonthly },
        { label: 'Best Month',     value: bestMonth }
      ])}
      <div style="height:300px;margin-bottom:var(--space-xl);">
        <canvas id="annual-chart"></canvas>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Month</th><th>Revenue</th><th>% of Total</th>
            </tr>
          </thead>
          <tbody>
            ${months.map((mon, i) => {
              const pct = totalRevenue > 0 ? (values[i] / totalRevenue * 100).toFixed(1) : '0.0';
              return `
                <tr>
                  <td class="font-semibold">${mon}</td>
                  <td><strong>${formatCurrency(values[i], currency())}</strong></td>
                  <td>${pct}%</td>
                </tr>
              `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Total</strong></td>
              <td><strong>${formatCurrency(totalRevenue, currency())}</strong></td>
              <td>100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;

    const ctx = document.getElementById('annual-chart')?.getContext('2d');
    if (ctx) {
      destroyChart('annual');
      const pri = window.AppState.settings?.primary_color || AppConfig.DEFAULT_PRIMARY_COLOR;
      _chartInstances.annual = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: months,
          datasets: [{
            label:           'Monthly Revenue',
            data:            values,
            backgroundColor: chartColors(12).backgrounds,
            borderColor:     chartColors(12).borders,
            borderWidth:     1,
            borderRadius:    4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: ctx => formatCurrency(ctx.parsed.y, currency()) } }
          },
          scales: {
            x: { grid: { display: false } },
            y: { beginAtZero: true, ticks: { callback: v => formatCurrency(v, currency()) } }
          }
        }
      });
    }

    document.getElementById('report-export-csv')?.addEventListener('click', () => {
      const rows = months.map((mon, i) => ({
        Month: mon,
        Revenue: values[i],
        Pct: totalRevenue > 0 ? (values[i] / totalRevenue * 100).toFixed(1) + '%' : '0.0%'
      }));
      exportCSV(rows, `annual-summary-${yearVal}`);
      showToast('CSV exported.', 'success');
    });

    document.getElementById('report-export-pdf')?.addEventListener('click', () => {
      exportGenericTablePDF(
        `Annual Summary — ${yearVal}`,
        `Total Revenue: ${formatCurrency(totalRevenue, currency())}`,
        ['Month', 'Revenue', '%'],
        months.map((mon, i) => [mon, formatCurrency(values[i], currency()), (totalRevenue > 0 ? (values[i] / totalRevenue * 100).toFixed(1) + '%' : '0.0%')])
      );
    });
  }

  document.getElementById('annual-run-btn')?.addEventListener('click', generate);
  await generate();
}

// ─── 5. EXECUTIVE ANALYSIS REPORT (NEW) ──────────────────────────────────────
// ─── EXECUTIVE ANALYSIS REPORT ───────────────────────────────────────────────
async function renderExecutiveReport(area) {
  const now = new Date();
  const yr  = now.getFullYear();

  area.innerHTML = `
    <div class="card">
      ${reportHeader('Executive Business Analysis', 'Full-year review with COGS, growth rates, and AI-powered recommendations')}
      <div style="padding:var(--space-lg);">
        <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg);">
          <label class="form-label" style="margin:0;">Year:</label>
          <input class="form-input" type="number" id="exec-year"
            value="${yr}" min="2000" max="2100" style="width:120px;" />
          <button class="btn btn-primary btn-sm" id="exec-run-btn">
            <i class="fa-solid fa-rotate"></i> Generate
          </button>
        </div>
        <div id="exec-report-body"></div>
      </div>
    </div>
  `;

  async function generate() {
    const yearVal = parseInt(document.getElementById('exec-year')?.value, 10);
    const body    = document.getElementById('exec-report-body');
    if (!yearVal || !body) return;

    body.innerHTML = `<div class="skeleton skeleton-text" style="height:30px;margin-bottom:8px;"></div>
      <div class="skeleton skeleton-text w-75"></div>`;

    /* ─── 1. COLLECT MONTHLY DATA ───────────────────────────────────────── */
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const monthlyRevenue    = new Array(12).fill(0);
    const monthlyTxns       = new Array(12).fill(0);
    const monthlyUnits      = new Array(12).fill(0);
    const monthlyCOGS       = new Array(12).fill(0);
    let   totalRevenue      = 0, totalTxns = 0, totalUnits = 0, totalCOGS = 0;

    // Build product cost map
    const allProducts  = await db.products.toArray();
    const costMap      = Object.fromEntries(allProducts.map(p => [p.id, p.cost_price || 0]));

    for (let m = 0; m < 12; m++) {
      const start = new Date(yearVal, m, 1);
      const end   = new Date(yearVal, m + 1, 0, 23, 59, 59, 999);
      const sales = await getSalesInRange(start, end);
      const completed = sales.filter(s => s.status !== 'voided');

      monthlyTxns[m]    = completed.length;
      monthlyRevenue[m] = sum(completed, 'total_amount');
      totalRevenue     += monthlyRevenue[m];
      totalTxns        += monthlyTxns[m];

      if (completed.length) {
        const items = await db.sale_items
          .where('sale_id').anyOf(completed.map(s => s.id)).toArray();
        monthlyUnits[m] = sum(items, 'quantity');
        monthlyCOGS[m]  = items.reduce(
          (s, i) => s + i.quantity * (costMap[i.product_id] || 0), 0
        );
      }
      totalUnits += monthlyUnits[m];
      totalCOGS  += monthlyCOGS[m];
    }

    /* ─── 2. DERIVED METRICS ────────────────────────────────────────────── */
    const grossProfit       = totalRevenue - totalCOGS;
    const grossMarginPct    = totalRevenue > 0
      ? (grossProfit / totalRevenue * 100).toFixed(1) : '0.0';
    const avgTxn            = totalTxns ? totalRevenue / totalTxns : 0;

    // Month-over-month growth rates
    const monthlyMoM = months.map((_, i) => {
      if (i === 0) return null;
      const prev = monthlyRevenue[i - 1];
      if (prev === 0) return null;
      return ((monthlyRevenue[i] - prev) / prev * 100).toFixed(1);
    });

    // Best / worst / avg months
    const nonZero   = monthlyRevenue.filter(v => v > 0);
    const bestIdx   = monthlyRevenue.indexOf(Math.max(...monthlyRevenue));
    const worstIdx  = monthlyRevenue.indexOf(Math.min(...monthlyRevenue.filter((_, i) => monthlyTxns[i] > 0)));
    const avgMonthly = totalRevenue / 12;

    // Previous year comparison
    let prevRevenue = 0;
    const prevSales = await getSalesInRange(
      new Date(yearVal - 1, 0, 1), new Date(yearVal - 1, 11, 31, 23, 59, 59, 999)
    );
    prevRevenue = sum(prevSales.filter(s => s.status !== 'voided'), 'total_amount');
    const yoyPct = prevRevenue > 0
      ? ((totalRevenue - prevRevenue) / prevRevenue * 100).toFixed(1)
      : null;

    /* ─── 3. CATEGORY REVENUE BREAKDOWN ────────────────────────────────── */
    const allYearSales = await getSalesInRange(
      new Date(yearVal, 0, 1), new Date(yearVal, 11, 31, 23, 59, 59, 999)
    );
    const yearCompleted = allYearSales.filter(s => s.status !== 'voided');
    const yearSaleIds   = yearCompleted.map(s => s.id);
    const yearItems     = yearSaleIds.length
      ? await db.sale_items.where('sale_id').anyOf(yearSaleIds).toArray()
      : [];

    const catRevMap = {};
    const prodRevMap = {};
    const prodUnitMap = {};
    const catMap = Object.fromEntries((await db.categories.toArray()).map(c => [c.id, c.name]));
    const prodCatMap = Object.fromEntries(allProducts.map(p => [p.id, p.category_id]));

    yearItems.forEach(item => {
      const catId   = prodCatMap[item.product_id];
      const catName = catId ? (catMap[catId] || 'Uncategorised') : 'Uncategorised';
      catRevMap[catName] = (catRevMap[catName] || 0) + item.subtotal;

      const pName = item.product_name_snapshot;
      if (!prodRevMap[pName]) { prodRevMap[pName] = 0; prodUnitMap[pName] = 0; }
      prodRevMap[pName]  += item.subtotal;
      prodUnitMap[pName] += item.quantity;
    });

    const topCategories = Object.entries(catRevMap)
      .sort(([,a],[,b]) => b - a).slice(0, 5);

    const topProducts = Object.entries(prodRevMap)
      .sort(([,a],[,b]) => b - a)
      .slice(0, 5)
      .map(([name, rev]) => ({ name, revenue: rev, units: prodUnitMap[name] }));

    // Payment method mix
    const payMap = {};
    yearCompleted.forEach(s => {
      payMap[s.payment_method] = (payMap[s.payment_method] || 0) + s.total_amount;
    });

    /* ─── 4. TREND ANALYSIS (simple linear regression) ──────────────────── */
    const n    = 12;
    const xMean = 5.5; // months 0-11, mean = 5.5
    const yMean = totalRevenue / 12;
    let   num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (monthlyRevenue[i] - yMean);
      den += (i - xMean) ** 2;
    }
    const slope = den !== 0 ? num / den : 0;
    const trendDesc = slope > avgMonthly * 0.02 ? '📈 Growing'
                    : slope < -avgMonthly * 0.02 ? '📉 Declining'
                    : '➡️ Stable';

    /* ─── 5. GENERATE INSIGHTS ──────────────────────────────────────────── */
    let insightLines = [];

    insightLines.push(
      `PERFORMANCE OVERVIEW: Total revenue of ${formatCurrency(totalRevenue, currency())} ` +
      `from ${totalTxns.toLocaleString()} completed transactions ` +
      `(${totalUnits.toLocaleString()} units). ` +
      `Gross profit: ${formatCurrency(grossProfit, currency())} (${grossMarginPct}% margin). ` +
      `Average transaction value: ${formatCurrency(avgTxn, currency())}. ` +
      `Revenue trend: ${trendDesc}.`
    );

    if (yoyPct !== null) {
      const dir = parseFloat(yoyPct) >= 0 ? 'increased' : 'decreased';
      insightLines.push(
        `YEAR-OVER-YEAR: Revenue ${dir} by ${Math.abs(parseFloat(yoyPct)).toFixed(1)}% ` +
        `vs ${yearVal - 1} (${formatCurrency(prevRevenue, currency())} → ${formatCurrency(totalRevenue, currency())}).`
      );
    }

    insightLines.push(
      `PEAK PERFORMANCE: Best month was ${months[bestIdx]} ` +
      `(${formatCurrency(monthlyRevenue[bestIdx], currency())}, ` +
      `${monthlyTxns[bestIdx]} transactions). ` +
      `Weakest was ${months[worstIdx >= 0 ? worstIdx : 0]} ` +
      `(${formatCurrency(monthlyRevenue[worstIdx >= 0 ? worstIdx : 0], currency())}). ` +
      `Gap: ${formatCurrency(monthlyRevenue[bestIdx] - monthlyRevenue[worstIdx >= 0 ? worstIdx : 0], currency())}.`
    );

    if (topCategories.length) {
      const catList = topCategories
        .map(([n,v]) => `${n} ${formatCurrency(v, currency())} (${totalRevenue > 0 ? (v/totalRevenue*100).toFixed(0) : 0}%)`)
        .join(', ');
      insightLines.push(`TOP CATEGORIES: ${catList}.`);
    }

    if (topProducts.length) {
      insightLines.push(
        `TOP PRODUCTS: ` + topProducts
          .map(p => `${p.name} — ${p.units} units, ${formatCurrency(p.revenue, currency())}`)
          .join('; ') + '.'
      );
    }

    if (Object.keys(payMap).length) {
      const payList = Object.entries(payMap)
        .sort(([,a],[,b]) => b - a)
        .map(([m,v]) => `${m} ${(v/totalRevenue*100).toFixed(0)}%`)
        .join(', ');
      insightLines.push(`PAYMENT MIX: ${payList}.`);
    }

    const grossMarginNum = parseFloat(grossMarginPct);
    if (grossMarginNum < 20) {
      insightLines.push(
        `MARGIN ALERT: Gross margin of ${grossMarginPct}% is below the 20% healthy threshold. ` +
        `Review supplier costs, consider price adjustments, or identify high-COGS products.`
      );
    } else if (grossMarginNum >= 40) {
      insightLines.push(
        `MARGIN STRENGTH: Gross margin of ${grossMarginPct}% is strong. ` +
        `Reinvest in marketing and inventory to capitalise on this efficiency.`
      );
    }

    // Recommendations
    const recs = [
      `Replicate strategies from ${months[bestIdx]} across ${months.filter((_,i) => monthlyRevenue[i] < avgMonthly * 0.8).join(', ')||'slow months'} to reduce revenue seasonality.`,
      slope < 0
        ? `Revenue trend is declining — urgently review pricing, competitor activity, and customer retention.`
        : `Revenue trend is positive — sustain momentum by expanding top-performing categories.`,
      grossMarginNum < 25
        ? `Negotiate better supplier terms or review pricing to improve the ${grossMarginPct}% gross margin.`
        : `Protect ${grossMarginPct}% gross margin by monitoring COGS quarterly.`,
      `Set monthly revenue targets: aim for ${formatCurrency(monthlyRevenue[bestIdx] * 1.1, currency())} (10% above best month) as your annual ceiling goal.`,
      topProducts.length
        ? `Ensure ${topProducts[0].name} never goes out of stock — it is your highest-revenue product.`
        : `Record product-level sales data to identify your best performers.`,
      `Use the Low Stock and Expiry reports weekly to prevent lost sales from stockouts or waste from expired goods.`
    ];

    insightLines.push('RECOMMENDATIONS FOR ' + (yearVal + 1) + ': ' + recs.join(' '));

    // Plain-text version for PDF
    const insightsPlainText = insightLines.join('\n\n');

    // HTML version for on-screen display
    const insightsHtml = insightLines.map((line, i) => {
      const [head, ...rest] = line.split(':');
      return `<p style="margin-bottom:.75rem;line-height:1.7;">
        <strong>${sanitize(head)}:</strong> ${sanitize(rest.join(':').trim())}
      </p>`;
    }).join('');

    /* ─── 6. RENDER ─────────────────────────────────────────────────────── */
    body.innerHTML = `
      ${summaryBox([
        { label: 'Total Revenue',    value: formatCurrency(totalRevenue, currency()) },
        { label: 'Gross Profit',     value: formatCurrency(grossProfit, currency()) },
        { label: 'Gross Margin',     value: `${grossMarginPct}%` },
        { label: 'Transactions',     value: totalTxns.toLocaleString() },
        { label: 'Avg. Transaction', value: formatCurrency(avgTxn, currency()) },
        { label: 'YoY Change',       value: yoyPct !== null ? `${yoyPct}%` : 'N/A' }
      ])}

      <!-- Insights -->
      <div class="card" style="background:var(--color-primary-light);border-color:#C7D2FE;margin-bottom:var(--space-xl);">
        <div class="card-header">
          <h3 class="card-title"><i class="fa-solid fa-lightbulb"></i> Insights &amp; Recommendations</h3>
        </div>
        <div style="padding:var(--space-lg);font-size:var(--text-sm);">${insightsHtml}</div>
      </div>

      <!-- Revenue Chart -->
      <div style="height:300px;margin-bottom:var(--space-xl);">
        <canvas id="exec-chart"></canvas>
      </div>

      <!-- Monthly Breakdown Table -->
      <h3 style="font-size:var(--text-base);font-weight:600;margin-bottom:var(--space-md);">
        Monthly Breakdown
      </h3>
      <div class="table-wrapper" style="margin-bottom:var(--space-xl);">
        <table>
          <thead>
            <tr>
              <th>Month</th><th>Revenue</th><th>COGS</th><th>Gross Profit</th>
              <th>Margin</th><th>Transactions</th><th>Units</th><th>MoM</th>
            </tr>
          </thead>
          <tbody>
            ${months.map((mon, i) => {
              const gp  = monthlyRevenue[i] - monthlyCOGS[i];
              const gpm = monthlyRevenue[i] > 0
                ? (gp / monthlyRevenue[i] * 100).toFixed(1) : '0.0';
              const mom = monthlyMoM[i];
              return `
                <tr>
                  <td class="font-semibold">${mon}</td>
                  <td><strong>${formatCurrency(monthlyRevenue[i], currency())}</strong></td>
                  <td class="text-muted">${formatCurrency(monthlyCOGS[i], currency())}</td>
                  <td class="${gp >= 0 ? 'text-success' : 'text-danger'} font-semibold">
                    ${formatCurrency(gp, currency())}
                  </td>
                  <td class="${parseFloat(gpm) >= 20 ? 'text-success' : 'text-warning'}">${gpm}%</td>
                  <td>${monthlyTxns[i].toLocaleString()}</td>
                  <td>${monthlyUnits[i].toLocaleString()}</td>
                  <td class="${mom === null ? '' : parseFloat(mom) >= 0 ? 'text-success' : 'text-danger'}">
                    ${mom === null ? '—' : (parseFloat(mom) >= 0 ? '+' : '') + mom + '%'}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>TOTAL</strong></td>
              <td><strong>${formatCurrency(totalRevenue, currency())}</strong></td>
              <td>${formatCurrency(totalCOGS, currency())}</td>
              <td class="${grossProfit >= 0 ? 'text-success' : 'text-danger'} font-semibold">
                <strong>${formatCurrency(grossProfit, currency())}</strong>
              </td>
              <td>${grossMarginPct}%</td>
              <td>${totalTxns.toLocaleString()}</td>
              <td>${totalUnits.toLocaleString()}</td>
              <td>—</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Category Breakdown -->
      ${topCategories.length ? `
        <h3 style="font-size:var(--text-base);font-weight:600;margin-bottom:var(--space-md);">
          Category Revenue Breakdown
        </h3>
        <div class="table-wrapper" style="margin-bottom:var(--space-xl);">
          <table>
            <thead>
              <tr><th>Category</th><th>Revenue</th><th>% of Total</th></tr>
            </thead>
            <tbody>
              ${topCategories.map(([name, rev]) => `
                <tr>
                  <td class="font-semibold">${sanitize(name)}</td>
                  <td><strong>${formatCurrency(rev, currency())}</strong></td>
                  <td>${totalRevenue > 0 ? (rev / totalRevenue * 100).toFixed(1) : '0.0'}%</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}

      <!-- Top Products -->
      ${topProducts.length ? `
        <h3 style="font-size:var(--text-base);font-weight:600;margin-bottom:var(--space-md);">
          Top 5 Products by Revenue
        </h3>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr><th>#</th><th>Product</th><th>Units Sold</th><th>Revenue</th></tr>
            </thead>
            <tbody>
              ${topProducts.map((p, i) => `
                <tr>
                  <td class="font-bold" style="color:${i<3?'var(--color-warning)':'var(--color-text-muted)'};">#${i+1}</td>
                  <td class="font-semibold">${sanitize(p.name)}</td>
                  <td>${p.units.toLocaleString()}</td>
                  <td><strong>${formatCurrency(p.revenue, currency())}</strong></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    `;

    /* ─── 7. CHART ──────────────────────────────────────────────────────── */
    const ctx = document.getElementById('exec-chart')?.getContext('2d');
    if (ctx) {
      destroyChart('exec');
      const pri = window.AppState?.settings?.primary_color || AppConfig.DEFAULT_PRIMARY_COLOR;
      _chartInstances.exec = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: months,
          datasets: [
            {
              label:           'Revenue',
              data:            monthlyRevenue,
              backgroundColor: pri + 'CC',
              borderColor:     pri,
              borderWidth:     1,
              borderRadius:    4,
              order:           2
            },
            {
              label:           'COGS',
              data:            monthlyCOGS,
              backgroundColor: '#EF4444AA',
              borderColor:     '#EF4444',
              borderWidth:     1,
              borderRadius:    4,
              order:           3
            },
            {
              label:       'Gross Profit',
              data:        monthlyRevenue.map((r, i) => r - monthlyCOGS[i]),
              type:        'line',
              borderColor: '#16A34A',
              backgroundColor: 'transparent',
              borderWidth: 2.5,
              pointRadius: 4,
              tension:     0.4,
              order:       1
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: true, position: 'top' },
            tooltip: {
              callbacks: {
                label: ctx => `${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y, currency())}`
              }
            }
          },
          scales: {
            x: { grid: { display: false } },
            y: {
              beginAtZero: true,
              ticks: { callback: v => formatCurrency(v, currency()) }
            }
          }
        }
      });
    }

    /* ─── 8. EXPORT HANDLERS ────────────────────────────────────────────── */
    document.getElementById('report-export-csv')?.addEventListener('click', () => {
      // Monthly data rows
      const dataRows = months.map((mon, i) => ({
        Month:         mon,
        Revenue:       monthlyRevenue[i].toFixed(2),
        COGS:          monthlyCOGS[i].toFixed(2),
        Gross_Profit:  (monthlyRevenue[i] - monthlyCOGS[i]).toFixed(2),
        Margin_Pct:    monthlyRevenue[i] > 0
          ? ((monthlyRevenue[i]-monthlyCOGS[i])/monthlyRevenue[i]*100).toFixed(1)
          : '0.0',
        Transactions:  monthlyTxns[i],
        Units_Sold:    monthlyUnits[i],
        MoM_Growth_Pct: monthlyMoM[i] !== null ? monthlyMoM[i] : ''
      }));

      // Summary rows appended at bottom
      const summaryRows = [
        {},
        { Month: '=== SUMMARY ===', Revenue: '', COGS: '', Gross_Profit: '', Margin_Pct: '', Transactions: '', Units_Sold: '', MoM_Growth_Pct: '' },
        { Month: 'Total Revenue',   Revenue: totalRevenue.toFixed(2) },
        { Month: 'Total COGS',      Revenue: totalCOGS.toFixed(2) },
        { Month: 'Gross Profit',    Revenue: grossProfit.toFixed(2) },
        { Month: 'Gross Margin %',  Revenue: grossMarginPct },
        { Month: 'Total Transactions', Revenue: totalTxns },
        { Month: 'Total Units',     Revenue: totalUnits },
        { Month: 'Avg Transaction', Revenue: avgTxn.toFixed(2) },
        { Month: 'YoY Change %',    Revenue: yoyPct !== null ? yoyPct : 'N/A' },
        {},
        { Month: '=== INSIGHTS ===', Revenue: '', COGS: '', Gross_Profit: '', Margin_Pct: '', Transactions: '', Units_Sold: '', MoM_Growth_Pct: '' },
        ...insightLines.map(line => ({ Month: line }))
      ];

      exportCSV([...dataRows, ...summaryRows], `executive-analysis-${yearVal}`);
      showToast('CSV exported with full insights.', 'success');
    });

    document.getElementById('report-export-pdf')?.addEventListener('click', () => {
      exportExecutiveReportPDF({
        yearVal, months,
        monthlyRevenue, monthlyCOGS, monthlyTxns, monthlyUnits, monthlyMoM,
        totalRevenue, totalCOGS, grossProfit, grossMarginPct,
        totalTxns, totalUnits, avgTxn, yoyPct, prevRevenue,
        topProducts, topCategories, payMap,
        insightsPlainText
      });
    });
  } // end generate()

  document.getElementById('exec-run-btn')?.addEventListener('click', generate);
  await generate();
}

/* ─── EXECUTIVE REPORT PDF EXPORT ───────────────────────────────────────────
   Full export: KPIs, monthly table with COGS & margin, category table,
   top products table, and all insights as plain text paragraphs.
────────────────────────────────────────────────────────────────────────────── */
function exportExecutiveReportPDF(data) {
  try {
    const { jsPDF } = window.jspdf;
    const doc       = new jsPDF('p', 'mm', 'a4');
    const settings  = window.AppState?.settings || {};
    const cur       = currency();
    const pageW     = doc.internal.pageSize.getWidth();
    const pageH     = doc.internal.pageSize.getHeight();
    const margin    = 14;
    const contentW  = pageW - margin * 2;

    const {
      yearVal, months,
      monthlyRevenue, monthlyCOGS, monthlyTxns, monthlyUnits, monthlyMoM,
      totalRevenue, totalCOGS, grossProfit, grossMarginPct,
      totalTxns, totalUnits, avgTxn, yoyPct, prevRevenue,
      topProducts, topCategories, payMap,
      insightsPlainText
    } = data;

    // ── Page 1: Header + KPIs + Monthly Table ─────────────────────────────
    let y = buildPDFHeader(doc, `Executive Business Analysis — ${yearVal}`, settings);

    // KPI summary grid
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.text('Key Performance Indicators', margin, y);
    y += 5;

    const kpiData = [
      ['Total Revenue',       formatCurrency(totalRevenue,  cur)],
      ['Gross Profit',        formatCurrency(grossProfit,   cur)],
      ['Gross Margin',        `${grossMarginPct}%`],
      ['Total COGS (approx)', formatCurrency(totalCOGS,     cur)],
      ['Total Transactions',  totalTxns.toLocaleString()],
      ['Total Units Sold',    totalUnits.toLocaleString()],
      ['Avg Transaction',     formatCurrency(avgTxn,        cur)],
      ['YoY Revenue Change',  yoyPct !== null ? `${parseFloat(yoyPct) >= 0 ? '+' : ''}${yoyPct}%` : 'N/A (no prior year data)'],
      ['Prior Year Revenue',  prevRevenue > 0 ? formatCurrency(prevRevenue, cur) : 'N/A']
    ];

    doc.autoTable({
      startY:   y,
      head:     [['Metric', 'Value']],
      body:     kpiData,
      tableWidth: contentW * 0.55,
      ...tableStyle(settings.primary_color)
    });
    y = doc.lastAutoTable.finalY + 10;

    // ── Monthly Breakdown ─────────────────────────────────────────────────
    if (y > pageH - 80) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.text('Monthly Performance Breakdown', margin, y);
    y += 5;

    doc.autoTable({
      startY: y,
      head:   [['Month', 'Revenue', 'COGS', 'Gross Profit', 'Margin', 'Txns', 'Units', 'MoM %']],
      body:   months.map((mon, i) => {
        const gp  = monthlyRevenue[i] - monthlyCOGS[i];
        const gpm = monthlyRevenue[i] > 0
          ? (gp / monthlyRevenue[i] * 100).toFixed(1) + '%' : '0.0%';
        const mom = monthlyMoM[i];
        return [
          mon,
          formatCurrency(monthlyRevenue[i], cur),
          formatCurrency(monthlyCOGS[i],    cur),
          formatCurrency(gp,                cur),
          gpm,
          String(monthlyTxns[i]),
          String(monthlyUnits[i]),
          mom === null ? '—' : (parseFloat(mom) >= 0 ? '+' : '') + mom + '%'
        ];
      }),
      foot: [[
        'TOTAL',
        formatCurrency(totalRevenue, cur),
        formatCurrency(totalCOGS,    cur),
        formatCurrency(grossProfit,  cur),
        `${grossMarginPct}%`,
        String(totalTxns),
        String(totalUnits),
        '—'
      ]],
      ...tableStyle(settings.primary_color)
    });
    y = doc.lastAutoTable.finalY + 10;

    // ── Category Breakdown ────────────────────────────────────────────────
    if (topCategories.length) {
      if (y > pageH - 60) { doc.addPage(); y = 20; }
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text('Top Category Revenue', margin, y);
      y += 5;

      doc.autoTable({
        startY: y,
        head:   [['Category', 'Revenue', '% of Total']],
        body:   topCategories.map(([name, rev]) => [
          name,
          formatCurrency(rev, cur),
          totalRevenue > 0 ? (rev / totalRevenue * 100).toFixed(1) + '%' : '0.0%'
        ]),
        tableWidth: contentW * 0.65,
        ...tableStyle(settings.primary_color)
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // ── Top Products ──────────────────────────────────────────────────────
    if (topProducts.length) {
      if (y > pageH - 60) { doc.addPage(); y = 20; }
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text('Top 5 Products by Revenue', margin, y);
      y += 5;

      doc.autoTable({
        startY: y,
        head:   [['#', 'Product', 'Units Sold', 'Revenue']],
        body:   topProducts.map((p, i) => [
          `#${i + 1}`, p.name,
          p.units.toLocaleString(),
          formatCurrency(p.revenue, cur)
        ]),
        tableWidth: contentW * 0.75,
        ...tableStyle(settings.primary_color)
      });
      y = doc.lastAutoTable.finalY + 10;
    }

    // ── Insights & Recommendations (full plain text, multi-page safe) ─────
    if (y > pageH - 50) { doc.addPage(); y = 20; }

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 30, 30);
    doc.text('Insights & Recommendations', margin, y);
    y += 7;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(50, 50, 50);

    const lineHeight = 5.5;
    const paragraphs = insightsPlainText.split('\n\n').filter(Boolean);

    for (const para of paragraphs) {
      const lines = doc.splitTextToSize(para, contentW);
      const blockH = lines.length * lineHeight + 4;

      // Start new page if block won't fit
      if (y + blockH > pageH - 15) {
        doc.addPage();
        y = 20;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(50, 50, 50);
      }

      // Bold the heading part (text before first colon)
      const colonIdx = para.indexOf(':');
      if (colonIdx !== -1 && colonIdx < 40) {
        const heading = para.slice(0, colonIdx + 1);
        const rest    = para.slice(colonIdx + 1).trim();

        doc.setFont('helvetica', 'bold');
        const headLines = doc.splitTextToSize(heading, contentW);
        doc.text(headLines, margin, y);
        y += headLines.length * lineHeight;

        doc.setFont('helvetica', 'normal');
        const bodyLines = doc.splitTextToSize(rest, contentW);
        doc.text(bodyLines, margin, y);
        y += bodyLines.length * lineHeight + 4;
      } else {
        doc.text(lines, margin, y);
        y += lines.length * lineHeight + 4;
      }
    }

    // ── Footer on every page ──────────────────────────────────────────────
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(150, 150, 150);
      doc.text(
        `${settings.business_name || AppConfig.APP_NAME} — Executive Analysis ${yearVal} | Page ${p} of ${totalPages}`,
        margin,
        pageH - 8
      );
      doc.text(
        `Generated: ${formatDateTime(new Date().toISOString())}`,
        pageW - margin,
        pageH - 8,
        { align: 'right' }
      );
    }

    doc.save(`executive-analysis-${yearVal}.pdf`);
    showToast('Full executive PDF exported.', 'success');

  } catch (err) {
    console.error('[Reports] Executive PDF error:', err);
    showToast('PDF export failed. Ensure jsPDF is loaded.', 'error');
  }
}

      
// ─── 6. INVENTORY STATUS REPORT ─────────────────────────────────
async function renderInventoryReport(area) {
  area.innerHTML = `<div class="card"><div class="skeleton skeleton-chart"></div></div>`;

  const products   = await getActiveProducts();
  const cur        = currency();
  const totalCost  = sum(products, p => p.quantity * p.cost_price);
  const totalSell  = sum(products, p => p.quantity * p.selling_price);
  const totalProfit= totalSell - totalCost;

  area.innerHTML = `
    <div class="card">
      ${reportHeader('Inventory Status Report', `${products.length} active products`)}
      <div style="padding:var(--space-lg);">
        ${summaryBox([
          { label: 'Total Products',     value: products.length },
          { label: 'Total Cost Value',   value: formatCurrency(totalCost,   cur) },
          { label: 'Total Retail Value', value: formatCurrency(totalSell,   cur) },
          { label: 'Potential Profit',   value: formatCurrency(totalProfit, cur) }
        ])}
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Product</th><th>SKU</th><th>Category</th>
                <th>Qty</th><th>Unit</th><th>Cost Value</th>
                <th>Retail Value</th><th>Profit</th><th>Margin</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${products.map(p => {
                const costVal   = p.quantity * p.cost_price;
                const sellVal   = p.quantity * p.selling_price;
                const profit    = sellVal - costVal;
                const margin    = calculateProfitMargin(p.cost_price, p.selling_price);
                const isExpired = p.expiry_date && new Date(p.expiry_date) < new Date();
                const status    = isExpired ? 'Expired'
                  : p.quantity === 0 ? 'Out of Stock'
                  : p.quantity <= p.low_stock_threshold ? 'Low Stock'
                  : 'In Stock';
                const statusCls = isExpired ? 'badge-danger'
                  : p.quantity === 0 ? 'badge-danger'
                  : p.quantity <= p.low_stock_threshold ? 'badge-warning'
                  : 'badge-success';
                return `
                  <tr>
                    <td class="font-semibold">${sanitize(p.name)}</td>
                    <td><code style="font-size:10px;background:var(--color-surface-2);padding:2px 5px;border-radius:3px;">${sanitize(p.sku)}</code></td>
                    <td>${sanitize(p.category_name || '—')}</td>
                    <td>${p.quantity.toLocaleString()}</td>
                    <td class="text-muted">${sanitize(p.unit || '—')}</td>
                    <td>${formatCurrency(costVal, cur)}</td>
                    <td>${formatCurrency(sellVal, cur)}</td>
                    <td class="${profit >= 0 ? 'text-success' : 'text-danger'}">${formatCurrency(profit, cur)}</td>
                    <td class="${margin >= 20 ? 'text-success' : 'text-warning'}">${margin.toFixed(1)}%</td>
                    <td><span class="badge ${statusCls}">${sanitize(status)}</span></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  document.getElementById('report-export-csv')?.addEventListener('click', () => {
    const rows = products.map(p => ({
      Name:         p.name,
      SKU:          p.sku,
      Category:     p.category_name,
      Quantity:     p.quantity,
      Unit:         p.unit,
      Cost_Price:   p.cost_price,
      Selling_Price:p.selling_price,
      Cost_Value:   p.quantity * p.cost_price,
      Retail_Value: p.quantity * p.selling_price,
      Margin_Pct:   calculateProfitMargin(p.cost_price, p.selling_price).toFixed(1)
    }));
    exportCSV(rows, `inventory-status-${new Date().toISOString().slice(0,10)}`);
    showToast('CSV exported.', 'success');
  });

  document.getElementById('report-export-pdf')?.addEventListener('click', () => {
    exportGenericTablePDF(
      'Inventory Status Report',
      `Generated ${formatDate(new Date().toISOString())}`,
      ['Name', 'SKU', 'Qty', 'Cost Value', 'Retail Value', 'Margin'],
      products.map(p => [
        p.name, p.sku,
        String(p.quantity),
        formatCurrency(p.quantity * p.cost_price, cur),
        formatCurrency(p.quantity * p.selling_price, cur),
        `${calculateProfitMargin(p.cost_price, p.selling_price).toFixed(1)}%`
      ])
    );
  });
}

// ─── 6. OUT OF STOCK REPORT ───────────────────────────────────────────────────
async function renderOutOfStockReport(area) {
  const products   = await db.products.where('is_active').equals(1).and(p => p.quantity === 0).toArray();
  const categories = await db.categories.toArray();
  const catMap     = Object.fromEntries(categories.map(c => [c.id, c.name]));

  // Get last stock-in date for each
  const enriched = await Promise.all(products.map(async p => {
    const lastIn = await db.stock_movements
      .where('product_id').equals(p.id)
      .and(m => m.type === 'stock_in')
      .reverse()
      .sortBy('created_at');
    return {
      ...p,
      category_name: catMap[p.category_id] || '—',
      last_stock_in: lastIn[0]?.created_at || null
    };
  }));

  const sorted = sortBy(enriched, 'last_stock_in', 'asc');

  area.innerHTML = `
    <div class="card">
      ${reportHeader('Out of Stock Report', `${sorted.length} products with zero stock`)}
      <div style="padding:var(--space-lg);">
        ${!sorted.length
          ? renderEmptyState('No products are currently out of stock!', 'fa-solid fa-circle-check')
          : `
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Product</th><th>SKU</th><th>Category</th>
                    <th>Threshold</th><th>Last Stocked</th>
                  </tr>
                </thead>
                <tbody>
                  ${sorted.map(p => `
                    <tr>
                      <td>
                        <a href="#/products/${p.id}" style="color:var(--color-primary);font-weight:600;">
                          ${sanitize(p.name)}
                        </a>
                      </td>
                      <td><code style="font-size:10px;background:var(--color-surface-2);padding:2px 5px;border-radius:3px;">${sanitize(p.sku)}</code></td>
                      <td>${sanitize(p.category_name)}</td>
                      <td>${p.low_stock_threshold}</td>
                      <td class="${!p.last_stock_in ? 'text-danger' : 'text-muted'}">
                        ${p.last_stock_in ? formatDate(p.last_stock_in) : 'Never stocked'}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          `
        }
      </div>
    </div>
  `;

  document.getElementById('report-export-csv')?.addEventListener('click', () => {
    const rows = sorted.map(p => ({
      Name:        p.name,
      SKU:         p.sku,
      Category:    p.category_name,
      Threshold:   p.low_stock_threshold,
      Last_Stocked:p.last_stock_in ? formatDate(p.last_stock_in) : 'Never'
    }));
    exportCSV(rows, `out-of-stock-${new Date().toISOString().slice(0,10)}`);
    showToast('CSV exported.', 'success');
  });

  document.getElementById('report-export-pdf')?.addEventListener('click', () => {
    exportGenericTablePDF(
      'Out of Stock Report',
      `${sorted.length} products`,
      ['Name', 'SKU', 'Category', 'Threshold', 'Last Stocked'],
      sorted.map(p => [p.name, p.sku, p.category_name, String(p.low_stock_threshold), p.last_stock_in ? formatDate(p.last_stock_in) : 'Never'])
    );
  });
}

// ─── 7. LOW STOCK REPORT ──────────────────────────────────────────────────────
async function renderLowStockReport(area) {
  const products   = await db.products.where('is_active').equals(1).toArray();
  const lowStock   = products
    .filter(p => p.quantity <= p.low_stock_threshold && p.quantity > 0)
    .map(p => ({
      ...p,
      ratio:    p.quantity / p.low_stock_threshold,
      needed:   p.low_stock_threshold - p.quantity
    }));

  // Sort: most critical ratio first
  const sorted = sortBy(lowStock, 'ratio', 'asc');

  const categories = await db.categories.toArray();
  const catMap     = Object.fromEntries(categories.map(c => [c.id, c.name]));
  sorted.forEach(p => { p.category_name = catMap[p.category_id] || '—'; });

  area.innerHTML = `
    <div class="card">
      ${reportHeader('Low Stock Report', `${sorted.length} products below threshold`)}
      <div style="padding:var(--space-lg);">
        ${!sorted.length
          ? renderEmptyState('All products are above their low stock thresholds.', 'fa-solid fa-circle-check')
          : `
            <div class="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Product</th><th>SKU</th><th>Category</th>
                    <th>Current</th><th>Threshold</th><th>Needed</th>
                    <th>Stock Level</th>
                  </tr>
                </thead>
                <tbody>
                  ${sorted.map(p => {
                    const pct = Math.min(100, (p.quantity / p.low_stock_threshold) * 100);
                    return `
                      <tr>
                        <td>
                          <a href="#/products/${p.id}" style="color:var(--color-primary);font-weight:600;">
                            ${sanitize(p.name)}
                          </a>
                        </td>
                        <td><code style="font-size:10px;background:var(--color-surface-2);padding:2px 5px;border-radius:3px;">${sanitize(p.sku)}</code></td>
                        <td>${sanitize(p.category_name)}</td>
                        <td class="text-danger font-semibold">${p.quantity} ${sanitize(p.unit || '')}</td>
                        <td class="text-muted">${p.low_stock_threshold}</td>
                        <td class="text-warning font-semibold">+${p.needed} needed</td>
                        <td style="min-width:100px;">
                          <div style="background:var(--color-border);border-radius:4px;height:8px;overflow:hidden;">
                            <div style="
                              width:${pct.toFixed(0)}%;
                              height:100%;
                              background:${pct < 30 ? 'var(--color-danger)' : pct < 60 ? 'var(--color-warning)' : 'var(--color-success)'};
                              border-radius:4px;
                              transition:width 0.4s ease;
                            "></div>
                          </div>
                          <span style="font-size:10px;color:var(--color-text-muted);">${pct.toFixed(0)}%</span>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          `
        }
      </div>
    </div>
  `;

  document.getElementById('report-export-csv')?.addEventListener('click', () => {
    const rows = sorted.map(p => ({
      Name:       p.name, SKU: p.sku, Category: p.category_name,
      Current:    p.quantity, Threshold: p.low_stock_threshold, Needed: p.needed
    }));
    exportCSV(rows, `low-stock-${new Date().toISOString().slice(0,10)}`);
    showToast('CSV exported.', 'success');
  });

  document.getElementById('report-export-pdf')?.addEventListener('click', () => {
    exportGenericTablePDF('Low Stock Report', `${sorted.length} products`,
      ['Name', 'SKU', 'Category', 'Current', 'Threshold', 'Needed'],
      sorted.map(p => [p.name, p.sku, p.category_name, String(p.quantity), String(p.low_stock_threshold), `+${p.needed}`])
    );
  });
}

// ─── 8. EXPIRY REPORT ─────────────────────────────────────────────────────────
async function renderExpiryReport(area) {
  area.innerHTML = `
    <div class="card">
      ${reportHeader('Expiry Report')}
      <div style="padding:var(--space-lg);">
        <div style="display:flex;align-items:center;gap:var(--space-md);margin-bottom:var(--space-lg);flex-wrap:wrap;">
          <label class="form-label" style="margin:0;">Show items expiring within:</label>
          <select class="form-select" id="expiry-days" style="width:160px;">
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30" selected>30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
            <option value="0">Expired only</option>
          </select>
          <button class="btn btn-primary btn-sm" id="expiry-run-btn">
            <i class="fa-solid fa-rotate"></i> Generate
          </button>
        </div>
        <div id="expiry-report-body"></div>
      </div>
    </div>
  `;

  async function generate() {
    const daysVal = parseInt(document.getElementById('expiry-days')?.value, 10);
    const body    = document.getElementById('expiry-report-body');
    if (!body) return;

    body.innerHTML = `<div class="skeleton skeleton-text"></div>`;

    let products = await db.products.where('is_active').equals(1).toArray();

    if (daysVal === 0) {
      // Expired only
      products = products.filter(p => p.expiry_date && new Date(p.expiry_date) < new Date());
    } else {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + daysVal);
      products = products.filter(p => p.expiry_date && new Date(p.expiry_date) <= cutoff);
    }

    const sorted = sortBy(products.map(p => ({
      ...p,
      days_remaining: daysUntilExpiry(p.expiry_date)
    })), 'days_remaining', 'asc');

    if (!sorted.length) {
      body.innerHTML = renderEmptyState(
        daysVal === 0
          ? 'No expired products.'
          : `No products expiring within ${daysVal} days.`,
        'fa-solid fa-clock'
      );
      return;
    }

    body.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Product</th><th>SKU</th><th>Expiry Date</th>
              <th>Days Remaining</th><th>Stock</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${sorted.map(p => {
              const { label, cssClass } = expiryStatus(p.expiry_date);
              const rowCls = p.days_remaining < 0 ? 'row-expired'
                : p.days_remaining <= 7 ? 'row-expiring' : '';
              return `
                <tr class="${rowCls}">
                  <td>
                    <a href="#/products/${p.id}" style="color:var(--color-primary);font-weight:600;">
                      ${sanitize(p.name)}
                    </a>
                  </td>
                  <td><code style="font-size:10px;background:var(--color-surface-2);padding:2px 5px;border-radius:3px;">${sanitize(p.sku)}</code></td>
                  <td>${formatDate(p.expiry_date)}</td>
                  <td class="${cssClass} font-semibold">
                    ${p.days_remaining < 0 ? `${Math.abs(p.days_remaining)}d ago` : `${p.days_remaining}d`}
                  </td>
                  <td>${p.quantity.toLocaleString()} ${sanitize(p.unit || '')}</td>
                  <td><span class="${cssClass}">${sanitize(label)}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('report-export-csv')?.addEventListener('click', () => {
      const rows = sorted.map(p => ({
        Name: p.name, SKU: p.sku,
        Expiry_Date: formatDate(p.expiry_date),
        Days_Remaining: p.days_remaining,
        Stock: p.quantity
      }));
      exportCSV(rows, `expiry-report-${new Date().toISOString().slice(0,10)}`);
      showToast('CSV exported.', 'success');
    });

    document.getElementById('report-export-pdf')?.addEventListener('click', () => {
      exportGenericTablePDF('Expiry Report', `Within ${daysVal} days`,
        ['Name', 'SKU', 'Expiry Date', 'Days Remaining', 'Stock'],
        sorted.map(p => [p.name, p.sku, formatDate(p.expiry_date), String(p.days_remaining), String(p.quantity)])
      );
    });
  }

  document.getElementById('expiry-run-btn')?.addEventListener('click', generate);
  await generate();
}

// ─── 9. BEST SELLERS REPORT ───────────────────────────────────────────────────
async function renderBestSellersReport(area) {
  area.innerHTML = `
    <div class="card">
      ${reportHeader('Best Selling Products')}
      <div style="padding:var(--space-lg);">
        ${dateRangeControl('bestsellers', 'this_month')}
        <div id="bestsellers-report-body"></div>
      </div>
    </div>
  `;

  async function generate() {
    const from = document.getElementById('bestsellers-from')?.value;
    const to   = document.getElementById('bestsellers-to')?.value;
    const body = document.getElementById('bestsellers-report-body');
    if (!from || !to || !body) return;

    body.innerHTML = `<div class="skeleton skeleton-chart"></div>`;
    destroyAllCharts();

    const start = new Date(from); start.setHours(0, 0, 0, 0);
    const end   = new Date(to);   end.setHours(23, 59, 59, 999);

    const sales    = await getSalesInRange(start, end);
    const saleIds  = sales.map(s => s.id);
    const items    = saleIds.length
      ? await db.sale_items.where('sale_id').anyOf(saleIds).toArray()
      : [];

    const map = {};
    items.forEach(item => {
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
    });

    const ranked = Object.values(map)
      .sort((a, b) => b.units_sold - a.units_sold)
      .slice(0, AppConfig.TOP_PRODUCTS_LIMIT);

    if (!ranked.length) {
      body.innerHTML = renderEmptyState('No sales data in this date range.', 'fa-solid fa-trophy');
      return;
    }

    const colors = chartColors(Math.min(ranked.length, 10));

    body.innerHTML = `
      <div style="height:320px;margin-bottom:var(--space-xl);">
        <canvas id="bestsellers-chart"></canvas>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>#</th><th>Product</th><th>Units Sold</th><th>Revenue</th><th>Avg Price</th>
            </tr>
          </thead>
          <tbody>
            ${ranked.map((p, i) => `
              <tr>
                <td class="font-bold" style="color:${i < 3 ? 'var(--color-warning)' : 'var(--color-text-muted)'};">
                  #${i + 1}
                </td>
                <td class="font-semibold">${sanitize(p.product_name)}</td>
                <td><strong>${p.units_sold.toLocaleString()}</strong></td>
                <td><strong>${formatCurrency(p.revenue, currency())}</strong></td>
                <td class="text-muted">${formatCurrency(p.units_sold ? p.revenue / p.units_sold : 0, currency())}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    const ctx = document.getElementById('bestsellers-chart')?.getContext('2d');
    if (ctx) {
      destroyChart('bestsellers');
      _chartInstances.bestsellers = new Chart(ctx, {
        type: 'bar',
        data: {
          labels:   ranked.map(p => p.product_name.length > 20 ? p.product_name.slice(0, 20) + '…' : p.product_name),
          datasets: [{
            label:           'Units Sold',
            data:            ranked.map(p => p.units_sold),
            backgroundColor: colors.backgrounds,
            borderColor:     colors.borders,
            borderWidth:     1,
            borderRadius:    4
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                afterLabel: ctx => `Revenue: ${formatCurrency(ranked[ctx.dataIndex]?.revenue || 0, currency())}`
              }
            }
          },
          scales: {
            x: { beginAtZero: true, ticks: { stepSize: 1 } },
            y: { ticks: { font: { size: 11 } } }
          }
        }
      });
    }

    document.getElementById('report-export-csv')?.addEventListener('click', () => {
      const rows = ranked.map((p, i) => ({
        Rank: i + 1, Product: p.product_name,
        Units_Sold: p.units_sold, Revenue: p.revenue
      }));
      exportCSV(rows, `best-sellers-${from}-to-${to}`);
      showToast('CSV exported.', 'success');
    });

    document.getElementById('report-export-pdf')?.addEventListener('click', () => {
      exportGenericTablePDF('Best Selling Products', `${formatDate(from)} to ${formatDate(to)}`,
        ['Rank', 'Product', 'Units Sold', 'Revenue'],
        ranked.map((p, i) => [`#${i + 1}`, p.product_name, String(p.units_sold), formatCurrency(p.revenue, currency())])
      );
    });
  }

  document.getElementById('bestsellers-run-btn')?.addEventListener('click', generate);
  await generate();
}

// ─── 10. STOCK MOVEMENTS REPORT ───────────────────────────────────────────────
async function renderMovementsReport(area) {
  area.innerHTML = `
    <div class="card">
      ${reportHeader('Stock Movement Report')}
      <div style="padding:var(--space-lg);">
        <div style="display:flex;gap:var(--space-md);align-items:center;flex-wrap:wrap;margin-bottom:var(--space-lg);">
          ${dateRangeControl('movements', 'this_month').replace('<div style=', '<div style="display:contents;" ><div style=')}
          <select class="form-select" id="movements-type-filter" style="width:160px;">
            <option value="">All Types</option>
            <option value="stock_in">Stock In</option>
            <option value="stock_out">Stock Out</option>
            <option value="adjustment">Adjustment</option>
            <option value="sale">Sale</option>
            <option value="return">Return</option>
          </select>
        </div>
        <div id="movements-report-body"></div>
      </div>
    </div>
  `;

  async function generate() {
    const from    = document.getElementById('movements-from')?.value;
    const to      = document.getElementById('movements-to')?.value;
    const typeVal = document.getElementById('movements-type-filter')?.value;
    const body    = document.getElementById('movements-report-body');
    if (!from || !to || !body) return;

    body.innerHTML = `<div class="skeleton skeleton-text"></div>`;

    const start = new Date(from); start.setHours(0, 0, 0, 0);
    const end   = new Date(to);   end.setHours(23, 59, 59, 999);

    let movements = await db.stock_movements
      .where('created_at')
      .between(start.toISOString(), end.toISOString(), true, true)
      .toArray();

    if (typeVal) movements = movements.filter(m => m.type === typeVal);

    const products = await db.products.toArray();
    const users    = await db.users.toArray();
    const prodMap  = Object.fromEntries(products.map(p => [p.id, p.name]));
    const userMap  = Object.fromEntries(users.map(u => [u.id, u.name]));

    movements = movements
      .map(m => ({ ...m, product_name: prodMap[m.product_id] || `#${m.product_id}`, user_name: userMap[m.user_id] || 'System' }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const totalIn  = movements.filter(m => ['stock_in', 'return'].includes(m.type)).reduce((s, m) => s + Math.abs(m.quantity), 0);
    const totalOut = movements.filter(m => ['stock_out', 'sale'].includes(m.type)).reduce((s, m) => s + Math.abs(m.quantity), 0);

    if (!movements.length) {
      body.innerHTML = renderEmptyState('No movements in this date range.', 'fa-solid fa-clock-rotate-left');
      return;
    }

    body.innerHTML = `
      ${summaryBox([
        { label: 'Total Movements', value: movements.length },
        { label: 'Units In',        value: `+${totalIn.toLocaleString()}` },
        { label: 'Units Out',       value: `-${totalOut.toLocaleString()}` },
        { label: 'Net Change',      value: `${totalIn - totalOut >= 0 ? '+' : ''}${(totalIn - totalOut).toLocaleString()}` }
      ])}
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Product</th><th>Type</th>
              <th>Quantity</th><th>Note</th><th>By</th>
            </tr>
          </thead>
          <tbody>
            ${movements.map(m => {
              const isIn  = ['stock_in', 'return', 'adjustment'].includes(m.type) && m.quantity >= 0;
              const qStr  = m.quantity >= 0 ? `+${m.quantity}` : String(m.quantity);
              const qColor= isIn ? 'var(--color-success)' : 'var(--color-danger)';
              const typeLabels = {
                stock_in: 'Stock In', stock_out: 'Stock Out',
                adjustment: 'Adj.', sale: 'Sale', return: 'Return'
              };
              return `
                <tr>
                  <td style="white-space:nowrap;font-size:var(--text-xs);">${formatDateTime(m.created_at)}</td>
                  <td class="font-semibold">${sanitize(m.product_name)}</td>
                  <td><span class="badge badge-neutral">${sanitize(typeLabels[m.type] || m.type)}</span></td>
                  <td><strong style="color:${qColor};">${qStr}</strong></td>
                  <td class="text-muted text-xs">${sanitize((m.reference_note || '').slice(0, 50))}</td>
                  <td class="text-muted text-xs">${sanitize(m.user_name)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    document.getElementById('report-export-csv')?.addEventListener('click', () => {
      const rows = movements.map(m => ({
        Date: formatDateTime(m.created_at), Product: m.product_name,
        Type: m.type, Quantity: m.quantity,
        Note: m.reference_note || '', By: m.user_name
      }));
      exportCSV(rows, `movements-${from}-to-${to}`);
      showToast('CSV exported.', 'success');
    });

    document.getElementById('report-export-pdf')?.addEventListener('click', () => {
      exportGenericTablePDF('Stock Movement Report', `${formatDate(from)} to ${formatDate(to)}`,
        ['Date', 'Product', 'Type', 'Quantity', 'Note'],
        movements.map(m => [formatDate(m.created_at), m.product_name, m.type, String(m.quantity), (m.reference_note || '').slice(0, 40)])
      );
    });
  }

  document.getElementById('movements-run-btn')?.addEventListener('click', generate);
  await generate();
}

// ─── 11. SUPPLIER REPORT ──────────────────────────────────────────────────────
async function renderSupplierReport(area) {
  const suppliers = await db.suppliers.toArray();

  area.innerHTML = `
    <div class="card">
      ${reportHeader('Supplier Report')}
      <div style="padding:var(--space-lg);">
        <div style="display:flex;gap:var(--space-md);align-items:center;flex-wrap:wrap;margin-bottom:var(--space-lg);">
          ${dateRangeControl('supplier-rep', 'this_month')}
          <select class="form-select" id="supplier-rep-filter" style="width:200px;">
            <option value="">All Suppliers</option>
            ${suppliers.map(s => `<option value="${s.id}">${sanitize(s.name)}</option>`).join('')}
          </select>
        </div>
        <div id="supplier-report-body"></div>
      </div>
    </div>
  `;

  async function generate() {
    const from       = document.getElementById('supplier-rep-from')?.value;
    const to         = document.getElementById('supplier-rep-to')?.value;
    const supIdVal   = document.getElementById('supplier-rep-filter')?.value;
    const body       = document.getElementById('supplier-report-body');
    if (!from || !to || !body) return;

    body.innerHTML = `<div class="skeleton skeleton-text"></div>`;

    const start = new Date(from); start.setHours(0, 0, 0, 0);
    const end   = new Date(to);   end.setHours(23, 59, 59, 999);

    let filteredSuppliers = supIdVal
      ? suppliers.filter(s => String(s.id) === supIdVal)
      : suppliers;

    const products = await db.products.toArray();
    const prodMap  = Object.fromEntries(products.map(p => [p.id, p]));

    const allMovements = await db.stock_movements
      .where('created_at')
      .between(start.toISOString(), end.toISOString(), true, true)
      .and(m => m.type === 'stock_in')
      .toArray();

    const rows = await Promise.all(filteredSuppliers.map(async sup => {
      const supProducts  = products.filter(p => p.supplier_id === sup.id);
      const supProdIds   = new Set(supProducts.map(p => p.id));
      const supMovements = allMovements.filter(m => supProdIds.has(m.product_id));
      const totalUnits   = sum(supMovements, m => Math.abs(m.quantity));
      const totalCost    = sum(supMovements, m => Math.abs(m.quantity) * (prodMap[m.product_id]?.cost_price || 0));

      return {
        supplier_name:   sup.name,
        product_count:   supProducts.length,
        deliveries:      supMovements.length,
        total_units:     totalUnits,
        total_cost:      totalCost,
        movements:       supMovements
      };
    }));

    const hasData = rows.some(r => r.deliveries > 0);

    body.innerHTML = `
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Supplier</th><th>Products</th><th>Deliveries</th>
              <th>Units Received</th><th>Est. Total Cost</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td class="font-semibold">${sanitize(r.supplier_name)}</td>
                <td>${r.product_count}</td>
                <td>${r.deliveries}</td>
                <td>${r.total_units.toLocaleString()}</td>
                <td><strong>${formatCurrency(r.total_cost, currency())}</strong></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      ${!hasData ? `<div class="alert alert-info" style="margin-top:var(--space-lg);">No stock received from suppliers in this period.</div>` : ''}
    `;

    document.getElementById('report-export-csv')?.addEventListener('click', () => {
      const csvRows = rows.map(r => ({
        Supplier:     r.supplier_name,
        Products:     r.product_count,
        Deliveries:   r.deliveries,
        Units_Received:r.total_units,
        Est_Cost:     r.total_cost
      }));
      exportCSV(csvRows, `supplier-report-${from}-to-${to}`);
      showToast('CSV exported.', 'success');
    });

    document.getElementById('report-export-pdf')?.addEventListener('click', () => {
      exportGenericTablePDF('Supplier Report', `${formatDate(from)} to ${formatDate(to)}`,
        ['Supplier', 'Products', 'Deliveries', 'Units Received', 'Est. Cost'],
        rows.map(r => [r.supplier_name, String(r.product_count), String(r.deliveries), String(r.total_units), formatCurrency(r.total_cost, currency())])
      );
    });
  }

  document.getElementById('supplier-rep-run-btn')?.addEventListener('click', generate);
  await generate();
}

// ─── GENERIC PDF EXPORT ───────────────────────────────────────────────────────
function exportGenericTablePDF(title, subtitle, headers, rows) {
  try {
    const { jsPDF } = window.jspdf;
    const doc       = new jsPDF('p', 'mm', 'a4');
    const settings  = window.AppState.settings || {};
    let   y         = buildPDFHeader(doc, title, settings);

    if (subtitle) {
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.setFont('helvetica', 'normal');
      doc.text(subtitle, 14, y);
      y += 8;
    }

    doc.autoTable({
      startY: y,
      head:   [headers],
      body:   rows,
      ...tableStyle(settings.primary_color)
    });

    const safeTitle = title.toLowerCase().replace(/\s+/g, '-');
    doc.save(`${safeTitle}-${new Date().toISOString().slice(0, 10)}.pdf`);
    showToast('PDF exported.', 'success');
  } catch (err) {
    console.error('[Reports] Generic PDF error:', err);
    showToast('PDF export failed. Check jsPDF is loaded.', 'error');
  }
}

function destroyChart(key) {
  if (_chartInstances[key]) {
    try { _chartInstances[key].destroy(); } catch { /* ignore */ }
    delete _chartInstances[key];
  }
}

// ─── EXPORTS ──────────────────────────────────────────────────────────────────
export { init, destroy };
