// A tiny chrome.* shim backed by the harness's main process, so every test
// window shares one "extension storage" like real tabs do.
const { ipcRenderer } = require("electron");

const listeners = [];
ipcRenderer.on("storage-changed", (_e, changes) => listeners.forEach((cb) => cb(changes, "local")));

window.__KITTY_TEST__ = true;
window.chrome = {
  storage: {
    local: {
      get: async (keys) => ipcRenderer.sendSync("storage-get", keys ?? null),
      set: async (items) => { ipcRenderer.sendSync("storage-set", JSON.parse(JSON.stringify(items))); },
      remove: async (keys) => { ipcRenderer.sendSync("storage-remove", keys); },
    },
    onChanged: { addListener: (cb) => listeners.push(cb) },
  },
  runtime: {},
};
