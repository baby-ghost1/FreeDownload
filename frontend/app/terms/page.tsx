import type { Metadata } from 'next';
import { Activity, BadgeCheck, FileText, Lock, Scale } from 'lucide-react';

import { Enter, Stagger, StaggerItem } from '@/components/motion/reveal';
import { SoftBackdrop } from '@/components/soft-backdrop';
import { BackButton } from '@/components/back-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SITE_CONFIG } from '@/lib/constants/site';

export const metadata: Metadata = {
  title: 'Terms',
  description: `Terms of use for ${SITE_CONFIG.name}.`,
};

const SECTIONS = [
  {
    icon: BadgeCheck,
    title: 'Permitted use',
    body: (
      <p>
        {SITE_CONFIG.name} is a tool for downloading media you are authorized to access. You are
        responsible for ensuring your use complies with the terms of the source site and applicable
        law, including copyright.
      </p>
    ),
  },
  {
    icon: Lock,
    title: 'No circumvention',
    body: (
      <p>
        The service must not be used to bypass DRM, paywalls, access controls, or other technical
        protection measures. Links that violate source policies are blocked by the platform.
      </p>
    ),
  },
  {
    icon: Activity,
    title: 'Availability',
    body: (
      <p>
        The service is provided &quot;as is&quot;. Sources change frequently; downloads may fail or
        be restricted by policy. We may limit rates and sizes to keep the service fair and
        operational.
      </p>
    ),
  },
  {
    icon: FileText,
    title: 'Changes',
    body: (
      <p>
        We may update these terms; the current version always lives on this page. Continued use
        after a change constitutes acceptance.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <div className="relative mx-auto w-full max-w-2xl px-4 pb-12 pt-10 sm:px-6 sm:pt-12">
      <SoftBackdrop />
      <div className="relative mb-5">
        <BackButton href="/" label="Back to home" />
      </div>
      <Enter className="relative text-center">
        <Badge tone="default" className="glass mb-4 shadow-2">
          <Scale className="size-3.5" aria-hidden="true" />
          Fair and simple
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Terms of Use</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          The short version of the rules - yours to keep, ours to enforce fairly.
        </p>
      </Enter>

      <Stagger className="relative mt-8">
        <StaggerItem>
          <Card className="overflow-hidden">
            <div
              aria-hidden="true"
              className="h-1 bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
            />
            <CardContent className="p-0">
              {SECTIONS.map((s, i) => (
                <section
                  key={s.title}
                  className={`flex gap-4 p-5 transition-colors duration-200 hover:bg-primary/[0.03] ${i > 0 ? 'border-t border-border/70' : ''}`}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-info/15 text-primary ring-1 ring-primary/20"
                  >
                    <s.icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-foreground">{s.title}</h2>
                    <div className="mt-1 text-sm leading-relaxed text-muted-foreground">
                      {s.body}
                    </div>
                  </div>
                </section>
              ))}
            </CardContent>
          </Card>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
