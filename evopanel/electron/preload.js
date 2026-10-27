// Electron preload 脚本 - GoGo
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('GoGo', {
  // 获取应用版本
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // 获取数据目录
  getDataPath: () => ipcRenderer.invoke('get-data-path'),
  
  // 打开外部链接
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // 重启后端
  restartBackend: () => ipcRenderer.invoke('restart-backend'),
  
  // 平台信息
  platform: process.platform,
  isElectron: true
});

// 兼容 Tauri API（让现有代码无需大改）
contextBridge.exposeInMainWorld('__TAURI__', {
  // 提供基本的 Tauri API 兼容层
  app: {
    getVersion: () => ipcRenderer.invoke('get-app-version')
  },
  core: {
    invoke: (cmd, args) => {
      // 将 Tauri 调用转换为 Electron IPC
      return ipcRenderer.invoke(cmd, args);
    }
  },
  event: {
    listen: (event, callback) => {
      const listener = (_, ...args) => callback(...args);
      ipcRenderer.on(event, listener);
      return () => ipcRenderer.removeListener(event, listener);
    }
  }
});
