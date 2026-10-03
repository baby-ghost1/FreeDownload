import type { Metadata } from 'next';

import { SITE_CONFIG } from '@/lib/constants/site';

export const metadata: Metadata = {
  title: 'Privacy',
  description: `How ${SITE_CONFIG.name} handles your data.`,
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
      <div className="prose-sm mt-6 space-y-5 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">What we process</h2>
          <p>
            When you submit a link, we extract metadata (title, formats) and retrieve the media file
            in order to deliver it to you in the format you chose. We store a redacted copy of the
            link plus a hash for abuse prevention; the raw link is discarded when your download
            expires.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">Retention</h2>
          <p>
            Processed files are kept for a limited window ({SITE_CONFIG.name} uses a short,
            documented retention period), then deleted from storage along with their metadata.
            Derived analytics are aggregated and cannot identify you.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">Accounts</h2>
          <p>
            If you create an account we store your email address and display name. You can request
            deletion at any time from your account settings. We never sell your data.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">Cookies</h2>
          <p>
            We use strictly necessary cookies for sign-in sessions and abuse prevention. No
            third-party advertising cookies are set by this application.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">Contact</h2>
          <p>Questions about this policy? Open an issue on the project repository.</p>
        </section>
      </div>
    </div>
  );
}
