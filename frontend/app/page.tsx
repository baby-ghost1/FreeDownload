'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, FileDown, Link2, MousePointerClick, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button, buttonClasses } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/progress';
import { SITE_CONFIG } from '@/lib/constants/site';
import { getPublicConfig, getTargetFormats } from '@/lib/api/endpoints';
import type { PublicConfig, TargetFormat } from '@/lib/api/types';

const STEPS = [
  {
    icon: Link2,
    title: 'Paste your link',
    body: 'Drop any supported media URL — we analyze it and list the formats that are actually available.',
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

function price(cents: number, currency: string): string {
  const value = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(value);
}

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [formats, setFormats] = useState<TargetFormat[]>([]);

  useEffect(() => {
    void getPublicConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
    void getTargetFormats()
      .then((r) => setFormats(r.data))
      .catch(() => setFormats([]));
  }, []);

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    const value = url.trim();
    router.push(value ? `/download?url=${encodeURIComponent(value)}` : '/download');
  };

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto w-full max-w-3xl px-4 pb-14 pt-16 text-center sm:px-6 sm:pt-24">
          <Badge tone="default" className="mb-5">
            <ShieldCheck className="size-3.5" aria-hidden="true" />
            Signed links · no install · your links, deleted on schedule
          </Badge>
          <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            {SITE_CONFIG.tagline}
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-muted-foreground">
            {SITE_CONFIG.description}
          </p>

          <form onSubmit={start} className="mx-auto mt-8 flex max-w-xl gap-2">
            <Input
              aria-label="Paste a media link"
              placeholder="https://example.com/video"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              type="url"
              inputMode="url"
              className="h-12 flex-1"
              data-testid="hero-url"
            />
            <Button type="submit" size="lg" className="shrink-0" data-testid="hero-go">
              Get it
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </form>

          {formats.length > 0 && (
            <p className="mt-5 flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
              Supports:
              {formats.map((f) => (
                <Badge key={f.key} tone="muted">
                  {f.container.toUpperCase()}
                </Badge>
              ))}
            </p>
          )}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-border bg-surface-sunken/60">
        <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
          <h2 className="text-center text-2xl font-semibold tracking-tight">How it works</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <Card key={step.title}>
                <CardHeader>
                  <span className="mb-2 flex size-9 items-center justify-center rounded-md bg-primary/12 text-primary">
                    <step.icon className="size-5" aria-hidden="true" />
                  </span>
                  <CardTitle>
                    {i + 1}. {step.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">{step.body}</CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
          <h2 className="text-center text-2xl font-semibold tracking-tight">Pricing</h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Start free — upgrade when you need more volume.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {config === null
              ? Array.from({ length: 3 }, (_, i) => (
                  <Card key={i}>
                    <CardContent className="flex justify-center py-10">
                      <Spinner />
                    </CardContent>
                  </Card>
                ))
              : config.plans.map((plan) => {
                  const limits = plan.limits as { jobsPerDay?: number; maxFileSizeMb?: number };
                  const features = plan.features as { priorityQueue?: boolean } | undefined;
                  return (
                    <Card
                      key={plan.code}
                      className={plan.code === 'pro' ? 'border-primary/60 shadow-3' : ''}
                      data-testid={`plan-${plan.code}`}
                    >
                      <CardHeader>
                        <CardTitle>{plan.name}</CardTitle>
                        <p className="text-2xl font-semibold text-foreground">
                          {price(plan.priceCents, plan.currency)}
                          <span className="text-sm font-normal text-muted-foreground">
                            /{plan.interval}
                          </span>
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm text-muted-foreground">
                        {limits.jobsPerDay !== undefined && (
                          <p>{limits.jobsPerDay} downloads/day</p>
                        )}
                        {limits.maxFileSizeMb !== undefined && (
                          <p>Up to {limits.maxFileSizeMb} MB per file</p>
                        )}
                        <p>
                          {features?.priorityQueue ? 'Priority processing' : 'Standard processing'}
                        </p>
                        <Link
                          href={plan.code === 'free' ? '/register' : '/register'}
                          className={`${buttonClasses({ variant: plan.code === 'free' ? 'outline' : 'primary', size: 'sm' })} mt-3 w-full`}
                          data-testid={`plan-cta-${plan.code}`}
                        >
                          {plan.code === 'free' ? 'Start free' : `Choose ${plan.name}`}
                        </Link>
                      </CardContent>
                    </Card>
                  );
                })}
          </div>
        </div>
      </section>
    </div>
  );
}
