import { Spinner } from '@/components/ui/progress';

/** Route loading - a single centered spinner while the page streams in. */
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="size-8" />
    </div>
  );
}
