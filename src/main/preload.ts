import { contextBridge, ipcRenderer } from "electron";

export interface PetBridge {
  onCursor(cb: (x: number, y: number) => void): void;
  onBounds(cb: (width: number, height: number) => void): void;
  idleSeconds(): Promise<number>;
  setClickThrough(through: boolean): void;
  showMenu(): void;
  savePng(name: string, dataUrl: string): Promise<void>;
  galleryDone(): void;
}

const bridge: PetBridge = {
  onCursor: (cb) => { ipcRenderer.on("cursor", (_e, x: number, y: number) => cb(x, y)); },
  onBounds: (cb) => { ipcRenderer.on("bounds", (_e, w: number, h: number) => cb(w, h)); },
  idleSeconds: () => ipcRenderer.invoke("idle-seconds"),
  setClickThrough: (through) => ipcRenderer.send("click-through", through),
  showMenu: () => ipcRenderer.send("show-menu"),
  savePng: (name, dataUrl) => ipcRenderer.invoke("save-png", name, dataUrl),
  galleryDone: () => ipcRenderer.send("gallery-done"),
};

contextBridge.exposeInMainWorld("pet", bridge);
