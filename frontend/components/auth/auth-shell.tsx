import Link from 'next/link';
import type { Route } from 'next';
import { Check } from 'lucide-react';

import { Enter } from '@/components/motion/reveal';
import { BrandMark } from '@/components/brand-icons';
import { SoftBackdrop } from '@/components/soft-backdrop';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SITE_CONFIG } from '@/lib/constants/site';

export function AuthShell({
  title,
  description,
  children,
  footer,
  testId,
  perks,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testId?: string;
  /** Honest "why sign up" checklist shown above the form. */
  perks?: string[];
}) {
  return (
    <div className="relative mx-auto flex w-full max-w-md flex-col justify-center px-4 pb-14 pt-10 sm:px-6 sm:pt-12">
      <SoftBackdrop />
      <Enter className="relative">
        <Link
          href="/"
          className="group mx-auto mb-6 flex w-fit items-center gap-2"
          aria-label={`${SITE_CONFIG.name} home`}
        >
          <BrandMark
            size={36}
            className="transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6"
          />
          <span className="text-lg font-semibold tracking-tight text-foreground">
            {SITE_CONFIG.name}
          </span>
        </Link>
        <Card className="overflow-hidden" data-testid={testId}>
          <div
            aria-hidden="true"
            className="neon-edge bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
          />
          <CardHeader>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>
            {perks && perks.length > 0 && (
              <ul className="mb-5 space-y-2 rounded-xl border border-border bg-surface-sunken/60 p-3.5">
                {perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-sm text-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    {perk}
                  </li>
                ))}
              </ul>
            )}
            {children}
          </CardContent>
        </Card>
        {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
      </Enter>
    </div>
  );
}

export function AuthLink({ href, children }: { href: Route; children: React.ReactNode }) {
  return (
    <Link href={href} className="link-underline text-sm text-primary underline-offset-2">
      {children}
    </Link>
  );
}
