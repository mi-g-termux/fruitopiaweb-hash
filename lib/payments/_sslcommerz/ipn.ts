// api/sslcommerz/ipn.ts
// Receives IPN/redirect from SSLCommerz and validates against their server.
// On success/fail/cancel, redirects user back to the storefront with a status flag.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getGatewayCreds } from '../_lib/getGatewayCreds';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const body =
      req.method === 'POST'
        ? (req.body || {})
        : (req.query || {});
    const status = (body.status as string) || (req.query.status as string) || 'unknown';
    const orderId = (body.tran_id as string) || (req.query.orderId as string) || '';
    const valId = body.val_id as string | undefined;

    let verified = false;
    if (status === 'success' && valId) {
      const creds = await getGatewayCreds('sslcommerz');
      const sandbox = String(creds.isSandbox).toLowerCase() !== 'false';
      const base = sandbox
        ? 'https://sandbox.sslcommerz.com'
        : 'https://securepay.sslcommerz.com';
      const u = `${base}/validator/api/validationserverAPI.php?val_id=${encodeURIComponent(
        valId,
      )}&store_id=${encodeURIComponent(creds.storeId)}&store_passwd=${encodeURIComponent(
        creds.storePass,
      )}&format=json`;
      const r = await fetch(u);
      const j: any = await r.json();
      verified = j?.status === 'VALID' || j?.status === 'VALIDATED';
    }

    const origin = getOrigin(req);
    const flag = verified ? 'success' : status;
    return res.redirect(302, `${origin}/?sslcz=${flag}&orderId=${encodeURIComponent(orderId)}`);
  } catch (e: any) {
    console.error('[sslcz/ipn]', e);
    return res.status(500).json({ error: e?.message });
  }
}

function getOrigin(req: VercelRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'https';
  return `${proto}://${req.headers.host}`;
}
