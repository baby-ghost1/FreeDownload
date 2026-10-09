import Link from 'next/link';
import { Compass, House } from 'lucide-react';

import { buttonClasses } from '@/components/ui/button';
import { Enter } from '@/components/motion/reveal';
import { SoftBackdrop } from '@/components/soft-backdrop';
import { cn } from '@/lib/utils/cn';

export default function NotFound() {
  return (
    <div className="relative mx-auto flex w-full max-w-md flex-col items-center px-4 py-24 text-center sm:px-6">
      <SoftBackdrop />
      <Enter className="relative">
        <p
          aria-hidden="true"
          className="animate-float-slow bg-gradient-to-br from-primary via-info to-primary bg-[length:220%_220%] bg-clip-text text-8xl font-bold tracking-tighter text-transparent sm:text-9xl"
        >
          404
        </p>
        <h1 className="mt-4 text-xl font-semibold text-foreground">Page not found</h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has wandered off. Let&apos;s get
          you back on track.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link href="/" className={cn(buttonClasses({ size: 'md' }), 'btn-shine')}>
            <House className="size-4" aria-hidden="true" />
            Back to home
          </Link>
          <Link href="/download" className={cn(buttonClasses({ variant: 'outline', size: 'md' }))}>
            <Compass className="size-4" aria-hidden="true" />
            Start a download
          </Link>
        </div>
      </Enter>
    </div>
  );
}
