// chrome.* shim for the popup test: storage backed by the harness, and a spy
// on runtime.sendMessage so the test can see exactly what each button sends.
const { ipcRenderer } = require("electron");

const listeners = [];
ipcRenderer.on("storage-changed", (_e, changes) => listeners.forEach((cb) => cb(changes, "local")));

window.chrome = {
  storage: {
    local: {
      get: async (keys) => ipcRenderer.sendSync("storage-get", keys ?? null),
      set: async (items) => { ipcRenderer.sendSync("storage-set", JSON.parse(JSON.stringify(items))); },
      remove: async (keys) => { ipcRenderer.sendSync("storage-remove", keys); },
    },
    onChanged: { addListener: (cb) => listeners.push(cb) },
  },
  runtime: {
    sendMessage: async (m) => { ipcRenderer.send("sent", JSON.parse(JSON.stringify(m))); },
    onMessage: { addListener() {} },
  },
  tabs: { query: async () => [{ url: "https://example.com/article" }] },
  permissions: { contains: async () => true, request: async () => true },
};
