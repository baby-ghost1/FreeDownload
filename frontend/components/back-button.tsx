import Link from 'next/link';
import type { Route } from 'next';
import { ArrowLeft } from 'lucide-react';

/** In-app back link - no need to reach for the browser button. */
export function BackButton({ href, label }: { href: Route; label: string }) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft
        className="size-4 transition-transform duration-200 group-hover:-translate-x-0.5"
        aria-hidden="true"
      />
      {label}
    </Link>
  );
}
