'use client';

import { motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

export type AlertTone = 'error' | 'success' | 'info';

const TONES: Record<AlertTone, { wrap: string; icon: React.ReactNode }> = {
  error: {
    wrap: 'border-destructive/30 bg-destructive/8 text-destructive',
    icon: <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />,
  },
  success: {
    wrap: 'border-success/30 bg-success/8 text-success',
    icon: <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />,
  },
  info: {
    wrap: 'border-info/30 bg-info/8 text-info',
    icon: <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />,
  },
};

export interface AlertProps {
  tone?: AlertTone;
  className?: string;
  children: React.ReactNode;
  role?: 'alert' | 'status';
  id?: string;
  'data-testid'?: string;
}

export function Alert({ tone = 'info', className, children, role, id, ...rest }: AlertProps) {
  const t = TONES[tone];
  return (
    <motion.div
      id={id}
      {...rest}
      initial={{ opacity: 0, y: -8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'flex gap-2.5 rounded-md border px-3.5 py-3 text-sm shadow-1',
        t.wrap,
        className,
      )}
      role={role ?? (tone === 'error' ? 'alert' : 'status')}
    >
      {t.icon}
      <div className="min-w-0">{children}</div>
    </motion.div>
  );
}
