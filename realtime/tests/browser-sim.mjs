// A simulated browser for running a built extension background script in Node:
// mock chrome.* (storage with change events, runtime messages, idle, alarms)
// plus Node's real WebSocket. Used by background.test.mjs and compat.test.mjs.
import vm from "node:vm";
import { webcrypto } from "node:crypto";

function listeners() {
  const list = [];
  return { list, addListener: (cb) => list.push(cb) };
}

export class Browser {
  static all = [];

  constructor(name, settings, code) {
    this.name = name;
    this.store = { settings };
    this.changed = listeners();
    this.messages = listeners();
    this.idleChanged = listeners();
    this.alarm = listeners();
    this.timers = new Set();
    const self = this;
    const chrome = {
      storage: {
        local: {
          get: async (keys) => {
            const ks = keys == null ? Object.keys(self.store) : [].concat(keys);
            return structuredClone(Object.fromEntries(ks.filter((k) => k in self.store).map((k) => [k, self.store[k]])));
          },
          set: async (items) => {
            const changes = {};
            for (const [k, v] of Object.entries(items)) {
              changes[k] = { oldValue: self.store[k], newValue: structuredClone(v) };
              self.store[k] = structuredClone(v);
            }
            self.changed.list.forEach((cb) => cb(changes, "local"));
          },
          remove: async (keys) => { for (const k of [].concat(keys)) delete self.store[k]; },
        },
        onChanged: this.changed,
      },
      idle: { setDetectionInterval() {}, queryState: async () => "active", onStateChanged: this.idleChanged },
      alarms: { create() {}, onAlarm: this.alarm },
      runtime: { onMessage: this.messages, sendMessage: async () => {}, getPlatformInfo: async () => ({}) },
    };
    const track = (fn) => (...a) => { const id = fn(...a); self.timers.add(id); return id; };
    this.ctx = vm.createContext({
      chrome, WebSocket, crypto: webcrypto, btoa, atob, TextEncoder, TextDecoder, URL, console,
      setTimeout: track(setTimeout), setInterval: track(setInterval), clearTimeout, clearInterval,
    });
    vm.runInContext(code, this.ctx);
    Browser.all.push(this);
  }
  act(rt) { this.message({ rt }); }
  message(m) { this.messages.list.forEach((cb) => cb(m, {}, () => {})); }
  wake() { this.alarm.list.forEach((cb) => cb({ name: "rt-wake" })); }
  setIdle(state) { this.idleChanged.list.forEach((cb) => cb(state)); }
  get state() { return this.store.rt_state; }
  async until(pred, what, ms = 8000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { if (pred(this.store)) return; } catch { /* not there yet */ }
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error(`${this.name}: timed out waiting for ${what}; conn=${this.store.rt_conn} state=${JSON.stringify(this.store.rt_state)?.slice(0, 300)}`);
  }
  stop() {
    this.setIdle("locked");
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
  }
}
