// api/payment.ts
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE Vercel Serverless Function: routes ALL payment-gateway traffic.
// Fixes: Vercel-safe static imports, comprehensive error logging, edge-case handling.
// ─────────────────────────────────────────────────────────────────────────────

import type { VercelRequest, VercelResponse } from '@vercel/node';

// ── Static imports (no dynamic import() — more reliable on Vercel) ──────────
import bkashCreate from '../lib/payments/_bkash/create-payment';
import bkashExecute from '../lib/payments/_bkash/execute-payment';
import nagadCreate from '../lib/payments/_nagad/create-payment';
import nagadVerify from '../lib/payments/_nagad/verify-payment';
import sslcommerzCreate from '../lib/payments/_sslcommerz/create-payment';
import sslcommerzIpn from '../lib/payments/_sslcommerz/ipn';
import razorpayCreate from '../lib/payments/_razorpay/create-order';
import razorpayVerify from '../lib/payments/_razorpay/verify-payment';
import paypalCreate from '../lib/payments/_paypal/create-order';
import paypalCapture from '../lib/payments/_paypal/capture-order';
import paypalCallback from '../lib/payments/_paypal/callback';
import stripeCreate from '../lib/payments/_stripe/create-payment-intent';
import stripeConfirm from '../lib/payments/_stripe/confirm-payment';

// ── Route map: no lazy loading, direct function references ──────────────────
type Handler = (req: VercelRequest, res: VercelResponse) => unknown;
const ROUTE_MAP: Record<string, Record<string, Handler>> = {
  bkash: {
    'create-payment':  bkashCreate,
    'execute-payment': bkashExecute,
  },
  nagad: {
    'create-payment': nagadCreate,
    'verify-payment': nagadVerify,
  },
  sslcommerz: {
    'create-payment': sslcommerzCreate,
    'ipn':            sslcommerzIpn,
  },
  razorpay: {
    'create-order':   razorpayCreate,
    'verify-payment': razorpayVerify,
  },
  paypal: {
    'create-order':   paypalCreate,
    'capture-order':  paypalCapture,
    'callback':       paypalCallback,
  },
  stripe: {
    'create-payment-intent': stripeCreate,
    'confirm-payment':       stripeConfirm,
  },
};

// ── Main router ──────────────────────────────────────────────────────────────
export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const requestId = Math.random().toString(36).slice(2, 8);
  const startTime = Date.now();

  try {
    // CORS pre-flight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).end();
      return;
    }

    const gateway = normalise(req.query.gateway);
    const action  = normalise(req.query.action);

    console.log(
      `[${requestId}] Payment Router: ${req.method} | gateway=${gateway}, action=${action}`,
    );

    // ─ Validation ─────────────────────────────────────────────────────────
    if (!gateway || !action) {
      console.warn(`[${requestId}] Missing gateway or action`);
      res.status(400).json({
        error: 'Missing query parameters: gateway and action are required.',
        received: { gateway, action },
        example: '/api/payment?gateway=sslcommerz&action=create-payment',
      });
      return;
    }

    const gatewayActions = ROUTE_MAP[gateway];
    if (!gatewayActions) {
      console.warn(`[${requestId}] Unknown gateway: ${gateway}`);
      res.status(404).json({
        error: `Unknown gateway: "${gateway}"`,
        available: Object.keys(ROUTE_MAP),
      });
      return;
    }

    const handler = gatewayActions[action];
    if (!handler) {
      console.warn(
        `[${requestId}] Unknown action for gateway ${gateway}: ${action}`,
      );
      res.status(404).json({
        error: `Unknown action "${action}" for gateway "${gateway}"`,
        available: Object.keys(gatewayActions),
      });
      return;
    }

    // ─ Invoke the handler ──────────────────────────────────────────────────
    console.log(`[${requestId}] Invoking ${gateway}/${action}...`);
    const result = await handler(req, res);

    const elapsed = Date.now() - startTime;
    console.log(
      `[${requestId}] Success: ${gateway}/${action} completed in ${elapsed}ms`,
    );
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[${requestId}] ERROR after ${elapsed}ms:`, {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Payment router encountered an error',
        message: err?.message ?? 'Unknown error',
        requestId,
      });
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Safely coerce a VercelRequest query value to a plain lowercase string.
 */
function normalise(value: string | string[] | undefined): string {
  if (!value) return '';
  const str = Array.isArray(value) ? value[0] : value;
  if (typeof str !== 'string') return '';
  return str.trim().toLowerCase();
}
