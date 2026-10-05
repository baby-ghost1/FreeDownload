import { cn } from '@/lib/utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Renders `aria-invalid` + destructive border when set. */
  error?: string | undefined;
}

export function Input({
  error,
  className,
  id,
  ref,
  ...props
}: InputProps & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <input
      ref={ref}
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error && id ? `${id}-error` : undefined}
      className={cn(
        'h-11 w-full rounded-md border bg-surface px-3.5 text-sm text-foreground',
        'placeholder:text-muted-foreground shadow-1 transition-colors',
        'duration-[var(--duration-fast)]',
        'focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-0',
        error ? 'border-destructive' : 'border-border-strong',
        className,
      )}
      {...props}
    />
  );
}

export function Label({
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn('mb-1.5 block text-sm font-medium text-foreground', className)} {...props}>
      {children}
    </label>
  );
}

export function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-sm text-destructive" role="alert">
      {children}
    </p>
  );
}
