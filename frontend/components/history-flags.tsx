'use client';

import { useEffect } from 'react';

import { clearBackLatch, clearForwardLatch, installHistoryNavFlags } from '@/lib/history-nav';

/** Installs the navigation latches <HistoryNav /> reads. A fresh document
 *  starts with no in-app history behind or ahead of it, so both latches
 *  reset on load; client-side pushes never remount this component. */
export function HistoryFlags() {
  useEffect(() => {
    installHistoryNavFlags();
    clearBackLatch();
    clearForwardLatch();
  }, []);
  return null;
}
