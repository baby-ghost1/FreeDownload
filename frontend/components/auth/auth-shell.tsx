import Link from 'next/link';
import type { Route } from 'next';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

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
    <div className="mx-auto flex w-full max-w-md flex-col justify-center px-4 py-14 sm:px-6">
      <Card data-testid={testId}>
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
      {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
    </div>
  );
}

export function AuthLink({ href, children }: { href: Route; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm text-primary underline underline-offset-2">
      {children}
    </Link>
  );
}
