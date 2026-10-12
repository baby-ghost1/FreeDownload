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
          'bg-surface text-muted-foreground transition-all duration-200 hover:text-foreground hover:border-border-strong ' +
          'hover:scale-[1.06] active:scale-[0.92] active:-rotate-[8deg]'
      }
      title={`Theme: ${LABELS[next]}`}
      aria-label={`Switch theme (currently ${LABELS[choice]}, ${effectiveTheme(choice)})`}
      data-theme-choice={choice}
    >
      {/* key remounts the span on change so the CSS pop animation replays. */}
      <span key={choice} className="flex animate-icon-pop">
        {ICONS[choice]}
      </span>
    </button>
  );
}
