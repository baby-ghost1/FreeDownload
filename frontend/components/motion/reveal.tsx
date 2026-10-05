'use client';

import { motion, useReducedMotion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

/** Shared easing - snappy but soft, matches --ease-out token. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: (delay: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [...EASE_OUT], delay },
  }),
};

export const staggerParent: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 20, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.55, ease: [...EASE_OUT] },
  },
};

function useMaybeReduced<T extends Record<string, unknown>>(full: T, fallback: T): T {
  const reduce = useReducedMotion();
  return reduce ? fallback : full;
}

/** Fade-and-rise on first scroll into view. Wraps any block. */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 24,
  once = true,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  once?: boolean;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '-64px' }}
      transition={{ duration: 0.6, ease: [...EASE_OUT], delay }}
    >
      {children}
    </motion.div>
  );
}

/** Staggered entrance for grids / lists. */
export function Stagger({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={staggerParent}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-48px' }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={cn(className)} variants={staggerChild}>
      {children}
    </motion.div>
  );
}

/** Entrance used for above-the-fold hero elements (plays on mount). */
export function Enter({
  children,
  className,
  delay = 0,
  y = 18,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  y?: number;
}) {
  const initial = useMaybeReduced({ opacity: 0, y }, { opacity: 0 });
  const animate = useMaybeReduced({ opacity: 1, y: 0 }, { opacity: 1 });
  return (
    <motion.div
      className={className}
      initial={initial}
      animate={animate}
      transition={{ duration: 0.65, ease: [...EASE_OUT], delay }}
    >
      {children}
    </motion.div>
  );
}
