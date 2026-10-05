/**
 * Anonymous ownership key (contract §15): the client mints it, persists it in
 * localStorage and sends it as `X-Anon-Key` so unauthenticated visitors own
 * their jobs. Pattern mirrors the API: `[A-Za-z0-9_-]{8,64}`.
 */

const STORAGE_KEY = 'fd_anon_key';
const ANON_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Storage can throw in privacy modes - degrade to a per-session key.
    return null;
  }
}

/** URL-safe random id; hyphens/underscores keep the API pattern satisfied. */
export function createAnonKey(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Returns the stored key, minting one on first use. SSR-safe (returns ''). */
export function getAnonKey(store?: KeyValueStore | null): string {
  const target = store === undefined ? defaultStore() : store;
  if (!target) return '';
  try {
    const existing = target.getItem(STORAGE_KEY);
    if (existing && ANON_KEY_RE.test(existing)) return existing;
    const fresh = createAnonKey();
    target.setItem(STORAGE_KEY, fresh);
    return fresh;
  } catch {
    return '';
  }
}

export function isAnonKey(value: string): boolean {
  return ANON_KEY_RE.test(value);
}
