'use client';

import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

type ToastTone = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

const ICONS: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />,
  error: <AlertCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />,
  info: <Info className="size-4 shrink-0 text-info" aria-hidden="true" />,
};

const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 3500);
  }, []);

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
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.97 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="glass pointer-events-auto flex w-auto max-w-full items-center gap-2.5 rounded-xl border border-border bg-surface/90 py-3 pl-3.5 pr-4 shadow-3"
            >
              {ICONS[t.tone]}
              <p className="text-sm text-foreground">{t.message}</p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
