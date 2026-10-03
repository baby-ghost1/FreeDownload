import { AppError } from '../errors/app-error.js';
import { logger } from '../logging/logger.js';
import { config } from '../server/config.js';

/**
 * Payment provider abstraction (Phase 7).
 *
 * `none` (dev/test/default) fails loudly with 503 instead of pretending a
 * checkout happened; `stripe` is a thin REST client — no SDK dependency.
 */
export interface CheckoutInput {
  userId: string;
  planCode: string;
  planName: string;
  priceCents: number;
  currency: string;
  interval: 'month' | 'year';
}

export interface CheckoutSession {
  url: string;
  providerRef: string;
}

export interface PaymentProvider {
  readonly name: 'none' | 'stripe';
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
}

export const nullProvider: PaymentProvider = {
  name: 'none',
  createCheckout(): Promise<CheckoutSession> {
    return Promise.reject(
      new AppError('SERVICE_UNAVAILABLE', 'Billing is not configured.', {
        details: { provider: 'none' },
      }),
    );
  },
};

/** application/x-www-form-urlencoded body for POST /v1/checkout/sessions. */
function checkoutForm(input: CheckoutInput): URLSearchParams {
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('success_url', config.payment.successUrl);
  form.set('cancel_url', config.payment.cancelUrl);
  form.set('client_reference_id', input.userId);
  form.set('metadata[userId]', input.userId);
  form.set('metadata[planCode]', input.planCode);
  form.set('line_items[0][quantity]', '1');
  form.set('line_items[0][price_data][currency]', input.currency);
  form.set('line_items[0][price_data][unit_amount]', String(input.priceCents));
  form.set('line_items[0][price_data][recurring][interval]', input.interval);
  form.set('line_items[0][price_data][product_data][name]', `FreeDownload ${input.planName}`);
  return form;
}

interface StripeSessionResponse {
  id?: string;
  url?: string;
  error?: { message?: string };
}

const stripeProvider: PaymentProvider = {
  name: 'stripe',
  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.payment.secret}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: checkoutForm(input),
    });
    const body = (await response.json()) as StripeSessionResponse;
    if (!response.ok || !body.url || !body.id) {
      logger.error(
        { status: response.status, stripeError: body.error?.message },
        'stripe checkout session creation failed',
      );
      throw new AppError('SERVICE_UNAVAILABLE', 'The payment provider is unavailable.');
    }
    return { url: body.url, providerRef: body.id };
  },
};

export function getPaymentProvider(): PaymentProvider {
  return config.payment.provider === 'stripe' ? stripeProvider : nullProvider;
}
