import { cn } from '@/lib/utils/cn';

/**
 * Hero-style smooth backdrop: a gentle radial wash plus one slow-drifting
 * soft orb. No grids, no harsh shapes - decoration only.
 */
export function SoftBackdrop({
  tone = 'primary',
  className,
}: {
  tone?: 'primary' | 'info' | 'success';
  className?: string;
}) {
  const orb =
    tone === 'success' ? 'bg-success/10' : tone === 'info' ? 'bg-info/10' : 'bg-primary/10';
  return (
    <div
      aria-hidden="true"
      className={cn('pointer-events-none absolute inset-x-0 top-0 overflow-hidden', className)}
    >
      <div className="absolute inset-0 h-72 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent_70%)]" />
      <div
        className={cn(
          'animate-drift-a absolute left-1/2 top-[-8rem] h-64 w-[36rem] -translate-x-1/2 rounded-full blur-3xl',
          orb,
        )}
      />
    </div>
  );
}
