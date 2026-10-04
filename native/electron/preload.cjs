const { contextBridge, ipcRenderer } = require('electron');

// A sandboxed renderer receives file operations only, never arbitrary filesystem paths or IPC.
contextBridge.exposeInMainWorld('railSimStorage', {
  read: (key) => ipcRenderer.invoke('rail-sim:read', key),
  write: (key, value) => ipcRenderer.invoke('rail-sim:write', key, value),
  remove: (key) => ipcRenderer.invoke('rail-sim:remove', key),
  list: (prefix) => ipcRenderer.invoke('rail-sim:list', prefix),
  onBeforeClose: (callback) => {
    const listener = async () => {
      try { await callback(); ipcRenderer.send('rail-sim:close-ready', { success: true }); }
      catch (error) { ipcRenderer.send('rail-sim:close-ready', { success: false, error: String(error?.message ?? error) }); }
    };
    ipcRenderer.on('rail-sim:before-close', listener);
    return () => ipcRenderer.removeListener('rail-sim:before-close', listener);
  },
});
