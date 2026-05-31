// ============================================================================
//  Fruitopia — UNIFIED EXPRESS MONOLITH (single source of truth for Render)
// ----------------------------------------------------------------------------
//  This file is the canonical server. The legacy `server.mjs` has been
//  removed; Render runs `tsx server.ts` (see package.json scripts).
//
//  Everything previously living in server.mjs (email/SMS/WhatsApp, all
//  payment gateways, firebase-config helpers, Vite dev middleware, static
//  prod serving) has been migrated here, plus:
//    • app.use(express.urlencoded({ extended: true })) — required for
//      SSLCommerz / JazzCash / Easypaisa / PayFast POST callbacks.
//    • Explicit app.all('/api/sslcommerz/callback', …) handler that accepts
//      BOTH GET and POST (fixes "Cannot POST /api/sslcommerz/callback" on
//      Render) and safely res.redirect()s back to the SPA with the
//      transaction state.
//    • All gateway handlers read merchant credentials from the request body
//      (admin-panel CMS settings) with env-var fallbacks — no hard-coded
//      keys anywhere.
// ============================================================================

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Request, Response, NextFunction } from 'express';

const require = createRequire(import.meta.url);

// CommonJS deps loaded via createRequire so the file works under tsx/node
// without needing per-package ESM type-roots.
const express   = require('express');
const nodemailer = require('nodemailer');
const { createServer: createViteServer } = await import('vite');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Input sanitization helpers ──────────────────────────────────────────────
function sanitizeStr(s: unknown, max = 2000): string {
  return typeof s === 'string' ? s.replace(/<[^>]*>/g, '').substring(0, max) : '';
}
function isValidEmail(e: unknown): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e));
}

// ── Transporter pool (reuse SMTP connections) ───────────────────────────────
const _transporterCache = new Map<string, any>();
function getTransporter(smtp: any) {
  const cacheKey = `${smtp.host}:${smtp.port}:${smtp.email}`;
  if (_transporterCache.has(cacheKey)) return _transporterCache.get(cacheKey);
  const port = Number(smtp.port || 587);
  const t = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure: port === 465,
    auth: { user: smtp.email, pass: smtp.password },
    tls: { rejectUnauthorized: false },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    rateLimit: 14,
  });
  _transporterCache.set(cacheKey, t);
  return t;
}

// ── Rate limiter (OTP abuse protection) ────────────────────────────────────
const _rateLimitMap = new Map<string, { count: number; windowStart: number }>();
function checkRateLimit(key: string, maxPerWindow = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = _rateLimitMap.get(key) || { count: 0, windowStart: now };
  if (now - entry.windowStart > windowMs) {
    _rateLimitMap.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= maxPerWindow) return false;
  entry.count++;
  _rateLimitMap.set(key, entry);
  return true;
}

async function startServer() {
  const app = express();

  // JSON + URL-encoded body parsing. The urlencoded parser is REQUIRED for
  // SSLCommerz / JazzCash / Easypaisa / PayFast which POST x-www-form-urlencoded
  // callbacks. Without it req.body is empty on POST.
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  const PORT = Number(process.env.PORT || 3005);
  const isProd = process.env.NODE_ENV === 'production';

  // ── CORS ────────────────────────────────────────────────────────────────
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    next();
  });

  // --- HEALTH ----------------------------------------------------------------
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'healthy', time: new Date().toISOString() });
  });

  // --- SEND EMAIL ------------------------------------------------------------
  app.post('/api/send-email', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const to      = sanitizeStr(raw.to, 254);
    const subject = sanitizeStr(raw.subject, 200);
    const html    = sanitizeStr(raw.html, 50000);
    const { smtpSettings } = raw;
    if (!to || !subject || !html) return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
    if (!isValidEmail(to)) return res.status(400).json({ error: 'Invalid email' });
    const smtp = smtpSettings || { isEnabled: false };
    if (!smtp.isEnabled || !smtp.host || !smtp.email || !smtp.password) {
      console.log(`[EMAIL SKIPPED] SMTP not configured → ${to} | ${subject}`);
      return res.json({ success: true, simulated: true, message: 'SMTP not configured — email skipped.' });
    }
    try {
      const transporter = getTransporter(smtp);
      const info = await transporter.sendMail({
        from: `"${smtp.fromName || 'Store'}" <${smtp.email}>`,
        to, subject, html,
        headers: { 'X-Priority': '1', 'X-Mailer': 'E-Shop Mailer v5.6' },
      });
      console.log(`[EMAIL SENT] To: ${to} | ID: ${info.messageId}`);
      return res.json({ success: true, messageId: info.messageId });
    } catch (err: any) {
      _transporterCache.delete(`${smtp.host}:${smtp.port}:${smtp.email}`);
      console.error('[EMAIL ERROR]', err.message);
      return res.status(500).json({
        success: false, error: err.message,
        hint: 'For Gmail: use an App Password. Enable 2FA → myaccount.google.com/apppasswords',
      });
    }
  });

  // --- SEND SMS (Twilio) -----------------------------------------------------
  app.post('/api/send-sms', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const to      = sanitizeStr(raw.to, 20);
    const message = sanitizeStr(raw.message, 500);
    const { twilioSettings } = raw;
    if (!to || !message) return res.status(400).json({ error: 'Missing fields' });
    const ts = twilioSettings || {};
    if (!ts.isEnabled || !ts.accountSid || !ts.authToken || !ts.fromNumber) {
      console.log(`[SMS SKIPPED] Twilio not configured → ${to}`);
      return res.json({ success: true, simulated: true, message: 'SMS gateway not configured.' });
    }
    if (!checkRateLimit(`sms:${to}`, 3, 60_000)) {
      return res.status(429).json({ success: false, error: 'Too many SMS requests. Please wait before requesting another OTP.' });
    }
    try {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${ts.accountSid}/Messages.json`;
      const basicAuth = Buffer.from(`${ts.accountSid}:${ts.authToken}`).toString('base64');
      const body = new URLSearchParams({ To: to, From: ts.fromNumber, Body: message });
      const resp = await fetch(twilioUrl, {
        method: 'POST',
        headers: { Authorization: `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const data: any = await resp.json();
      if (data.sid) return res.json({ success: true, sid: data.sid });
      return res.status(502).json({ success: false, error: data.message || 'Twilio error', code: data.code });
    } catch (err: any) {
      console.error('[SMS ERROR]', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- SEND VERIFICATION EMAIL ----------------------------------------------
  app.post('/api/send-verification', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const email     = sanitizeStr(raw.email, 254);
    const token     = sanitizeStr(raw.token, 200);
    const storeName = sanitizeStr(raw.storeName, 100);
    const { smtpSettings } = raw;
    if (!email || !token) return res.status(400).json({ error: 'Missing email or token' });
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });
    const smtp = smtpSettings || { isEnabled: false };
    const baseUrl = (req.headers.origin as string) || `${req.protocol}://${req.get('host')}`;
    const verifyUrl = `${baseUrl}?verify_token=${token}&verify_email=${encodeURIComponent(email)}`;
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:32px;background:#f8fafc;border-radius:12px;">
        <div style="background:#10b981;border-radius:8px;padding:20px 24px;text-align:center;margin-bottom:24px;">
          <div style="font-size:36px;margin-bottom:6px;">✉️</div>
          <div style="color:#fff;font-size:18px;font-weight:800;">${storeName || 'E-Shop'}</div>
          <div style="color:#d1fae5;font-size:12px;margin-top:4px;">Email Verification</div>
        </div>
        <h2 style="color:#0f172a;font-size:16px;margin:0 0 10px;">Verify your email address</h2>
        <p style="color:#475569;font-size:13px;margin:0 0 20px;">Click the button below to verify your email and activate your account. This link expires in <strong>24 hours</strong>.</p>
        <div style="text-align:center;margin:24px 0;">
          <a href="${verifyUrl}" style="display:inline-block;background:#10b981;color:#fff;font-weight:700;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;">✅ Verify My Email</a>
        </div>
        <p style="color:#94a3b8;font-size:11px;text-align:center;">If you didn't create this account, please ignore this email.</p>
      </div>`;
    if (!smtp.isEnabled || !smtp.host || !smtp.email || !smtp.password) {
      console.log(`[VERIFY SKIPPED] SMTP not configured → ${email} | Token: ${token}`);
      return res.json({ success: true, simulated: true });
    }
    try {
      const transporter = getTransporter(smtp);
      await transporter.sendMail({
        from: `"${smtp.fromName || storeName || 'Store'}" <${smtp.email}>`,
        to: email,
        subject: `Verify your ${storeName || 'E-Shop'} account`,
        html,
      });
      return res.json({ success: true });
    } catch (err: any) {
      console.error('[VERIFY EMAIL ERROR]', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- SEND WHATSAPP (Meta Cloud API) ---------------------------------------
  app.post('/api/send-whatsapp', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const to = sanitizeStr(raw.to, 20);
    const { waSettings } = raw;
    const phoneNumberId = waSettings?.phoneNumberId;
    const accessToken = waSettings?.accessToken;
    const templateName = waSettings?.templateName || 'hello_world';
    if (!phoneNumberId || !accessToken) {
      return res.json({ success: false, error: 'WhatsApp not configured', simulated: true });
    }
    if (!to) return res.status(400).json({ success: false, error: 'Missing recipient phone number' });
    try {
      const waRes = await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to,
          type: 'template', template: { name: templateName, language: { code: 'en_US' } },
        }),
      });
      const data: any = await waRes.json();
      if (data.messages?.[0]?.id) return res.json({ success: true, messageId: data.messages[0].id });
      return res.status(502).json({ success: false, error: data.error?.message || 'WhatsApp API error', detail: data });
    } catch (err: any) {
      console.error('[WHATSAPP ERROR]', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ==========================================================================
  // ============================ PAYMENT GATEWAYS ============================
  // All handlers read merchant credentials from req.body (the admin-panel
  // CMS settings) with env-var fallbacks only where explicitly noted.
  // ==========================================================================

  // --- STRIPE ----------------------------------------------------------------
  app.post('/api/stripe/create-payment-intent', async (req: Request, res: Response) => {
    const { amount, currency = 'usd', stripeSecretKey } = req.body || {};
    const secret = String(stripeSecretKey || process.env.STRIPE_SECRET_KEY || '').trim();
    if (!secret) return res.status(400).json({ error: 'Stripe secret key not configured.' });
    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: 'Invalid amount.' });
    try {
      const amountCents = Math.round(Number(amount) * 100);
      const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          amount: String(amountCents),
          currency,
          'automatic_payment_methods[enabled]': 'true',
        }).toString(),
      });
      const data: any = await stripeRes.json();
      if (data.error) return res.status(502).json({ error: data.error.message });
      return res.json({ success: true, clientSecret: data.client_secret, paymentIntentId: data.id });
    } catch (err: any) {
      return res.status(500).json({ error: `Stripe API error: ${err.message}` });
    }
  });

  app.post('/api/stripe/confirm-payment', async (req: Request, res: Response) => {
    const { paymentIntentId, paymentMethodId, stripeSecretKey } = req.body || {};
    const secret = String(stripeSecretKey || process.env.STRIPE_SECRET_KEY || '').trim();
    if (!secret || !paymentIntentId || !paymentMethodId)
      return res.status(400).json({ error: 'Missing required Stripe parameters.' });
    try {
      const r = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ payment_method: paymentMethodId }).toString(),
      });
      const data: any = await r.json();
      if (data.error) return res.status(502).json({ error: data.error.message });
      if (data.status === 'succeeded' || data.status === 'requires_capture')
        return res.json({ success: true, status: data.status, transactionId: data.id });
      return res.status(502).json({ error: `Unexpected Stripe status: ${data.status}`, status: data.status });
    } catch (err: any) {
      return res.status(500).json({ error: `Stripe confirm error: ${err.message}` });
    }
  });

  // --- PAYPAL ----------------------------------------------------------------
  app.post('/api/paypal/create-order', async (req: Request, res: Response) => {
    const { amount, currency = 'USD' } = req.body || {};
    const clientId     = String(req.body?.clientId     || process.env.PAYPAL_CLIENT_ID     || '').trim();
    const clientSecret = String(req.body?.clientSecret || process.env.PAYPAL_CLIENT_SECRET || '').trim();
    const sandboxMode  = req.body?.sandboxMode ?? (String(process.env.PAYPAL_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!clientId || !clientSecret) return res.status(400).json({ error: 'PayPal credentials not configured.' });
    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: 'Invalid amount.' });
    const baseUrl = sandboxMode !== false ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    try {
      const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      const tokenData: any = await tokenRes.json();
      if (!tokenData.access_token) return res.status(502).json({ error: 'PayPal token grant failed.', detail: tokenData });
      const orderRes = await fetch(`${baseUrl}/v2/checkout/orders`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: 'CAPTURE',
          purchase_units: [{ amount: { currency_code: currency, value: Number(amount).toFixed(2) } }],
          application_context: {
            return_url: `${req.protocol}://${req.get('host')}/api/paypal/callback?status=success`,
            cancel_url: `${req.protocol}://${req.get('host')}/api/paypal/callback?status=cancelled`,
          },
        }),
      });
      const orderData: any = await orderRes.json();
      if (orderData.id) {
        const approvalLink = orderData.links?.find((l: any) => l.rel === 'approve')?.href;
        return res.json({ success: true, orderId: orderData.id, approvalUrl: approvalLink });
      }
      return res.status(502).json({ error: 'PayPal order creation failed.', detail: orderData });
    } catch (err: any) {
      return res.status(500).json({ error: `PayPal API error: ${err.message}` });
    }
  });

  app.post('/api/paypal/capture-order', async (req: Request, res: Response) => {
    const { orderId } = req.body || {};
    const clientId     = String(req.body?.clientId     || process.env.PAYPAL_CLIENT_ID     || '').trim();
    const clientSecret = String(req.body?.clientSecret || process.env.PAYPAL_CLIENT_SECRET || '').trim();
    const sandboxMode  = req.body?.sandboxMode ?? (String(process.env.PAYPAL_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!clientId || !clientSecret || !orderId) return res.status(400).json({ error: 'Missing PayPal capture parameters.' });
    const baseUrl = sandboxMode !== false ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
    try {
      const tokenRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });
      const tokenData: any = await tokenRes.json();
      if (!tokenData.access_token) return res.status(502).json({ error: 'PayPal token grant failed.' });
      const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
      });
      const captureData: any = await captureRes.json();
      if (captureData.status === 'COMPLETED') {
        const txnId = captureData.purchase_units?.[0]?.payments?.captures?.[0]?.id;
        return res.json({ success: true, status: 'COMPLETED', transactionId: txnId });
      }
      return res.status(502).json({ error: 'PayPal capture failed.', detail: captureData });
    } catch (err: any) {
      return res.status(500).json({ error: `PayPal capture error: ${err.message}` });
    }
  });

  app.all('/api/paypal/callback', (req: Request, res: Response) => {
    const token  = (req.query.token  || req.body?.token  || '').toString();
    const status = (req.query.status || req.body?.status || '').toString();
    if (status === 'cancelled') return res.redirect(`/?paypal=cancelled&orderId=${token}`);
    res.redirect(`/?paypal=approved&orderId=${token}`);
  });

  // --- SSLCOMMERZ ------------------------------------------------------------
  app.post('/api/sslcommerz/create-payment', async (req: Request, res: Response) => {
    const body = req.body || {};
    const { amount, currency = 'BDT', orderId, productName, customer = {} } = body;
    const storeId       = String(body.storeId       || body.store_id      || process.env.SSLCZ_STORE_ID       || '').trim();
    const storePassword = String(body.storePassword || body.storePass     || body.store_passwd
                              || process.env.SSLCZ_STORE_PASSWORD || '').trim();
    const sandboxMode = body.sandboxMode ?? body.isSandbox
      ?? (String(process.env.SSLCZ_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    if (!storeId || !storePassword)
      return res.status(400).json({ error: 'SSLCommerz credentials not configured. Set Store ID and Store Password in the admin panel.' });
    const baseUrl = sandboxMode !== false ? 'https://sandbox.sslcommerz.com' : 'https://securepay.sslcommerz.com';
    const origin = `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    try {
      const params = new URLSearchParams({
        store_id: storeId, store_passwd: storePassword,
        total_amount: Number(amount).toFixed(2), currency, tran_id: orderId,
        success_url:  `${origin}/api/sslcommerz/callback?status=success&orderId=${encodeURIComponent(orderId)}`,
        fail_url:     `${origin}/api/sslcommerz/callback?status=failed&orderId=${encodeURIComponent(orderId)}`,
        cancel_url:   `${origin}/api/sslcommerz/callback?status=cancelled&orderId=${encodeURIComponent(orderId)}`,
        ipn_url:      `${origin}/api/sslcommerz/ipn`,
        cus_name: customer.name || 'Customer', cus_email: customer.email || 'customer@example.com',
        cus_phone: customer.phone || '01700000000', cus_add1: customer.address || 'N/A',
        cus_city: customer.city || 'Dhaka', cus_country: customer.country || 'Bangladesh',
        shipping_method: 'NO', product_name: productName || 'Order',
        product_category: 'general', product_profile: 'general',
        num_of_item: '1', value_a: orderId,
      });
      const sslRes = await fetch(`${baseUrl}/gwprocess/v4/api.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const text = await sslRes.text();
      let data: any;
      try { data = JSON.parse(text); }
      catch {
        console.error('[SSLCommerz] invalid JSON response', { status: sslRes.status, text });
        return res.status(502).json({ error: 'SSLCommerz returned an invalid response.', detail: text });
      }
      if (data.status === 'SUCCESS' && data.GatewayPageURL)
        return res.json({ success: true, redirectUrl: data.GatewayPageURL, gatewayUrl: data.GatewayPageURL, sessionKey: data.sessionkey });
      return res.status(502).json({ error: data.failedreason || 'SSLCommerz session initiation failed.', detail: data });
    } catch (err: any) {
      return res.status(500).json({ error: `SSLCommerz API error: ${err.message}` });
    }
  });

  // ── CRITICAL FIX: explicit POST + GET handler for /api/sslcommerz/callback ──
  // SSLCommerz POSTs (x-www-form-urlencoded) to success_url/fail_url/cancel_url.
  // Using app.all() captures BOTH verbs cleanly, fixing the
  // "Cannot POST /api/sslcommerz/callback" 404 reported on Render. We safely
  // res.redirect() back to the SPA with the transaction state so the frontend
  // can finalise the order.
  app.all('/api/sslcommerz/callback', (req: Request, res: Response) => {
    console.log(`[SSLCOMMERZ CALLBACK] ${req.method} status=${req.query.status || req.body?.status}`);
    const status  = (req.query.status   || req.body?.status     || '').toString();
    const orderId = (req.query.orderId  || req.body?.value_a    || req.body?.tran_id || '').toString();
    const tranId  = (req.body?.tran_id  || '').toString();
    const valId   = (req.body?.val_id   || '').toString();
    const qs = new URLSearchParams({
      sslcommerz: status === 'success' ? 'success' : status === 'failed' ? 'failed' : 'cancelled',
      ...(orderId ? { orderId } : {}),
      ...(tranId  ? { tranId  } : {}),
      ...(valId   ? { valId   } : {}),
    }).toString();
    return res.redirect(`/?${qs}`);
  });

  app.post('/api/sslcommerz/ipn', (req: Request, res: Response) => {
    console.log('[SSLCommerz IPN]', req.body);
    res.status(200).send('OK');
  });

  // ── PAYTM (All-in-One SDK) ────────────────────────────────────────────────
  app.post('/api/paytm/initiate', async (req: Request, res: Response) => {
    const crypto = require('crypto');
    const { amount, orderId, customer = {} } = req.body || {};
    const merchantId  = String(req.body?.merchantId  || process.env.PAYTM_MID || '').trim();
    const merchantKey = String(req.body?.merchantKey || process.env.PAYTM_MERCHANT_KEY || '').trim();
    const sandboxMode = req.body?.sandboxMode ?? (String(process.env.PAYTM_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!merchantId || !merchantKey) return res.status(400).json({ error: 'Paytm credentials not configured.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    const isSandbox = sandboxMode !== false;
    const host = isSandbox ? 'https://securegw-stage.paytm.in' : 'https://securegw.paytm.in';
    const origin = `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    const body = {
      requestType: 'Payment', mid: merchantId,
      websiteName: isSandbox ? 'WEBSTAGING' : 'DEFAULT',
      orderId: String(orderId),
      callbackUrl: `${origin}/api/paytm/callback`,
      txnAmount: { value: Number(amount).toFixed(2), currency: 'INR' },
      userInfo: {
        custId: customer.email || customer.phone || `cust_${Date.now()}`,
        email: customer.email || undefined, mobile: customer.phone || undefined,
      },
    };
    const generateSignature = (data: string, key: string) => {
      const iv = '@@@@&&&&####$$$$';
      const cipher = crypto.createCipheriv('aes-128-cbc', key.slice(0, 16), iv);
      let encrypted = cipher.update(data, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      return encrypted;
    };
    try {
      const payload: any = { body, head: {} };
      const bodyStr = JSON.stringify(body);
      payload.head = { signature: generateSignature(bodyStr, merchantKey) };
      const r = await fetch(
        `${host}/theia/api/v1/initiateTransaction?mid=${merchantId}&orderId=${encodeURIComponent(orderId)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      );
      const data: any = await r.json();
      const txnToken = data?.body?.txnToken;
      if (!txnToken) return res.status(502).json({ error: data?.body?.resultInfo?.resultMsg || 'Paytm init failed.', detail: data });
      const redirectUrl = `${host}/theia/api/v1/showPaymentPage?mid=${merchantId}&orderId=${encodeURIComponent(orderId)}`;
      return res.json({ success: true, txnToken, redirectUrl, mid: merchantId, orderId });
    } catch (err: any) {
      return res.status(500).json({ error: `Paytm API error: ${err.message}` });
    }
  });

  app.all('/api/paytm/callback', (req: Request, res: Response) => {
    const status  = (req.body?.STATUS  || req.query.STATUS  || '').toString();
    const orderId = (req.body?.ORDERID || req.query.ORDERID || '').toString();
    const txnId   = (req.body?.TXNID   || req.query.TXNID   || '').toString();
    const qs = new URLSearchParams({
      paytm: status === 'TXN_SUCCESS' ? 'success' : status === 'PENDING' ? 'pending' : 'failed',
      ...(orderId ? { orderId } : {}),
      ...(txnId   ? { txnId   } : {}),
    }).toString();
    res.redirect(`/?${qs}`);
  });

  // ── UPI (manual intent / QR) ──────────────────────────────────────────────
  app.post('/api/upi/create-intent', (req: Request, res: Response) => {
    const { amount, orderId, note } = req.body || {};
    const upiId      = String(req.body?.upiId      || process.env.UPI_VPA          || '').trim();
    const payeeName  = String(req.body?.payeeName  || process.env.UPI_PAYEE_NAME   || 'Merchant').trim();
    if (!upiId) return res.status(400).json({ error: 'UPI ID (VPA) not configured.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    const params = new URLSearchParams({
      pa: upiId, pn: payeeName, tr: String(orderId),
      am: Number(amount).toFixed(2), cu: 'INR', tn: note || `Order ${orderId}`,
    });
    const intent = `upi://pay?${params.toString()}`;
    return res.json({ success: true, intent, qrPayload: intent });
  });

  // ── JAZZCASH (Pakistan) ───────────────────────────────────────────────────
  app.post('/api/jazzcash/initiate', (req: Request, res: Response) => {
    const crypto = require('crypto');
    const { amount, orderId, customer = {} } = req.body || {};
    const merchantId    = String(req.body?.merchantId    || process.env.JAZZCASH_MID || '').trim();
    const password      = String(req.body?.password      || process.env.JAZZCASH_PASSWORD || '').trim();
    const integritySalt = String(req.body?.integritySalt || process.env.JAZZCASH_SALT || '').trim();
    const sandboxMode   = req.body?.sandboxMode ?? (String(process.env.JAZZCASH_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!merchantId || !password || !integritySalt) return res.status(400).json({ error: 'JazzCash credentials not configured.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    const isSandbox = sandboxMode !== false;
    const postUrl = isSandbox
      ? 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/'
      : 'https://payments.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/';
    const origin = `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const txnDateTime =
      now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) +
      pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
    const expiry = new Date(now.getTime() + 60 * 60 * 1000);
    const expiryDateTime =
      expiry.getFullYear() + pad(expiry.getMonth() + 1) + pad(expiry.getDate()) +
      pad(expiry.getHours()) + pad(expiry.getMinutes()) + pad(expiry.getSeconds());
    const fields: Record<string, string> = {
      pp_Version: '1.1', pp_TxnType: 'MWALLET', pp_Language: 'EN',
      pp_MerchantID: merchantId, pp_SubMerchantID: '', pp_Password: password,
      pp_BankID: 'TBANK', pp_ProductID: 'RETL',
      pp_TxnRefNo: `T${txnDateTime}${String(orderId).slice(-6)}`,
      pp_Amount: String(Math.round(Number(amount) * 100)), pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: txnDateTime, pp_BillReference: String(orderId),
      pp_Description: `Order ${orderId}`, pp_TxnExpiryDateTime: expiryDateTime,
      pp_ReturnURL: `${origin}/api/jazzcash/callback`, pp_SecureHash: '',
      ppmpf_1: customer.name || '', ppmpf_2: customer.email || '',
      ppmpf_3: customer.phone || '', ppmpf_4: '', ppmpf_5: '',
    };
    const sortedKeys = Object.keys(fields).filter(k => fields[k] !== '' && k !== 'pp_SecureHash').sort();
    const hashString = integritySalt + '&' + sortedKeys.map(k => fields[k]).join('&');
    fields.pp_SecureHash = crypto.createHmac('sha256', integritySalt).update(hashString).digest('hex').toUpperCase();
    return res.json({ success: true, postUrl, fields });
  });

  app.all('/api/jazzcash/callback', (req: Request, res: Response) => {
    const code    = (req.body?.pp_ResponseCode || req.query.pp_ResponseCode || '').toString();
    const orderId = (req.body?.pp_BillReference || req.query.pp_BillReference || '').toString();
    const txnRef  = (req.body?.pp_TxnRefNo || req.query.pp_TxnRefNo || '').toString();
    const qs = new URLSearchParams({
      jazzcash: code === '000' ? 'success' : 'failed', code,
      ...(orderId ? { orderId } : {}),
      ...(txnRef  ? { txnRef  } : {}),
    }).toString();
    res.redirect(`/?${qs}`);
  });

  // ── EASYPAISA (Pakistan) ──────────────────────────────────────────────────
  app.post('/api/easypaisa/initiate', (req: Request, res: Response) => {
    const { amount, orderId, customer = {} } = req.body || {};
    const storeId     = String(req.body?.storeId     || process.env.EASYPAISA_STORE_ID  || '').trim();
    const hashKey     = String(req.body?.hashKey     || process.env.EASYPAISA_HASH_KEY  || '').trim();
    const sandboxMode = req.body?.sandboxMode ?? (String(process.env.EASYPAISA_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!storeId) return res.status(400).json({ error: 'Easypaisa Store ID not configured.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    const isSandbox = sandboxMode !== false;
    const baseUrl = isSandbox
      ? 'https://easypaystg.easypaisa.com.pk/easypay/Index.jsf'
      : 'https://easypay.easypaisa.com.pk/easypay/Index.jsf';
    const origin = `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    const params = new URLSearchParams({
      storeId: String(storeId), amount: Number(amount).toFixed(2),
      postBackURL: `${origin}/api/easypaisa/callback`,
      orderRefNum: String(orderId), expiryDate: '',
      merchantHashedReq: hashKey || '',
      autoRedirect: '1', paymentMethod: 'MA_PAYMENT_METHOD',
      emailAddr: customer.email || '', mobileNum: customer.phone || '',
    });
    return res.json({ success: true, redirectUrl: `${baseUrl}?${params.toString()}` });
  });

  app.all('/api/easypaisa/callback', (req: Request, res: Response) => {
    const status  = (req.body?.status         || req.query.status         || '').toString();
    const orderId = (req.body?.orderRefNumber || req.query.orderRefNumber || '').toString();
    const txnRef  = (req.body?.transactionId  || req.query.transactionId  || '').toString();
    const qs = new URLSearchParams({
      easypaisa: status === '0000' || status === 'success' ? 'success' : 'failed',
      ...(orderId ? { orderId } : {}),
      ...(txnRef  ? { txnRef  } : {}),
    }).toString();
    res.redirect(`/?${qs}`);
  });

  // ── PAYFAST (South Africa) ────────────────────────────────────────────────
  app.post('/api/payfast/initiate', (req: Request, res: Response) => {
    const crypto = require('crypto');
    const { amount, orderId, customer = {}, productName } = req.body || {};
    const merchantId  = String(req.body?.merchantId  || process.env.PAYFAST_MERCHANT_ID || '').trim();
    const merchantKey = String(req.body?.merchantKey || process.env.PAYFAST_MERCHANT_KEY || '').trim();
    const passphrase  = String(req.body?.passphrase  || process.env.PAYFAST_PASSPHRASE   || '').trim();
    const sandboxMode = req.body?.sandboxMode ?? (String(process.env.PAYFAST_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!merchantId || !merchantKey) return res.status(400).json({ error: 'PayFast credentials not configured.' });
    if (!amount || !orderId) return res.status(400).json({ error: 'amount and orderId are required.' });
    const isSandbox = sandboxMode !== false;
    const postUrl = isSandbox
      ? 'https://sandbox.payfast.co.za/eng/process'
      : 'https://www.payfast.co.za/eng/process';
    const origin = `${(req.headers['x-forwarded-proto'] || req.protocol)}://${req.get('host')}`;
    const fields: Record<string, string> = {
      merchant_id: String(merchantId), merchant_key: String(merchantKey),
      return_url:  `${origin}/api/payfast/callback?status=success&orderId=${encodeURIComponent(orderId)}`,
      cancel_url:  `${origin}/api/payfast/callback?status=cancelled&orderId=${encodeURIComponent(orderId)}`,
      notify_url:  `${origin}/api/payfast/ipn`,
      name_first: (customer.name || 'Customer').split(' ')[0] || 'Customer',
      name_last:  (customer.name || '').split(' ').slice(1).join(' ') || '-',
      email_address: customer.email || 'customer@example.com',
      m_payment_id: String(orderId), amount: Number(amount).toFixed(2),
      item_name: productName || `Order ${orderId}`,
    };
    const encode = (v: any) => encodeURIComponent(String(v)).replace(/%20/g, '+');
    const sigStr = Object.keys(fields)
      .filter(k => fields[k] !== '' && fields[k] !== undefined)
      .map(k => `${k}=${encode(fields[k])}`).join('&');
    const withPass = passphrase ? `${sigStr}&passphrase=${encode(passphrase)}` : sigStr;
    fields.signature = crypto.createHash('md5').update(withPass).digest('hex');
    return res.json({ success: true, postUrl, fields });
  });

  app.all('/api/payfast/callback', (req: Request, res: Response) => {
    const status  = (req.query.status || req.body?.status || '').toString();
    const orderId = (req.query.orderId || req.body?.m_payment_id || '').toString();
    const qs = new URLSearchParams({
      payfast: status === 'success' ? 'success' : 'cancelled',
      ...(orderId ? { orderId } : {}),
    }).toString();
    res.redirect(`/?${qs}`);
  });

  app.post('/api/payfast/ipn', (req: Request, res: Response) => {
    console.log('[PayFast IPN]', req.body);
    res.status(200).send('OK');
  });

  // --- RAZORPAY --------------------------------------------------------------
  app.post('/api/razorpay/create-order', async (req: Request, res: Response) => {
    const { amount, currency = 'INR', orderId } = req.body || {};
    const keyId     = String(req.body?.keyId     || process.env.RAZORPAY_KEY_ID     || '').trim();
    const keySecret = String(req.body?.keySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!keyId || !keySecret) return res.status(400).json({ error: 'Razorpay credentials not configured.' });
    if (!amount || isNaN(Number(amount))) return res.status(400).json({ error: 'Invalid amount.' });
    try {
      const amountPaise = Math.round(Number(amount) * 100);
      const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: amountPaise, currency,
          receipt: orderId || `QF-${Date.now()}`, payment_capture: 1,
        }),
      });
      const data: any = await rzpRes.json();
      if (data.id) return res.json({ success: true, rzpOrderId: data.id, amount: data.amount, currency: data.currency, keyId });
      return res.status(502).json({ error: 'Razorpay order creation failed.', detail: data });
    } catch (err: any) {
      return res.status(500).json({ error: `Razorpay API error: ${err.message}` });
    }
  });

  app.post('/api/razorpay/verify-payment', async (req: Request, res: Response) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    const keySecret = String(req.body?.keySecret || process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !keySecret)
      return res.status(400).json({ error: 'Missing verification parameters.' });
    try {
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
      if (expectedSignature === razorpay_signature)
        return res.json({ success: true, verified: true, transactionId: razorpay_payment_id });
      return res.status(400).json({ error: 'Signature verification failed. Payment may be tampered.', verified: false });
    } catch (err: any) {
      return res.status(500).json({ error: `Razorpay verify error: ${err.message}` });
    }
  });

  // --- BKASH -----------------------------------------------------------------
  app.post('/api/bkash/create-payment', async (req: Request, res: Response) => {
    const { amount, orderId } = req.body || {};
    const appKey    = String(req.body?.appKey    || process.env.BKASH_APP_KEY    || '').trim();
    const appSecret = String(req.body?.appSecret || process.env.BKASH_APP_SECRET || '').trim();
    const username  = String(req.body?.username  || process.env.BKASH_USERNAME   || '').trim();
    const password  = String(req.body?.password  || process.env.BKASH_PASSWORD   || '').trim();
    const sandboxMode = req.body?.sandboxMode ?? (String(process.env.BKASH_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!appKey || !appSecret || !username || !password)
      return res.status(400).json({ error: 'bKash API credentials not configured.' });
    const baseUrl = sandboxMode
      ? 'https://tokenized.sandbox.bka.sh/v1.2.0-beta'
      : 'https://tokenized.pay.bka.sh/v1.2.0-beta';
    try {
      const tokenRes = await fetch(`${baseUrl}/tokenized/checkout/token/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', username, password } as any,
        body: JSON.stringify({ app_key: appKey, app_secret: appSecret }),
      });
      const tokenData: any = await tokenRes.json();
      if (!tokenData.id_token) return res.status(502).json({ error: 'bKash token grant failed.', detail: tokenData });
      const createRes = await fetch(`${baseUrl}/tokenized/checkout/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: tokenData.id_token, 'X-APP-Key': appKey } as any,
        body: JSON.stringify({
          mode: '0011', payerReference: orderId,
          callbackURL: `${req.protocol}://${req.get('host')}/api/bkash/callback`,
          amount: String(amount), currency: 'BDT', intent: 'sale', merchantInvoiceNumber: orderId,
        }),
      });
      const createData: any = await createRes.json();
      if (createData.statusCode === '0000' && createData.bkashURL)
        return res.json({ success: true, bkashURL: createData.bkashURL, paymentID: createData.paymentID });
      return res.status(502).json({ error: 'bKash payment creation failed.', detail: createData });
    } catch (err: any) {
      return res.status(500).json({ error: `bKash API error: ${err.message}` });
    }
  });

  app.all('/api/bkash/callback', (req: Request, res: Response) => {
    const paymentID = (req.query.paymentID || req.body?.paymentID || '').toString();
    const status    = (req.query.status    || req.body?.status    || '').toString();
    if (status === 'cancel' || status === 'failure')
      return res.redirect(`/?bkash=failed&paymentID=${paymentID}`);
    res.redirect(`/?bkash=success&paymentID=${paymentID}`);
  });

  // --- NAGAD -----------------------------------------------------------------
  app.post('/api/nagad/create-payment', async (req: Request, res: Response) => {
    const { amount, orderId } = req.body || {};
    const merchantId  = String(req.body?.merchantId || process.env.NAGAD_MERCHANT_ID || '').trim();
    const sandboxMode = req.body?.sandboxMode ?? (String(process.env.NAGAD_SANDBOX || 'true').toLowerCase() !== 'false');
    if (!merchantId) return res.status(400).json({ error: 'Nagad Merchant ID not configured.' });
    const baseUrl = sandboxMode
      ? 'https://sandbox.mynagad.com:10080/remote-payment-gateway-1.0/api/dfs'
      : 'https://api.mynagad.com/api/dfs';
    const datetime = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    try {
      const initRes = await fetch(`${baseUrl}/check-out/initialize/${merchantId}/${orderId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-KM-Api-Version': 'v-0.2.0',
          'X-KM-IP-V4': req.ip || '127.0.0.1',
          'X-KM-Client-Type': 'PC_WEB',
          'X-KM-MC-Id': merchantId,
        } as any,
        body: JSON.stringify({
          dateTime: datetime,
          sensitiveData: Buffer.from(JSON.stringify({ merchantId, orderId, datetime, challenge: orderId })).toString('base64'),
          signature: '',
        }),
      });
      const initData: any = await initRes.json();
      if (initData.callBackUrl)
        return res.json({ success: true, nagadURL: initData.callBackUrl, paymentReferenceId: initData.paymentReferenceId });
      return res.status(502).json({ error: 'Nagad initialization failed.', detail: initData });
    } catch (err: any) {
      return res.status(500).json({ error: `Nagad API error: ${err.message}` });
    }
  });

  app.all('/api/nagad/callback', (req: Request, res: Response) => {
    const order_id       = (req.query.order_id       || req.body?.order_id       || '').toString();
    const payment_ref_id = (req.query.payment_ref_id || req.body?.payment_ref_id || '').toString();
    const status         = (req.query.status         || req.body?.status         || '').toString();
    if (status === 'Aborted' || status === 'Cancelled')
      return res.redirect(`/?nagad=failed&order=${order_id}`);
    res.redirect(`/?nagad=success&order=${order_id}&ref=${payment_ref_id}`);
  });

  // ==========================================================================
  // ====================== UNIVERSAL DYNAMIC ROUTER ==========================
  // Any /api/<gateway>/<action> not matched above is forwarded to
  // api/payment.ts (the legacy serverless router) for graceful fallback.
  // The explicit handlers above take precedence — this exists so new
  // CMS-driven gateways can be added without redeploying server code.
  // ==========================================================================
  app.all('/api/:gateway/:action', async (req: Request, res: Response, next: NextFunction) => {
    const { gateway, action } = req.params;
    (req.query as any).gateway = gateway;
    (req.query as any).action = action;
    try {
      const mod: any = await import('./api/payment.js').catch(() => null);
      if (mod && typeof mod.default === 'function') {
        return mod.default(req, res);
      }
      return next();
    } catch (err: any) {
      console.error(`[Universal Router] /api/${gateway}/${action} failed:`, err.message);
      return next();
    }
  });

  // --- SERVE firebase-config.json (cross-browser) ----------------------------
  app.get('/firebase-config.json', (_req: Request, res: Response) => {
    const fs = require('fs');
    const locations = [
      path.join(__dirname, 'public', 'firebase-config.json'),
      path.join(__dirname, 'firebase-config.json'),
      path.join(__dirname, 'dist', 'firebase-config.json'),
    ];
    for (const loc of locations) {
      if (fs.existsSync(loc)) return res.sendFile(loc);
    }
    res.status(404).json({ error: 'firebase-config.json not found. Run the install wizard first.' });
  });

  // --- SAVE FIREBASE CONFIG --------------------------------------------------
  app.get('/api/save-config', (_req: Request, res: Response) => {
    res.json({ ok: true, message: 'Fruitopia Node save-config endpoint ready.' });
  });

  app.post('/api/save-config', async (req: Request, res: Response) => {
    const fs   = require('fs');
    const data = req.body || {};
    const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
    for (const field of required) {
      if (!data[field] || typeof data[field] !== 'string' || !data[field].trim()) {
        return res.status(400).json({ success: false, message: `Missing required field: "${field}"` });
      }
    }
    if (!data.apiKey.trim().startsWith('AIza')) {
      return res.status(400).json({ success: false, message: 'Invalid apiKey format. Firebase Web API keys start with "AIza".' });
    }
    const outDir  = isProd ? path.join(__dirname, 'dist') : path.join(__dirname, 'public');
    const cfgFile = path.join(outDir, 'firebase-config.json');
    const lockFile = isProd
      ? path.join(path.join(__dirname, 'dist'), 'install-helper.lock')
      : path.join(__dirname, 'install-helper.lock');
    if (fs.existsSync(lockFile)) {
      return res.status(403).json({ success: false, message: 'Already installed. Delete install-helper.lock to reinstall.' });
    }
    const configData: any = {
      apiKey:            data.apiKey.trim(),
      authDomain:        data.authDomain.trim(),
      projectId:         data.projectId.trim(),
      storageBucket:     data.storageBucket.trim(),
      messagingSenderId: data.messagingSenderId.trim(),
      appId:             data.appId.trim(),
      ...(data.databaseId?.trim() ? { databaseId: data.databaseId.trim() } : {}),
    };
    try {
      fs.writeFileSync(cfgFile, JSON.stringify(configData, null, 2), 'utf8');
      fs.writeFileSync(lockFile, JSON.stringify({
        lockedAt: new Date().toISOString(),
        projectId: configData.projectId,
        message: 'Fruitopia installation complete. Delete this file to allow reinstallation.',
      }, null, 2), 'utf8');
      res.json({ success: true, message: 'firebase-config.json saved successfully.' });
    } catch (err: any) {
      console.error('[save-config] Write error:', err);
      res.status(500).json({ success: false, message: `Failed to write config: ${err.message}` });
    }
  });

  // --- VITE DEV or STATIC PROD ----------------------------------------------
  if (!isProd) {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[OK] Server running → http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[CRITICAL] Server startup error:', err);
  process.exit(1);
});
