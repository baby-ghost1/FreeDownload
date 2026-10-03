'use client';

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
    <button
      type="button"
      onClick={() => {
        storeTheme(next);
        applyTheme(next);
      }}
      className={
        className ??
        'inline-flex size-9 items-center justify-center rounded-md border border-border ' +
          'bg-surface text-muted-foreground transition-colors hover:text-foreground'
      }
      title={`Theme: ${LABELS[next]}`}
      aria-label={`Switch theme (currently ${LABELS[choice]}, ${effectiveTheme(choice)})`}
      data-theme-choice={choice}
    >
      {ICONS[choice]}
    </button>
  );
}
