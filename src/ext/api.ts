// The slice of the WebExtension API we use. Firefox exposes promise-based
// `browser`; Chrome MV3's `chrome` returns promises too.
type Changes = Record<string, { newValue?: unknown; oldValue?: unknown }>;

export interface ExtApi {
  storage: {
    local: {
      get(keys?: string | string[] | null): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    onChanged: { addListener(cb: (changes: Changes, area: string) => void): void };
  };
  idle?: {
    setDetectionInterval(seconds: number): void;
    onStateChanged: { addListener(cb: (state: string) => void): void };
  };
  runtime: { onInstalled?: { addListener(cb: () => void): void } };
  tabs?: { query(q: object): Promise<{ url?: string }[]> };
  permissions?: {
    contains(p: { origins: string[] }): Promise<boolean>;
    request(p: { origins: string[] }): Promise<boolean>;
  };
}

const g = globalThis as unknown as { browser?: ExtApi; chrome?: ExtApi };
export const ext: ExtApi = (g.browser ?? g.chrome)!;
