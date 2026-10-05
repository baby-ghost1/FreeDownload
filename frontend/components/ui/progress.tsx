import { cn } from '@/lib/utils/cn';

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('size-5 animate-spin text-primary', className)}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
    </svg>
  );
}

export function Progress({
  value,
  className,
  label,
}: {
  /** 0–100. */
  value: number;
  className?: string;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={cn('flex items-center gap-3', className)}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
    >
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
        <div
          className="relative h-full overflow-hidden rounded-full bg-gradient-to-r from-primary to-info transition-[width] duration-500 ease-[var(--ease-out)]"
          style={{ width: `${clamped}%` }}
        >
          <div aria-hidden="true" className="progress-stripes absolute inset-0 opacity-60" />
        </div>
      </div>
      <span className="w-10 text-right text-xs font-medium tabular-nums text-muted-foreground">
        {clamped}%
      </span>
    </div>
  );
}
