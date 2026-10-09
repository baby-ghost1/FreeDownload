import type { Metadata } from 'next';
import { Cookie, Database, Mail, ShieldCheck, Timer, UserRound } from 'lucide-react';

import { Enter, Stagger, StaggerItem } from '@/components/motion/reveal';
import { SoftBackdrop } from '@/components/soft-backdrop';
import { BackButton } from '@/components/back-button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SITE_CONFIG } from '@/lib/constants/site';

export const metadata: Metadata = {
  title: 'Privacy',
  description: `How ${SITE_CONFIG.name} handles your data.`,
};

const SECTIONS = [
  {
    icon: Database,
    title: 'What we process',
    body: (
      <p>
        When you submit a link, we extract metadata (title, formats) and retrieve the media file in
        order to deliver it to you in the format you chose. We store a redacted copy of the link
        plus a hash for abuse prevention; the raw link is discarded when your download expires.
      </p>
    ),
  },
  {
    icon: Timer,
    title: 'Retention',
    body: (
      <p>
        Processed files are kept for a limited window ({SITE_CONFIG.name} uses a short, documented
        retention period), then deleted from storage along with their metadata. Derived analytics
        are aggregated and cannot identify you.
      </p>
    ),
  },
  {
    icon: UserRound,
    title: 'Accounts',
    body: (
      <p>
        If you create an account we store your email address and display name. You can request
        deletion at any time from your account settings. We never sell your data.
      </p>
    ),
  },
  {
    icon: Cookie,
    title: 'Cookies',
    body: (
      <p>
        We use strictly necessary cookies for sign-in sessions and abuse prevention. No third-party
        advertising cookies are set by this application.
      </p>
    ),
  },
  {
    icon: Mail,
    title: 'Contact',
    body: <p>Questions about this policy? Open an issue on the project repository.</p>,
  },
];

export default function PrivacyPage() {
  return (
    <div className="relative mx-auto w-full max-w-2xl px-4 pb-12 pt-10 sm:px-6 sm:pt-12">
      <SoftBackdrop />
      <div className="relative mb-5">
        <BackButton href="/" label="Back to home" />
      </div>
      <Enter className="relative text-center">
        <Badge tone="default" className="glass mb-4 shadow-2">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Your data, respected
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Privacy Policy</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          How {SITE_CONFIG.name} handles your data - in plain words, no legal maze.
        </p>
      </Enter>

      <Stagger className="relative mt-8">
        <StaggerItem>
          <Card className="overflow-hidden">
            <div
              aria-hidden="true"
              className="neon-edge bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
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
