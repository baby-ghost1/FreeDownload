import { cn } from '@/lib/utils/cn';

/**
 * Minimal three-dot loader. Deliberately distinct from the circular `Spinner`
 * - a quiet swell-and-fade beat instead of a spinning arc, for button and
 * inline loading states where a ring reads as too busy.
 */
export function Loader({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className={cn('inline-flex items-center gap-1', className)}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          className="size-1.5 rounded-full bg-current"
          style={{ animation: `loader-dot 1.1s ease-in-out ${i * 0.15}s infinite` }}
        />
      ))}
    </span>
  );
}
