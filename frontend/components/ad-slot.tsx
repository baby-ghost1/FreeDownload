/**
 * Flag-gated ad placeholder (Phase 7). The `ads` feature flag decides whether
 * this renders at all — no third-party script ships until a network is
 * actually wired in, so the slot is a static placeholder today.
 */
export function AdSlot() {
  return (
    <div
      data-testid="ad-slot"
      role="complementary"
      aria-label="Advertisement"
      className="flex min-h-24 w-full items-center justify-center rounded-md border border-dashed border-border bg-surface-sunken/40 px-4 py-6 text-center text-xs uppercase tracking-widest text-muted-foreground"
    >
      Advertisement
    </div>
  );
}
