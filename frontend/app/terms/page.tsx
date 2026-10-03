import type { Metadata } from 'next';

import { SITE_CONFIG } from '@/lib/constants/site';

export const metadata: Metadata = {
  title: 'Terms',
  description: `Terms of use for ${SITE_CONFIG.name}.`,
};

export default function TermsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Terms of Use</h1>
      <div className="mt-6 space-y-5 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">Permitted use</h2>
          <p>
            {SITE_CONFIG.name} is a tool for downloading media you are authorized to access. You are
            responsible for ensuring your use complies with the terms of the source site and
            applicable law, including copyright.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">No circumvention</h2>
          <p>
            The service must not be used to bypass DRM, paywalls, access controls, or other
            technical protection measures. Links that violate source policies are blocked by the
            platform.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">Availability</h2>
          <p>
            The service is provided &quot;as is&quot;. Sources change frequently; downloads may fail
            or be restricted by policy. We may limit rates and sizes to keep the service fair and
            operational.
          </p>
        </section>
        <section>
          <h2 className="mb-1.5 text-base font-semibold text-foreground">Changes</h2>
          <p>
            We may update these terms; the current version always lives on this page. Continued use
            after a change constitutes acceptance.
          </p>
        </section>
      </div>
    </div>
  );
}
