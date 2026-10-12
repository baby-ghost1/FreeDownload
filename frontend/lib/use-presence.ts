'use client';

import { useEffect, useState } from 'react';

export interface Presence {
  /** Whether the element should be in the DOM (enter or exit phase). */
  mounted: boolean;
  /** True while the leave animation should play (element still mounted). */
  leaving: boolean;
}

interface PresenceState {
  mounted: boolean;
  leaving: boolean;
  /** Last seen `present`, so we can detect changes during render. */
  prev: boolean;
}

/**
 * Tracks enter/leave so a CSS exit animation can play before unmount.
 *
 * `motion/react`'s AnimatePresence keeps a component mounted until its exit
 * transition finishes; this is the CSS equivalent. Pass the "wants to be open"
 * boolean; when it flips false we stay mounted for `exitMs` (playing the
 * matching `animate-*-out` class) before actually unmounting.
 */
export function usePresence(present: boolean, exitMs = 200): Presence {
  const [state, setState] = useState<PresenceState>(() => ({
    mounted: present,
    leaving: false,
    prev: present,
  }));

  // Render-phase adjustment (React's documented "adjust state when props
  // change"): opening mounts immediately; closing marks `leaving` but stays
  // mounted so the exit animation can play.
  if (state.prev !== present) {
    setState(
      present
        ? { mounted: true, leaving: false, prev: true }
        : { ...state, leaving: true, prev: false },
    );
  }

  useEffect(() => {
    if (!state.leaving) return;
    const t = window.setTimeout(() => {
      setState((s) => ({ ...s, mounted: false, leaving: false }));
    }, exitMs);
    return () => window.clearTimeout(t);
  }, [state.leaving, exitMs]);

  return { mounted: state.mounted, leaving: state.leaving };
}
