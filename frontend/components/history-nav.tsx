'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

import { canForward, cameForward, clearForwardLatch, markWentBack } from '@/lib/history-nav';
import { cn } from '@/lib/utils/cn';

/** Generic history nav - never a hardcoded destination. Back shows only when
 *  we advanced here from another page, Next only when we went back here. */
export function HistoryNav({ className }: { className?: string }) {
  const router = useRouter();
  const [back, setBack] = useState(false);
  const [next, setNext] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot latch read: matches SSR until the real flags are known
    setBack(cameForward());
    setNext(canForward());
  }, []);
  if (!back && !next) return null;
  return (
    <div className={cn('flex items-center justify-between gap-2', className)}>
      {back ? (
        <button
          type="button"
          onClick={() => {
            markWentBack();
            router.back();
          }}
          className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft
            className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5"
            aria-hidden="true"
          />
          Back
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      {next && (
        <button
          type="button"
          onClick={() => {
            clearForwardLatch();
            router.forward();
          }}
          className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Next
          <ArrowRight
            className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
}
