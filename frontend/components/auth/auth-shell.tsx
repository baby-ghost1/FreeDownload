import Link from 'next/link';
import type { Route } from 'next';

import { Enter } from '@/components/motion/reveal';
import { SoftBackdrop } from '@/components/soft-backdrop';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SITE_CONFIG } from '@/lib/constants/site';

export function AuthShell({
  title,
  description,
  children,
  footer,
  testId,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="relative mx-auto flex w-full max-w-md flex-col justify-center px-4 pb-14 pt-20 sm:px-6 sm:pt-24">
      <SoftBackdrop />
      <Enter className="relative">
        <Link
          href="/"
          className="group mx-auto mb-6 flex w-fit items-center gap-2"
          aria-label={`${SITE_CONFIG.name} home`}
        >
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-info text-base font-bold text-primary-foreground shadow-2 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6"
          >
            F
          </span>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            {SITE_CONFIG.name}
          </span>
        </Link>
        <Card className="overflow-hidden" data-testid={testId}>
          <div
            aria-hidden="true"
            className="h-1 bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
          />
          <CardHeader>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent>{children}</CardContent>
        </Card>
        {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
      </Enter>
    </div>
  );
}

export function AuthLink({ href, children }: { href: Route; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="link-underline text-sm text-primary underline-offset-2"
    >
      {children}
    </Link>
  );
}
