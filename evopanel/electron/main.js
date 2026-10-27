// Electron 主进程 - GoGo
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

// 全局变量
let mainWindow = null;
let backendProcess = null;
const isDev = !app.isPackaged;

// 后端进程管理
function startBackend() {
  if (backendProcess) return;

  // 候选后端路径：开发模式优先用 src-tauri/binaries 下的 sidecar（PyInstaller 产物），
  // 找不到再回退 backend/dist；打包模式统一从 resources/gogo-gateway 取（与 electron-builder
  // extraResources 的 to 名一致，避免 macOS/Linux 区分大小写下找不到后端）。
  const candidates = isDev
    ? [
        path.join(__dirname, '..', 'src-tauri', 'binaries', 'gogo-gateway', 'gogo-gateway.exe'),
        path.join(__dirname, '..', '..', 'backend', 'dist', 'gogo-gateway', 'gogo-gateway.exe')
      ]
    : [
        path.join(process.resourcesPath, 'gogo-gateway', 'gogo-gateway.exe')
      ];
  const backendPath = candidates.find((p) => fs.existsSync(p));

  if (!backendPath) {
    console.warn(`Backend not found (tried: ${candidates.join(', ')})`);
    return;
  }

  // Gateway bind port: GoGo_GATEWAY_PORT overrides the 8012 default.
  // Windows may reserve 8002-8101 for Hyper-V/WSL -> bind fails with winerror 10013.
  const gatewayPort = parseInt(process.env.GoGo_GATEWAY_PORT || '8012', 10);
  const gatewayArgs = Number.isFinite(gatewayPort) && gatewayPort > 0 ? ['--port', String(gatewayPort)] : [];

  console.log(`Starting backend: ${backendPath} ${gatewayArgs.join(' ')}`);

  backendProcess = spawn(backendPath, gatewayArgs, {
    detached: false,
    stdio: 'pipe',
    env: {
      ...process.env,
      GoGo_DATA_DIR: path.join(app.getPath('userData'), 'data')
    }
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`[Backend] ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`[Backend Error] ${data}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`Backend exited with code ${code}`);
    backendProcess = null;
  });

  backendProcess.on('error', (err) => {
    console.error(`Backend error: ${err}`);
    backendProcess = null;
  });
}

function stopBackend() {
  if (backendProcess) {
    console.log('Stopping backend...');
    backendProcess.kill('SIGTERM');
    setTimeout(() => {
      if (backendProcess) {
        backendProcess.kill('SIGKILL');
      }
    }, 3000);
    backendProcess = null;
  }
}

// 创建主窗口
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'GoGo',
    icon: path.join(__dirname, '..', 'public', 'favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    show: false
  });

  // 加载页面
  if (isDev) {
    mainWindow.loadURL('http://localhost:1421');
    // 开发模式打开开发者工具
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 外部链接在浏览器中打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 应用就绪
app.whenReady().then(() => {
  // 启动后端
  startBackend();
  
  // 等待后端启动
  setTimeout(() => {
    createWindow();
  }, 2000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 所有窗口关闭时退出
app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用退出前清理
app.on('before-quit', () => {
  stopBackend();
});

// IPC 通信
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-data-path', () => {
  return app.getPath('userData');
});

ipcMain.handle('open-external', (event, url) => {
  return shell.openExternal(url);
});

ipcMain.handle('restart-backend', () => {
  stopBackend();
  setTimeout(() => {
    startBackend();
  }, 1000);
  return true;
});
