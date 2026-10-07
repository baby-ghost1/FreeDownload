'use client';

import { AnimatePresence, motion } from 'motion/react';
import { HeartHandshake, X } from 'lucide-react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils/cn';

/** Payment QR image served from `frontend/public`. */
export const DONATE_QR_SRC: string | null = '/donate-qr.png';

/** Deterministic dummy QR-lookalike (NOT scannable) for layout review. */
function DummyQr({ size = 168 }: { size?: number }) {
  const cells: boolean[] = [];
  let seed = 42;
  for (let i = 0; i < 21 * 21; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    cells.push(seed % 100 < 44);
  }
  const inFinder = (x: number, y: number) =>
    (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
  const cell = 100 / 21;
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="Placeholder donation QR (coming soon)"
      className="rounded-xl bg-white p-2"
    >
      {cells.map((on, i) => {
        const x = i % 21;
        const y = Math.floor(i / 21);
        if (inFinder(x, y)) return null;
        if (!on) return null;
        return <rect key={i} x={x * cell} y={y * cell} width={cell} height={cell} fill="#111" />;
      })}
      {(
        [
          [0, 0],
          [14, 0],
          [0, 14],
        ] as Array<[number, number]>
      ).map(([fx, fy]) => (
        <g key={`${fx}-${fy}`}>
          <rect x={fx * cell} y={fy * cell} width={7 * cell} height={7 * cell} fill="#111" />
          <rect
            x={(fx + 1) * cell}
            y={(fy + 1) * cell}
            width={5 * cell}
            height={5 * cell}
            fill="#fff"
          />
          <rect
            x={(fx + 2) * cell}
            y={(fy + 2) * cell}
            width={3 * cell}
            height={3 * cell}
            fill="#111"
          />
        </g>
      ))}
    </svg>
  );
}

function DonateMessage() {
  return (
    <div className="space-y-3 text-left">
      <p className="text-sm leading-relaxed text-foreground">
        FreeDownload is free because people help - enjoying it? Tap the Help Us
        button to support us.
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">
        FreeDownload muft hai kyunki log madad karte hain - achha laga to Help Us
        button dabakar support karo.
      </p>
    </div>
  );
}

export function DonateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          className="fixed inset-0 z-[70] flex items-center justify-center bg-background/60 p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
          aria-label="Support FreeDownload"
        >
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-surface shadow-3"
          >
            <div
              aria-hidden="true"
              className="h-1 bg-gradient-to-r from-orange-500 via-amber-500 to-orange-500 bg-[length:220%_100%] animate-gradient-pan"
            />
            <div className="p-5">
              <div className="flex items-start justify-between gap-3">
                <p className="flex items-center gap-2 text-base font-semibold tracking-tight">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-2">
                    <HeartHandshake className="size-4" aria-hidden="true" />
                  </span>
                  Help Us
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              <div className="mt-4 flex justify-center">
                {DONATE_QR_SRC ? (
                  <Image
                    src={DONATE_QR_SRC}
                    alt="Donation QR code"
                    width={577}
                    height={564}
                    className="h-auto w-[200px] shrink-0 rounded-xl bg-white object-contain p-4"
                  />
                ) : (
                  <DummyQr />
                )}
              </div>
              <div className="mt-4">
                <DonateMessage />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DonateCoffeeButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        title="Help Us"
        className={cn(
          'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1.5 text-[13px] font-semibold text-orange-600 transition-all duration-200 hover:bg-orange-500/20 active:scale-95 dark:text-orange-400',
          className,
        )}
      >
        <HeartHandshake className="size-4" aria-hidden="true" />
        Help Us
      </button>
      <DonateModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Floating coffee button on every page except home (navbar has it) and admin. */
export function DonateCoffeeFloat() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  if (pathname === '/' || pathname.startsWith('/admin')) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Help Us"
        title="Help Us"
        className="fixed bottom-4 right-4 z-50 flex size-11 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-3 transition-transform duration-200 hover:scale-105 active:scale-95"
      >
        <HeartHandshake className="size-5" aria-hidden="true" />
      </button>
      <DonateModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
