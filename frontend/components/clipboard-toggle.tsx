'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useState } from 'react';
import { ClipboardPaste, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

/**
 * One control, two jobs: empty field shows paste-from-clipboard, filled
 * field flips to clear. The icon cross-fades between the two states.
 */
export function ClipboardToggle({
  value,
  onPaste,
  onClear,
  disabled,
  className,
}: {
  value: string;
  onPaste: (text: string) => void;
  onClear: () => void;
  disabled?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const filled = value.trim().length > 0;

  const onClick = useCallback(async () => {
    if (filled) {
      onClear();
      return;
    }
    setBusy(true);
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) onPaste(text.trim());
    } catch {
      /* Clipboard unavailable - the user can paste manually. */
    } finally {
      setBusy(false);
    }
  }, [filled, onPaste, onClear]);

  const label = filled ? 'Clear link' : 'Paste from clipboard';

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled || busy}
      title={label}
      aria-label={label}
      className={cn(
        'flex h-12 w-[52px] shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary',
        'transition-all duration-200 hover:bg-primary/20 active:scale-90',
        'disabled:opacity-40',
        filled &&
          'bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive',
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={filled ? 'clear' : 'paste'}
          initial={{ opacity: 0, scale: 0.7, rotate: -30 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.7, rotate: 30 }}
          transition={{ duration: 0.18 }}
          className="flex"
        >
          {filled ? (
            <Trash2 className="size-5" aria-hidden="true" />
          ) : (
            <ClipboardPaste className="size-5" aria-hidden="true" />
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
