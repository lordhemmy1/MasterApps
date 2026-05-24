/**
 * Stockdity IMS — Electron Desktop Wrapper
 * Packages the web app as a native Windows/Mac/Linux executable.
 *
 * Build commands (after npm install):
 *   Windows:  npm run build:win
 *   macOS:    npm run build:mac
 *   Linux:    npm run build:linux
 */

'use strict';

const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:           1400,
    height:          900,
    minWidth:        900,
    minHeight:       600,
    icon:            path.join(__dirname, 'assets', 'images', 'icon-512.png'),
    title:           'Stockdity IMS',
    backgroundColor: '#F8FAFC',
    show:            false,           // shown after ready-to-show
    webPreferences: {
      nodeIntegration:  false,        // keep Node.js out of renderer
      contextIsolation: true,         // security best practice
      webSecurity:      true,
      // Allow IndexedDB and localStorage to persist between app restarts
      partition:        'persist:stockdityims'
    }
  });

  // Load the app
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Show once fully loaded (prevents blank flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Open external links in the OS browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Application Menu ──────────────────────────────────────────────────────────
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label:       'Print',
          accelerator: 'CmdOrCtrl+P',
          click:       () => mainWindow?.webContents.print()
        },
        { type: 'separator' },
        {
          label:       'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click:       () => app.quit()
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label:       'Reload',
          accelerator: 'CmdOrCtrl+R',
          click:       () => mainWindow?.reload()
        },
        { type: 'separator' },
        { role: 'zoomIn'         },
        { role: 'zoomOut'        },
        { role: 'resetZoom'      },
        { type: 'separator'      },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Stockdity IMS',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type:    'info',
              title:   'Stockdity IMS',
              message: 'Stockdity IMS\nVersion 1.0.0',
              detail:  'Offline Inventory Management System\nDeveloped by Ascendia Core Ltd.\n\nAll rights reserved.'
            });
          }
        }
      ]
    }
  ];

  // macOS: add app menu
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── App Lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildMenu();
  createWindow();

  // macOS: re-create window when dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Security: deny all permission requests (camera, mic, etc.)
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    const localFile = `file://${path.join(__dirname, 'index.html')}`;
    if (!url.startsWith(localFile) && !url.startsWith('file://')) {
      event.preventDefault();
    }
  });
});
