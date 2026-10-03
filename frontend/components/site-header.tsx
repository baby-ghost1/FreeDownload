'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { Spinner } from '@/components/ui/progress';
import { useSession } from '@/lib/session';

export function SiteHeader() {
  const { user, loading, signOut } = useSession();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 font-semibold tracking-tight text-foreground"
        >
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
          >
            F
          </span>
          <span className="hidden sm:inline">FreeDownload</span>
        </Link>

        <nav className="ml-2 hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          <Link href="/#how-it-works" className="transition-colors hover:text-foreground">
            How it works
          </Link>
          <Link href="/#pricing" className="transition-colors hover:text-foreground">
            Pricing
          </Link>
          <Link href="/downloads" className="transition-colors hover:text-foreground">
            My downloads
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {loading ? (
            <Spinner className="size-4" />
          ) : user ? (
            <>
              <span
                className="hidden max-w-40 truncate text-sm text-muted-foreground sm:inline"
                data-testid="session-email"
              >
                {user.displayName ?? user.email}
              </span>
              <Button
                variant="ghost"
                size="sm"
                data-testid="sign-out"
                onClick={() => {
                  void signOut().then(() => router.refresh());
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/login')}
                data-testid="sign-in"
              >
                Sign in
              </Button>
              <Button size="sm" onClick={() => router.push('/register')} data-testid="sign-up">
                Sign up
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
