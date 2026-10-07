import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

import { SITE_CONFIG } from '@/lib/constants/site';
import { ThemeToggle } from '@/components/theme-toggle';
import { buttonClasses } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

const PRODUCT_LINKS = [
  { href: '/download', label: 'New download' },
  { href: '/downloads', label: 'My downloads' },
] as const;

const LEGAL_LINKS = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
] as const;

export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="relative overflow-hidden border-t border-border bg-surface-sunken/60">
      {/* glow + hairline */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        <div className="absolute -bottom-40 left-1/2 h-72 w-[46rem] -translate-x-1/2 rounded-full bg-primary/[0.07] blur-3xl" />
      </div>

      <div className="relative mx-auto w-full max-w-5xl px-4 pt-16 sm:px-6 md:pt-20">
        <div className="grid gap-10 pb-10 md:grid-cols-[1.5fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <Link href="/" className="group inline-flex items-center gap-2.5">
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
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {SITE_CONFIG.tagline} No accounts, no clutter - just your media, in the format you
              need.
            </p>
            <Link
              href="/download"
              className={cn(buttonClasses({ size: 'sm' }), 'btn-shine mt-5')}
            >
              Start downloading
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>

          {/* Product */}
          <nav aria-label="Product">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Product
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {PRODUCT_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="link-underline text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link
                  href={{ pathname: '/', hash: 'how-it-works' }}
                  className="link-underline text-muted-foreground transition-colors hover:text-foreground"
                >
                  How it works
                </Link>
              </li>
            </ul>
          </nav>

          {/* Legal */}
          <nav aria-label="Legal">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Legal
            </p>
            <ul className="mt-4 space-y-2.5 text-sm">
              {LEGAL_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="link-underline text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between gap-4 border-t border-border/70 py-5 text-sm text-muted-foreground">
          <p>
            © {year} {SITE_CONFIG.name}
          </p>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs sm:inline">Looks better your way</span>
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Giant watermark */}
      <div
        aria-hidden="true"
        className="pointer-events-none relative select-none overflow-hidden"
      >
        <p className="-mb-[0.23em] bg-gradient-to-b from-foreground/[0.09] to-transparent bg-clip-text text-center text-[12.5vw] font-bold leading-none tracking-tighter whitespace-nowrap text-transparent sm:text-[11vw] md:text-[10.5rem]">
          {SITE_CONFIG.name}
        </p>
      </div>
    </footer>
  );
}
