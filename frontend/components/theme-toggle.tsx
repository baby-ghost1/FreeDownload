'use client';

import { motion } from 'motion/react';
import { useEffect, useSyncExternalStore } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import {
  applyTheme,
  effectiveTheme,
  NEXT_THEME,
  readStoredTheme,
  storeTheme,
  subscribeTheme,
  type ThemeChoice,
} from '@/lib/theme';

const ICONS: Record<ThemeChoice, React.ReactNode> = {
  light: <Sun className="size-4" aria-hidden="true" />,
  dark: <Moon className="size-4" aria-hidden="true" />,
  system: <Monitor className="size-4" aria-hidden="true" />,
};

const LABELS: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

const readServerTheme = (): ThemeChoice => 'system';

/** Cycles light → dark → system; persisted and applied pre-paint by THEME_SCRIPT. */
export function ThemeToggle({ className }: { className?: string }) {
  const choice = useSyncExternalStore(subscribeTheme, readStoredTheme, readServerTheme);

  useEffect(() => {
    applyTheme(choice);
  }, [choice]);

  const next = NEXT_THEME[choice];

  return (
    <motion.button
      type="button"
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92, rotate: -8 }}
      onClick={() => {
        storeTheme(next);
        applyTheme(next);
      }}
      className={
        className ??
        'inline-flex size-9 items-center justify-center rounded-md border border-border ' +
          'bg-surface text-muted-foreground transition-colors hover:text-foreground hover:border-border-strong'
      }
      title={`Theme: ${LABELS[next]}`}
      aria-label={`Switch theme (currently ${LABELS[choice]}, ${effectiveTheme(choice)})`}
      data-theme-choice={choice}
    >
      <motion.span
        key={choice}
        initial={{ opacity: 0, rotate: -60, scale: 0.8 }}
        animate={{ opacity: 1, rotate: 0, scale: 1 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="flex"
      >
        {ICONS[choice]}
      </motion.span>
    </motion.button>
  );
}
