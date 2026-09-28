// Only the background context can see system idle state; mirror it into
// storage so every tab's cat knows when you've stepped away.
import { ext } from "./api";
import { IDLE_DETECTION_S } from "./state";

ext.idle?.setDetectionInterval(IDLE_DETECTION_S);
ext.idle?.onStateChanged.addListener((state) => {
  ext.storage.local.set({ idle: { state, since: Date.now() } });
});
ext.runtime.onInstalled?.addListener(() => {
  ext.storage.local.set({ idle: { state: "active", since: Date.now() } });
});
