'use client';

import { AnimatePresence, motion } from 'motion/react';
import { BadgeCheck, QrCode, Tag, X } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import {
  createUpgradeRequest,
  previewUpgradeRequest,
  type PreviewUpgrade,
} from '@/lib/api/endpoints';
import type { PlanInfo } from '@/lib/api/types';
import { formatINR } from '@/lib/format';
import { DONATE_QR_SRC } from '@/components/donate-coffee';

function amountText(cents: number): string {
  return formatINR(cents);
}

/**
 * Manual UPI upgrade: shows the payable amount (coupon-aware), the payment
 * QR, then files an upgrade request the admin verifies in the console.
 */
export function UpgradeModal({
  plan,
  onClose,
  onRequested,
}: {
  plan: PlanInfo;
  onClose: () => void;
  onRequested: () => void;
}) {
  const [coupon, setCoupon] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState('');
  const [preview, setPreview] = useState<PreviewUpgrade | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const applyCoupon = async () => {
    setPreviewBusy(true);
    setError(null);
    try {
      const p = await previewUpgradeRequest({
        planCode: plan.code as 'pro' | 'business',
        ...(coupon.trim() ? { couponCode: coupon.trim() } : {}),
      });
      setPreview(p);
      setAppliedCoupon(coupon.trim());
    } catch (err) {
      setPreview(null);
      setAppliedCoupon('');
      setError(err instanceof ApiError ? err.message : 'Could not apply that coupon.');
    } finally {
      setPreviewBusy(false);
    }
  };

  const amount = preview?.amountCents ?? plan.priceCents;

  const requestUpgrade = async () => {
    setRequestBusy(true);
    setError(null);
    try {
      await createUpgradeRequest({
        planCode: plan.code as 'pro' | 'business',
        ...(appliedCoupon ? { couponCode: appliedCoupon } : {}),
      });
      onRequested();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not file the request.');
    } finally {
      setRequestBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Upgrade to ${plan.name}`}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-background/60 p-4 backdrop-blur-md"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface shadow-3"
      >
        <div
          aria-hidden="true"
          className="neon-edge h-1 bg-gradient-to-r from-primary via-info to-primary bg-[length:220%_100%] animate-gradient-pan"
        />
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight" data-testid="upgrade-title">
                Upgrade to {plan.name}
              </h2>
              <p className="mt-0.5 text-2xl font-bold tabular-nums" data-testid="upgrade-amount">
                {amountText(amount)}
                <span className="text-sm font-normal text-muted-foreground">/{plan.interval}</span>
              </p>
              {preview?.couponApplied && (
                <p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-success">
                  <BadgeCheck className="size-3.5" />
                  Coupon applied - {preview.percentOff}% off
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="mt-4">
            <Label htmlFor="upgrade-coupon">Coupon code (optional)</Label>
            <div className="mt-1.5 flex gap-2">
              <div className="relative flex-1">
                <Tag className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="upgrade-coupon"
                  placeholder="e.g. LAUNCH20"
                  value={coupon}
                  onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                  data-testid="upgrade-coupon"
                  className="h-10 rounded-xl pl-9 uppercase"
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                loading={previewBusy}
                onClick={() => void applyCoupon()}
                data-testid="upgrade-coupon-apply"
                className="h-10 rounded-xl"
              >
                Apply
              </Button>
            </div>
          </div>

          {error && (
            <Alert tone="error" className="mt-3">
              {error}
            </Alert>
          )}

          <div className="mt-4 rounded-2xl border border-border bg-background p-4 text-center">
            <p className="flex items-center justify-center gap-1.5 text-sm font-semibold">
              <QrCode className="size-4 text-primary" />
              Scan and pay exactly {amountText(amount)}
            </p>
            <div className="mt-3 flex justify-center">
              {DONATE_QR_SRC ? (
                <Image
                  src={DONATE_QR_SRC}
                  alt="UPI payment QR code"
                  width={168}
                  height={168}
                  className="rounded-lg bg-white p-3"
                  data-testid="upgrade-qr"
                />
              ) : (
                <p className="text-xs text-muted-foreground">Payment QR is not configured yet.</p>
              )}
            </div>
            <ol className="mx-auto mt-3 max-w-xs space-y-1 text-left text-xs text-muted-foreground">
              <li>1. Pay the exact amount above with any UPI app.</li>
              <li>2. Press “I have paid” below.</li>
              <li>3. An admin verifies the payment and activates {plan.name}.</li>
            </ol>
          </div>

          <Button
            loading={requestBusy}
            onClick={() => void requestUpgrade()}
            data-testid="upgrade-request"
            className="mt-4 h-11 w-full rounded-xl font-semibold"
          >
            I have paid - request upgrade
          </Button>
          <AnimatePresence mode="wait">
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              No money moves here - you pay in your own UPI app.
            </p>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}
