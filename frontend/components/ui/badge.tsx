import { cn } from '@/lib/utils/cn';

export type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const TONES: Record<BadgeTone, string> = {
  default: 'bg-primary/12 text-primary border-primary/25',
  success: 'bg-success/12 text-success border-success/25',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-destructive/12 text-destructive border-destructive/25',
  info: 'bg-info/12 text-info border-info/25',
  muted: 'bg-muted text-muted-foreground border-border',
};

export function Badge({
  tone = 'default',
  className,
  ...props
}: { tone?: BadgeTone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
