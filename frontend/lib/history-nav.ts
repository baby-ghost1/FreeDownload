const BACK_KEY = 'fd_came_forward';
const FORWARD_KEY = 'fd_can_forward';

export function cameForward(): boolean {
  try {
    return sessionStorage.getItem(BACK_KEY) === '1';
  } catch {
    return false;
  }
}

export function canForward(): boolean {
  try {
    return sessionStorage.getItem(FORWARD_KEY) === '1';
  } catch {
    return false;
  }
}

export function markWentBack(): void {
  try {
    sessionStorage.setItem(FORWARD_KEY, '1');
  } catch {
    // Private mode - the browser's own back button still works.
  }
}

export function clearForwardLatch(): void {
  try {
    sessionStorage.removeItem(FORWARD_KEY);
  } catch {
    // Private mode - nothing to clear.
  }
}

export function clearBackLatch(): void {
  try {
    sessionStorage.removeItem(BACK_KEY);
  } catch {
    // Private mode - nothing to clear.
  }
}

let installed = false;

/** Wraps history.pushState once so every in-app forward navigation records
 *  "a page is behind us" and drops any stale forward latch (a push clears
 *  the browser's forward stack). Installed from the root layout. */
export function installHistoryNavFlags(): void {
  if (installed) return;
  installed = true;
  try {
    const original = history.pushState.bind(history);
    history.pushState = (...args: Parameters<History['pushState']>) => {
      try {
        sessionStorage.setItem(BACK_KEY, '1');
        sessionStorage.removeItem(FORWARD_KEY);
      } catch {
        // Private mode - the nav simply stays hidden.
      }
      return original(...args);
    };
  } catch {
    // History unavailable - the nav simply stays hidden.
  }
}
