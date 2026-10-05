import { Spinner } from '@/components/ui/progress';

/** Route skeleton - shown while a page streams in. */
export default function Loading() {
  return (
    <div
      className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6"
      role="status"
      aria-label="Loading page"
    >
      <div className="shimmer-line h-8 w-56 rounded-lg border border-border bg-surface" />
      <div className="shimmer-line mt-2 h-4 w-80 max-w-full rounded-md border border-border bg-surface" />
      <div className="shimmer-line mt-8 h-44 rounded-2xl border border-border bg-surface" />
      <div className="mt-6 flex justify-center">
        <Spinner className="size-6" />
      </div>
    </div>
  );
}
