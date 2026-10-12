'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  /** True once the auto-dismiss timer fires; plays the exit anim before removal. */
  leaving?: boolean;
}

const ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />,
  error: <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />,
  info: <Info className="size-4 shrink-0 text-info" aria-hidden="true" />,
};

const EXIT_MS = 200;

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<number[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = Date.now() + Math.random();
      setToasts((current) => [...current.slice(-2), { id, message, tone }]);
      // Phase 1: mark leaving so the exit animation plays.
      const leaveTimer = window.setTimeout(() => {
        setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      }, 3500);
      // Phase 2: actually remove once the exit animation has had time to finish.
      const removeTimer = window.setTimeout(() => remove(id), 3500 + EXIT_MS);
      timers.current.push(leaveTimer, removeTimer);
    },
    [remove],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className={cn(
          'pointer-events-none fixed bottom-5 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2',
          'flex-col items-center gap-2 px-4 sm:left-auto sm:right-6 sm:translate-x-0 sm:items-end sm:px-0',
        )}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'glass pointer-events-auto flex w-auto max-w-full items-center gap-2.5 rounded-xl border border-border bg-surface/90 py-3 pl-3.5 pr-4 shadow-3',
              t.leaving ? 'animate-rise-out' : 'animate-rise-in',
            )}
          >
            {ICONS[t.tone]}
            <p className="text-sm text-foreground">{t.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
