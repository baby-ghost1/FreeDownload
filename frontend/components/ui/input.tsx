'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

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

/** Password field with a show/hide toggle (44px touch target). */
export function PasswordInput({ className, ...props }: InputProps) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input type={shown ? 'text' : 'password'} className={cn('pr-12', className)} {...props} />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
        title={shown ? 'Hide password' : 'Show password'}
        className="absolute right-1.5 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {shown ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
