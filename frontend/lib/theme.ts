export type ThemeChoice = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'fd-theme';
export const THEME_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var r=document.documentElement;if(t==='light'){r.classList.add('light')}else if(t==='dark'){r.classList.add('dark')}}catch(e){}`;

/** Applies an explicit choice; `system` clears the class (media query wins). */
export function applyTheme(choice: ThemeChoice): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  if (choice === 'light') root.classList.add('light');
  if (choice === 'dark') root.classList.add('dark');
}

export function readStoredTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function storeTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // privacy mode — the session keeps the in-memory choice
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(THEME_EVENT));
}

const THEME_EVENT = 'fd-theme-change';

/**
 * Notifies `useSyncExternalStore` subscribers when the choice changes —
 * same-tab writes via the custom event, other tabs via the storage event.
 */
export function subscribeTheme(callback: () => void): () => void {
  const handler = (event: Event) => {
    if (event.type === THEME_EVENT) callback();
    else if (event.type === 'storage' && (event as StorageEvent).key === THEME_STORAGE_KEY)
      callback();
  };
  window.addEventListener(THEME_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(THEME_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}

/** What the user currently sees, resolving `system` via the media query. */
export function effectiveTheme(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};
