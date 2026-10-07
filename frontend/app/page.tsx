'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  AudioLines,
  ChevronRight,
  FileDown,
  Link2,
  MousePointerClick,
  ShieldCheck,
  Timer,
  Zap,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AdSlot } from '@/components/ad-slot';
import { BrandLogo } from '@/components/brand-icons';
import { ClipboardToggle } from '@/components/clipboard-toggle';
import { Enter, Reveal, Stagger, StaggerItem } from '@/components/motion/reveal';
import { getPublicConfig } from '@/lib/api/endpoints';
import { PLATFORM_PILLS } from '@/lib/platform';
import type { PublicConfig } from '@/lib/api/types';
import { cn } from '@/lib/utils/cn';

const STEPS = [
  {
    icon: Link2,
    title: 'Paste your link',
    body: 'Drop any supported media URL - we analyze it and list the formats that are actually available.',
  },
  {
    icon: MousePointerClick,
    title: 'Pick a format',
    body: 'Video up to source quality, or audio-only in MP3/M4A. What you choose is what you get.',
  },
  {
    icon: FileDown,
    title: 'Download',
    body: 'Processing runs on our side; your file arrives through a short-lived signed link.',
  },
];

const TRUST = [
  { icon: Zap, label: 'No sign-up needed' },
  { icon: AudioLines, label: 'HD video + MP3 audio' },
  { icon: Timer, label: 'Links auto-expire' },
];

/* Mobile-first: single column on phones, 2-col from sm. Honest claims only. */
const FORMATS = [
  {
    icon: FileDown,
    title: 'Video up to source quality',
    body: 'Pick the resolution that suits you - what you choose is what you get.',
  },
  {
    icon: AudioLines,
    title: 'Audio-only MP3 / M4A',
    body: 'Just need the sound? Grab a lightweight audio file in one tap.',
  },
  {
    icon: Zap,
    title: 'No software to install',
    body: 'Everything runs in your browser. Paste, pick, download - done.',
  },
  {
    icon: ShieldCheck,
    title: 'Private by default',
    body: 'For media you own or have permission to download. Links expire automatically.',
  },
];

/* Honest, objection-handling answers. Native <details> = no JS, big touch targets. */
const FAQS = [
  {
    q: 'Do I need an account?',
    a: 'No. Paste a link and download as a guest. An account just keeps your history across devices plus higher limits and API keys.',
  },
  {
    q: 'Which links work?',
    a: 'Links from your favourite platforms - paste one and we list the formats that are actually available for it.',
  },
  {
    q: 'What quality will I get?',
    a: 'Up to the source quality. Choose video resolution yourself, or take audio-only MP3/M4A when you only need sound.',
  },
  {
    q: 'How long do download links last?',
    a: 'Files arrive through short-lived signed links that expire automatically - download promptly once your file is ready.',
  },
  {
    q: 'What may I download?',
    a: 'Only media you own or have permission to download. Sources that restrict downloads stay restricted.',
  },
];

/* Faded brand glyphs that drift gently behind the hero. Deliberately faint -
 * decoration only, never competing with the content in front. */
const FLOATERS = [
  {
    key: 'yt',
    id: 'youtube',
    className: 'left-[13%] top-[24%]',
    size: 52,
    duration: 7,
    delay: 0,
  },
  {
    key: 'ig',
    id: 'instagram',
    className: 'right-[12%] top-[20%]',
    size: 44,
    duration: 8.5,
    delay: 1.2,
  },
  {
    key: 'x',
    id: 'x',
    className: 'left-[17%] bottom-[18%]',
    size: 34,
    duration: 6.5,
    delay: 0.6,
  },
  {
    key: 'fb',
    id: 'facebook',
    className: 'right-[16%] bottom-[24%]',
    size: 48,
    duration: 7.6,
    delay: 1.8,
  },
];

function FloatingBrands() {
  const reduce = useReducedMotion();
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {FLOATERS.map((f) => (
        <span
          key={f.key}
          className={cn(
            'absolute text-foreground opacity-[0.10] sm:opacity-[0.14] dark:opacity-[0.12] dark:sm:opacity-[0.16]',
            f.className,
          )}
        >
          <motion.span
            className="block"
            {...(reduce ? {} : { animate: { y: [0, -12, 0], rotate: [0, 2, 0] } })}
            transition={{
              duration: f.duration,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: f.delay,
            }}
          >
            <BrandLogo id={f.id} size={f.size} />
          </motion.span>
        </span>
      ))}
    </div>
  );
}

/** Infinite "works with" marquee - two identical halves for a seamless loop. */
function PlatformStrip() {
  return (
    <section aria-label="Supported platforms" className="relative overflow-hidden py-9">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <Reveal>
          <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Paste links from your favourite platforms
          </p>
        </Reveal>
        <div aria-hidden="true" className="mask-fade-x mt-5 overflow-hidden">
          <div className="animate-marquee flex w-max">
            {[0, 1].map((half) => (
              <div key={half} className="flex shrink-0 items-center gap-2.5 pr-2.5">
                {PLATFORM_PILLS.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-4 py-1.5 text-sm text-muted-foreground shadow-1"
                  >
                    <BrandLogo id={p.id} size={15} style={{ color: p.accent }} />
                    {p.label}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Long links overflow the field - always show the START of the link
  // (domain + path) instead of the tail.
  const scrollToStart = () => {
    requestAnimationFrame(() => {
      if (inputRef.current) inputRef.current.scrollLeft = 0;
    });
  };

  // Programmatic pastes (paste button) don't move the caret, so the field
  // keeps whatever scroll it had - force it back to the start.
  useEffect(() => {
    if (document.activeElement !== inputRef.current && inputRef.current) {
      inputRef.current.scrollLeft = 0;
    }
  }, [url]);

  useEffect(() => {
    void getPublicConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  const [going, setGoing] = useState(false);
  // FAQ accordion: one open at a time, same question toggles shut.
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const start = (e: React.FormEvent) => {
    e.preventDefault();
    setGoing(true);
    const value = url.trim();
    router.push(value ? `/download?url=${encodeURIComponent(value)}` : '/download');
  };

  return (
    <div>
      {/* Hero - pulled up behind the in-flow navbar so its own wash
          covers logo/menu too (no separate navbar bg). Content stays put
          via matching top padding. */}
      <section className="relative -mt-14 overflow-hidden pt-14">
        {/* Soft, smooth backdrop - no grid, just a gentle wash of colour */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent_70%)]" />
          <div className="animate-drift-a absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-[70%] rounded-full bg-primary/10 blur-3xl" />
          <div className="animate-drift-b absolute -top-24 left-1/2 h-80 w-[36rem] -translate-x-[20%] rounded-full bg-info/10 blur-3xl" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
        </div>
        <FloatingBrands />

        <div className="relative mx-auto w-full max-w-3xl px-4 pb-10 pt-6 text-center sm:px-6 sm:pb-14 sm:pt-10">
          <Enter delay={0.08}>
            <h1 className="text-[1.9rem] font-semibold leading-[1.12] tracking-tight text-foreground sm:text-6xl sm:leading-[1.05]">
              Download media.
              <br />
              <span className="text-gradient animate-gradient-pan bg-[length:220%_220%]">
                Fast. Simple. Yours.
              </span>
            </h1>
          </Enter>

          <Enter delay={0.16}>
            <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
              Drop your link below - we&apos;ll show every format available.
              Pick one, and it&apos;s yours in seconds.
            </p>
          </Enter>

          <Enter delay={0.24}>
            <form onSubmit={start} className="mx-auto mt-8 max-w-xl">
              <div className="glass group flex gap-1.5 rounded-2xl border border-border bg-surface/80 p-2 shadow-3 transition-all duration-300 focus-within:border-primary/60 focus-within:shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_14%,transparent),var(--shadow-3)] hover:border-border-strong hover:shadow-3">
                <Input
                  ref={inputRef}
                  aria-label="Paste a media link"
                  placeholder="Paste a YouTube, TikTok or Instagram link…"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={scrollToStart}
                  onPaste={() => {
                    // Browser drops the caret at the end after paste (tail
                    // visible) - pull the view back to the start of the link.
                    setTimeout(scrollToStart, 0);
                  }}
                  type="url"
                  inputMode="url"
                  className={`h-12 flex-1 border-0 bg-transparent text-left shadow-none focus-visible:outline-none ${url.trim() ? 'mask-input-r' : ''}`}
                  data-testid="hero-url"
                />
                <ClipboardToggle
                  value={url}
                  onPaste={(v) => {
                    setUrl(v);
                    scrollToStart();
                  }}
                  onClear={() => setUrl('')}
                />
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}>
                  <Button
                    type="submit"
                    size="lg"
                    loading={going}
                    className="btn-shine h-12 shrink-0 px-3 text-sm shadow-2 sm:px-5 sm:text-base"
                    data-testid="hero-go"
                  >
                    {!going && (
                      <>
                        Download
                        <ArrowRight
                          className="size-4 transition-transform duration-300 group-focus-within:translate-x-0.5"
                          aria-hidden="true"
                        />
                      </>
                    )}
                  </Button>
                </motion.div>
              </div>
            </form>
          </Enter>

          <Enter delay={0.32}>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              {TRUST.map((t) => (
                <span key={t.label} className="inline-flex items-center gap-1.5">
                  <t.icon className="size-4 text-primary" aria-hidden="true" />
                  {t.label}
                </span>
              ))}
            </div>
          </Enter>
        </div>
      </section>

      <PlatformStrip />

      {/* How it works - flows straight from the hero, no divider line */}
      <section id="how-it-works" className="relative overflow-hidden bg-surface-sunken/60">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_50%_0%,color-mix(in_oklch,var(--primary)_6%,transparent),transparent_70%)]"
        />
        <div className="relative mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
          <Reveal>
            <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Three steps
            </p>
            <h2 className="mt-2 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
              How it works
            </h2>
            <p className="mx-auto mt-2 max-w-md text-center text-sm text-muted-foreground">
              From link to file in seconds - no accounts, no toolbars, no clutter.
            </p>
          </Reveal>
          <Stagger className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <StaggerItem key={step.title}>
                <Card className="hover-lift group relative h-full overflow-hidden">
                  <div
                    aria-hidden="true"
                    className="absolute inset-x-0 top-0 h-1 origin-left scale-x-0 bg-gradient-to-r from-primary to-info transition-transform duration-500 group-hover:scale-x-100"
                  />
                  <CardHeader>
                    <span className="mb-2 flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-info/15 text-primary ring-1 ring-primary/20 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                      <step.icon className="size-5" aria-hidden="true" />
                    </span>
                    <CardTitle>
                      <span className="mr-1.5 text-sm font-bold text-primary/70 tabular-nums">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      {step.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm leading-relaxed text-muted-foreground">
                    {step.body}
                  </CardContent>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* What you get - answers quality/safety objections, mobile stacks first */}
      <section aria-label="What you get" className="relative overflow-hidden">
        <div className="relative mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-14">
          <Reveal>
            <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Why FreeDownload
            </p>
            <h2 className="mt-2 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
              Made for quick, clean downloads
            </h2>
            <p className="mx-auto mt-2 max-w-md text-center text-sm text-muted-foreground">
              No toolbars, no installers - just the file you asked for.
            </p>
          </Reveal>
          <Stagger className="mt-8 grid gap-3 sm:grid-cols-2">
            {FORMATS.map((f) => (
              <StaggerItem key={f.title}>
                <Card className="flex h-full items-start gap-3 p-4 sm:p-5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-info/15 text-primary ring-1 ring-primary/20">
                    <f.icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground sm:text-base">
                      {f.title}
                    </span>
                    <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                      {f.body}
                    </span>
                  </span>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* FAQ - native details, full-width touch targets on mobile */}
      <section aria-label="Frequently asked questions" className="relative overflow-hidden bg-surface-sunken/60">
        <div className="relative mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-14">
          <Reveal>
            <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Questions
            </p>
            <h2 className="mt-2 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
              Before you paste
            </h2>
          </Reveal>
          <div className="mt-8 space-y-2.5">
            {FAQS.map((f, i) => {
              const open = openFaq === i;
              return (
                <Reveal key={f.q}>
                  <div
                    className={cn(
                      'rounded-xl border bg-surface px-4 py-1 shadow-1 transition-colors',
                      open ? 'border-primary/40' : 'border-border',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                      aria-controls={`faq-panel-${i}`}
                      className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 py-3 text-left text-sm font-semibold text-foreground"
                    >
                      {f.q}
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex size-7 shrink-0 items-center justify-center rounded-full border transition-all duration-300',
                          open
                            ? 'rotate-90 border-primary/40 text-primary'
                            : 'border-border text-muted-foreground',
                        )}
                      >
                        <ChevronRight className="size-4" aria-hidden="true" />
                      </span>
                    </button>
                    <AnimatePresence initial={false}>
                      {open && (
                        <motion.div
                          key="panel"
                          id={`faq-panel-${i}`}
                          role="region"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden"
                        >
                          <p className="pb-4 text-sm leading-relaxed text-muted-foreground">
                            {f.a}
                          </p>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Plans teaser - real data from public config only, no invented claims */}
      {config && config.plans.length > 0 && (
        <section aria-label="Plans" className="relative overflow-hidden">
          <div className="relative mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-14">
            <Reveal>
              <p className="text-center text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                Plans
              </p>
              <h2 className="mt-2 text-center text-2xl font-semibold tracking-tight sm:text-3xl">
                Free to start, Pro when you need more
              </h2>
              <p className="mx-auto mt-2 max-w-md text-center text-sm text-muted-foreground">
                Higher daily limits, more parallel downloads, bigger files.
              </p>
            </Reveal>
            <Stagger className="mx-auto mt-8 grid max-w-3xl grid-cols-3 items-stretch gap-1 divide-x divide-border/40 rounded-2xl border border-border/40 bg-surface/50 sm:gap-3 sm:divide-x-0 sm:rounded-none sm:border-transparent sm:bg-transparent">
              {config.plans.map((p) => {
                const paid = p.priceCents > 0;
                const popular =
                  paid &&
                  p.priceCents ===
                    Math.min(
                      ...config.plans.filter((q) => q.priceCents > 0).map((q) => q.priceCents),
                    );
                const price = `${new Intl.NumberFormat('en-US', {
                  style: 'currency',
                  currency: p.currency.toUpperCase(),
                  minimumFractionDigits: p.priceCents % 100 === 0 ? 0 : 2,
                }).format(p.priceCents / 100)}/${p.interval}`;
                return (
                  <StaggerItem key={p.code} className="h-full min-w-0">
                    <Card
                      className={cn(
                        'flex h-full flex-col border-transparent bg-transparent p-2 text-center shadow-none',
                        'sm:border-border sm:bg-surface sm:p-5 sm:shadow-2',
                        popular &&
                          'sm:relative sm:border-primary/50 sm:shadow-3 sm:ring-1 sm:ring-primary/30',
                      )}
                    >
                      {/* Mobile label line / desktop border badge */}
                      <p className="min-h-4 text-[10px] font-bold uppercase tracking-wider text-primary sm:hidden">
                        {popular ? 'Popular' : ' '}
                      </p>
                      {popular && (
                        <span className="absolute -top-3 left-1/2 hidden -translate-x-1/2 rounded-full bg-gradient-to-r from-primary to-info px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider whitespace-nowrap text-white shadow-2 sm:block">
                          Most popular
                        </span>
                      )}
                      <p className="truncate text-xs font-semibold text-foreground sm:text-sm">
                        {p.name}
                      </p>
                      <p className="mt-0.5 truncate text-lg font-bold tracking-tight text-foreground sm:mt-1 sm:text-3xl">
                        {price}
                      </p>
                      <p className="mt-1 hidden text-xs text-muted-foreground sm:block">
                        {paid ? `per ${p.interval}` : 'free forever'}
                      </p>
                      {/* Mobile text link / desktop button */}
                      <button
                        type="button"
                        onClick={() => router.push(paid ? '/register' : '/download')}
                        className="mx-auto mt-1 w-fit text-xs font-semibold text-primary underline-offset-4 active:underline sm:hidden"
                      >
                        {paid ? 'Get →' : 'Start →'}
                      </button>
                      <div className="mt-auto hidden pt-4 sm:block">
                        <Button
                          type="button"
                          variant={popular ? 'primary' : 'outline'}
                          size="sm"
                          onClick={() => router.push(paid ? '/register' : '/download')}
                          className={cn('w-full', popular && 'btn-shine')}
                        >
                          {paid ? `Get ${p.name}` : 'Start downloading'}
                        </Button>
                      </div>
                    </Card>
                  </StaggerItem>
                );
              })}
            </Stagger>
          </div>
        </section>
      )}

      {/* Ad slot - rendered only when the `ads` flag is on for this subject */}
      {config?.flags.ads === true && (
        <section>
          <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
            <AdSlot />
          </div>
        </section>
      )}
    </div>
  );
}
