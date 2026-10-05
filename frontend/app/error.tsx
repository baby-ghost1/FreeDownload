'use client';

import { useEffect } from 'react';
import { ArrowLeft, RotateCcw, TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Enter } from '@/components/motion/reveal';
import { SoftBackdrop } from '@/components/soft-backdrop';

/** Global safety net - a crash anywhere renders this instead of a blank page. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="relative mx-auto w-full max-w-md px-4 py-24 text-center sm:px-6">
      <SoftBackdrop />
      <Enter className="relative">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-destructive/25">
          <TriangleAlert className="size-6" aria-hidden="true" />
        </span>
        <p className="mt-5 text-5xl font-semibold tracking-tight text-gradient animate-gradient-pan bg-[length:220%_220%]">
          Oops
        </p>
        <h1 className="mt-3 text-xl font-semibold text-foreground">Something broke on our side</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
          Give it another shot - if it keeps happening, come back in a bit and try again.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={() => reset()} className="btn-shine">
            <RotateCcw className="size-4" aria-hidden="true" />
            Try again
          </Button>
          <Button
            variant="outline"
            onClick={() => window.location.assign('/')}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to home
          </Button>
        </div>
      </Enter>
    </div>
  );
}
