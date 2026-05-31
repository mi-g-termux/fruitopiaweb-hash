// ============================================================================
//  Fruitopia — UNIFIED EXPRESS MONOLITH (single source of truth for Render)
// ============================================================================
//  REFACTORED: Dynamic SMTP Transporter Configuration
//  - NO static transporter caching
//  - Smart port detection (465 vs 587 vs 25)
//  - 10-second connection timeout
//  - Immediate error responses (no infinite "Sending..." hangs)
// ============================================================================

import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Request, Response, NextFunction } from 'express';

const require = createRequire(import.meta.url);

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

// ──────────────────────────────────────────────────────────────────────────
// ✅ NEW: DYNAMIC TRANSPORTER CREATION (replaces static caching)
// ──────────────────────────────────────────────────────────────────────────
// Creates a FRESH Nodemailer transporter every time an email is sent.
// Automatically detects port and configures TLS/SSL appropriately.
//
// Port Intelligence:
//   465  → Implicit SSL (SMTPS) — secure connection from start
//   587  → Explicit STARTTLS — starts plain, upgrades to TLS
//   25   → Plain SMTP with STARTTLS on upgrade
//   Other → Defaults to STARTTLS behavior
// ──────────────────────────────────────────────────────────────────────────
function createDynamicTransporter(smtp: any) {
  const port = Number(smtp.port || 587);
  
  let transportConfig: any = {
    host: smtp.host,
    port,
    auth: {
      user: smtp.email,
      pass: smtp.password,
    },
    connectionTimeout: 10000,  // 10 second timeout (prevents infinite hang)
    socketTimeout: 10000,      // Socket timeout
  };

  // ═════════════════════════════════════════════════════════════════════
  // SMART PORT DETECTION: Auto-configure based on standard SMTP ports
  // ═════════════════════════════════════════════════════════════════════
  if (port === 465) {
    // ────────────────────────────────────────────────────────────────────
    // Port 465: Implicit SSL (SMTPS)
    // Standard for many corporate mail servers, Microsoft Exchange, etc.
    // TLS connection established BEFORE SMTP handshake.
    // ────────────────────────────────────────────────────────────────────
    transportConfig.secure = true;
    transportConfig.tls = { rejectUnauthorized: false };
    // DO NOT set requireTLS for 465 (it's already implicit)
    
  } else if (port === 587 || port === 25) {
    // ────────────────────────────────────────────────────────────────────
    // Port 587: Explicit STARTTLS (standard for Gmail, Outlook, etc.)
    // Port 25: Plain SMTP with STARTTLS upgrade
    // Connection starts plain, then UPGRADED to TLS via STARTTLS command.
    // ────────────────────────────────────────────────────────────────────
    transportConfig.secure = false;      // Start as plain SMTP
    transportConfig.requireTLS = true;   // MANDATORY TLS upgrade
    transportConfig.tls = {
      rejectUnauthorized: false,  // Allow self-signed certificates
    };
    
  } else {
    // ────────────────────────────────────────────────────────────────────
    // Fallback for custom/non-standard ports
    // Assumes STARTTLS model (most modern mail servers)
    // ────────────────────────────────────────────────────────────────────
    transportConfig.secure = port === 465;
    transportConfig.requireTLS = port !== 465;
    transportConfig.tls = { rejectUnauthorized: false };
  }

  return nodemailer.createTransport(transportConfig);
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

  // JSON + URL-encoded body parsing
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

  // ──────────────────────────────────────────────────────────────────────────
  // ✅ REFACTORED: SEND EMAIL (DYNAMIC TRANSPORTER)
  // ──────────────────────────────────────────────────────────────────────────
  // Changes:
  //   1. Uses createDynamicTransporter() instead of cached getTransporter()
  //   2. Creates FRESH transporter every call
  //   3. 10-second connection timeout
  //   4. Immediate error response (prevents "Sending..." hang)
  // ──────────────────────────────────────────────────────────────────────────
  app.post('/api/send-email', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const to      = sanitizeStr(raw.to, 254);
    const subject = sanitizeStr(raw.subject, 200);
    const html    = sanitizeStr(raw.html, 50000);
    const { smtpSettings } = raw;
    
    // Input validation
    if (!to || !subject || !html) {
      return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
    }
    if (!isValidEmail(to)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    
    const smtp = smtpSettings || { isEnabled: false };
    
    // SMTP not configured? Skip gracefully
    if (!smtp.isEnabled || !smtp.host || !smtp.email || !smtp.password) {
      console.log(`[EMAIL SKIPPED] SMTP not configured → ${to} | ${subject}`);
      return res.status(200).json({
        success: true,
        simulated: true,
        message: 'SMTP not configured — email skipped. Configure SMTP in Admin → Settings → SMTP.',
      });
    }

    try {
      // ✅ CREATE FRESH TRANSPORTER EVERY TIME (not cached)
      const transporter = createDynamicTransporter(smtp);

      const info = await transporter.sendMail({
        from: `"${smtp.fromName || 'Store'}" <${smtp.email}>`,
        to,
        subject,
        html,
        headers: { 'X-Priority': '1', 'X-Mailer': 'E-Shop Mailer v5.6' },
      });

      console.log(`[EMAIL SENT] To: ${to} | MessageID: ${info.messageId}`);
      return res.status(200).json({
        success: true,
        messageId: info.messageId,
      });

    } catch (err: any) {
      // ✅ IMMEDIATE ERROR RESPONSE (prevents UI hang)
      console.error('[EMAIL ERROR]', err.message, err.code);
      
      // Provide helpful debugging info based on error type
      let hint = 'Check SMTP credentials in Admin → Settings → SMTP';
      if (err.code === 'ECONNREFUSED') {
        hint = 'Connection refused. Check SMTP host & port. Verify firewall/provider allows outbound SMTP.';
      } else if (err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
        hint = 'Connection timeout. SMTP server not responding. Check host, port, and network connectivity.';
      } else if (err.message?.includes('Invalid login') || err.message?.includes('authentication')) {
        hint = 'Auth failed. Verify email & password in Admin → Settings → SMTP.';
      } else if (err.message?.includes('550') || err.message?.includes('5.7')) {
        hint = 'SMTP rejected the message. Check sender email address and relay settings.';
      }

      return res.status(500).json({
        success: false,
        error: err.message,
        code: err.code || 'UNKNOWN',
        hint,
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
      return res.status(429).json({ error: 'Too many SMS requests. Wait before retrying.' });
    }
    try {
      const accountSid = ts.accountSid;
      const authToken = ts.authToken;
      const fromNumber = ts.fromNumber;
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const res2 = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: fromNumber, Body: message }).toString(),
      });
      const data: any = await res2.json();
      if (data.sid) {
        console.log(`[SMS SENT] To: ${to} | SID: ${data.sid}`);
        return res.json({ success: true, messageSid: data.sid });
      }
      return res.status(502).json({ success: false, error: data.message || 'SMS API error', detail: data });
    } catch (err: any) {
      console.error('[SMS ERROR]', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // ✅ REFACTORED: SEND VERIFICATION EMAIL (DYNAMIC TRANSPORTER)
  // ──────────────────────────────────────────────────────────────────────────
  // Changes:
  //   1. Uses createDynamicTransporter() instead of cached getTransporter()
  //   2. Creates FRESH transporter every call
  //   3. 10-second connection timeout
  //   4. Immediate error response (prevents "Sending..." hang)
  // ──────────────────────────────────────────────────────────────────────────
  app.post('/api/send-verification', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const email     = sanitizeStr(raw.email, 254);
    const token     = sanitizeStr(raw.token, 200);
    const storeName = sanitizeStr(raw.storeName, 100);
    const { smtpSettings } = raw;
    
    // Input validation
    if (!email || !token) {
      return res.status(400).json({ error: 'Missing email or token' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    
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
    
    // SMTP not configured? Skip gracefully
    if (!smtp.isEnabled || !smtp.host || !smtp.email || !smtp.password) {
      console.log(`[VERIFY SKIPPED] SMTP not configured → ${email} | Token: ${token}`);
      return res.status(200).json({
        success: true,
        simulated: true,
        message: 'SMTP not configured — verification email skipped.',
      });
    }

    try {
      // ✅ CREATE FRESH TRANSPORTER EVERY TIME (not cached)
      const transporter = createDynamicTransporter(smtp);

      await transporter.sendMail({
        from: `"${smtp.fromName || storeName || 'Store'}" <${smtp.email}>`,
        to: email,
        subject: `Verify your ${storeName || 'E-Shop'} account`,
        html,
      });

      console.log(`[VERIFY EMAIL SENT] To: ${email} | Token: ${token.substring(0, 10)}...`);
      return res.status(200).json({
        success: true,
        message: 'Verification email sent successfully.',
      });

    } catch (err: any) {
      // ✅ IMMEDIATE ERROR RESPONSE (prevents UI hang)
      console.error('[VERIFY EMAIL ERROR]', err.message, err.code);
      
      let hint = 'Check SMTP credentials in Admin → Settings → SMTP';
      if (err.code === 'ECONNREFUSED') {
        hint = 'Connection refused. Check SMTP host & port.';
      } else if (err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
        hint = 'Connection timeout. SMTP server not responding.';
      } else if (err.message?.includes('authentication')) {
        hint = 'Auth failed. Verify email & password.';
      }

      return res.status(500).json({
        success: false,
        error: err.message,
        code: err.code || 'UNKNOWN',
        hint,
      });
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
  // All handlers read merchant credentials from req.body (admin-panel CMS)
  // ==========================================================================

  // --- SSLCOMMERZ ----
  app.post('/api/sslcommerz/init', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const amount = Number(raw.amount || 0);
    const txnId = sanitizeStr(raw.txnId, 50);
    const email = sanitizeStr(raw.email, 254);
    const phone = sanitizeStr(raw.phone, 20);
    const name = sanitizeStr(raw.name, 100);
    const storeName = sanitizeStr(raw.storeName, 100);
    const { sslSettings } = raw;

    if (!amount || amount <= 0 || !txnId || !email || !phone) {
      return res.status(400).json({ error: 'Missing/invalid required fields' });
    }

    const ssl = sslSettings || { isEnabled: false };
    if (!ssl.isEnabled || !ssl.storeId || !ssl.storePassword) {
      console.log(`[SSLCOMMERZ SKIPPED] Not configured`);
      return res.json({ success: true, simulated: true, message: 'SSLCommerz not configured.' });
    }

    try {
      const storeId = ssl.storeId;
      const storePassword = ssl.storePassword;
      const postUrl = ssl.isLive ? 'https://securepay.sslcommerz.com/gwprocess/v4/api.php' : 'https://sandbox.sslcommerz.com/gwprocess/v4/api.php';
      const body = new URLSearchParams({
        store_id: storeId,
        store_passwd: storePassword,
        total_amount: amount.toString(),
        currency: 'BDT',
        tran_id: txnId,
        success_url: `${req.protocol}://${req.get('host')}/api/sslcommerz/callback`,
        fail_url: `${req.protocol}://${req.get('host')}/api/sslcommerz/callback`,
        cancel_url: `${req.protocol}://${req.get('host')}/api/sslcommerz/callback`,
        cus_name: name || 'Customer',
        cus_email: email || 'customer@example.com',
        cus_phone: phone,
        cus_add1: 'Dhaka',
        cus_city: 'Dhaka',
        cus_state: 'Dhaka',
        cus_postcode: '1000',
        cus_country: 'Bangladesh',
        shipping_method: 'NO',
        product_name: storeName || 'E-Shop Purchase',
        product_category: 'E-Commerce',
        product_profile: 'general',
      });

      const sslRes = await fetch(postUrl, { method: 'POST', body });
      const data: any = await sslRes.json();

      if (data.status === 'FAILED') {
        console.error('[SSLCOMMERZ ERROR]', data.failedreason);
        return res.status(502).json({ error: data.failedreason || 'SSLCommerz payment initiation failed' });
      }

      if (data.GatewayPageURL) {
        console.log(`[SSLCOMMERZ INIT] Txn: ${txnId} | URL: ${data.GatewayPageURL.substring(0, 50)}...`);
        return res.json({ success: true, redirectUrl: data.GatewayPageURL, sessionKey: data.sessionkey });
      }

      return res.status(502).json({ error: 'No redirect URL from SSLCommerz', response: data });
    } catch (err: any) {
      console.error('[SSLCOMMERZ INIT ERROR]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  app.all('/api/sslcommerz/callback', async (req: Request, res: Response) => {
    const raw = (req.method === 'POST') ? req.body : req.query;
    const status = sanitizeStr(raw.status, 20);
    const txnId = sanitizeStr(raw.tran_id, 50);
    const sessionKey = sanitizeStr(raw.sessionkey, 100);

    console.log(`[SSLCOMMERZ CALLBACK] Status: ${status} | Txn: ${txnId}`);

    if (status === 'VALIDATED' || status === 'PROCESSING') {
      return res.redirect(302, `/?ssl_txn=${txnId}&ssl_session=${sessionKey}&ssl_status=success`);
    } else if (status === 'FAILED') {
      return res.redirect(302, `/?ssl_status=failed&ssl_txn=${txnId}`);
    } else {
      return res.redirect(302, `/?ssl_status=cancelled&ssl_txn=${txnId}`);
    }
  });

  // --- STRIPE ----
  app.post('/api/stripe/create-payment-intent', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const amount = Number(raw.amount || 0);
    const currency = sanitizeStr(raw.currency, 10).toLowerCase() || 'usd';
    const { stripeSettings } = raw;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const stripe = stripeSettings || { isEnabled: false };
    if (!stripe.isEnabled || !stripe.secretKey) {
      console.log(`[STRIPE SKIPPED] Not configured`);
      return res.json({ success: true, simulated: true, message: 'Stripe not configured.' });
    }

    try {
      // Convert amount to cents
      const amountCents = Math.round(amount * 100);

      const body = new URLSearchParams({
        amount: amountCents.toString(),
        currency,
        payment_method_types: 'card',
      });

      const stripeRes = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${stripe.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      });

      const data: any = await stripeRes.json();

      if (data.error) {
        console.error('[STRIPE ERROR]', data.error.message);
        return res.status(502).json({ error: data.error.message });
      }

      console.log(`[STRIPE PI CREATED] ID: ${data.id} | Amount: ${amount} ${currency}`);
      return res.json({ success: true, clientSecret: data.client_secret, paymentIntentId: data.id });
    } catch (err: any) {
      console.error('[STRIPE CREATE PI ERROR]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // --- RAZORPAY ----
  app.post('/api/razorpay/create-order', async (req: Request, res: Response) => {
    const raw = req.body || {};
    const amount = Number(raw.amount || 0);
    const email = sanitizeStr(raw.email, 254);
    const phone = sanitizeStr(raw.phone, 20);
    const { razorpaySettings } = raw;

    if (!amount || amount <= 0 || !email || !phone) {
      return res.status(400).json({ error: 'Missing/invalid required fields' });
    }

    const rz = razorpaySettings || { isEnabled: false };
    if (!rz.isEnabled || !rz.keyId || !rz.keySecret) {
      console.log(`[RAZORPAY SKIPPED] Not configured`);
      return res.json({ success: true, simulated: true, message: 'Razorpay not configured.' });
    }

    try {
      const auth = Buffer.from(`${rz.keyId}:${rz.keySecret}`).toString('base64');
      const rzRes = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: Math.round(amount * 100),
          currency: 'INR',
          receipt: `receipt_${Date.now()}`,
        }),
      });

      const data: any = await rzRes.json();

      if (data.error) {
        console.error('[RAZORPAY ERROR]', data.error.description);
        return res.status(502).json({ error: data.error.description });
      }

      console.log(`[RAZORPAY ORDER] ID: ${data.id} | Amount: ${amount} INR`);
      return res.json({
        success: true,
        orderId: data.id,
        amount: data.amount,
        currency: data.currency,
        keyId: rz.keyId,
      });
    } catch (err: any) {
      console.error('[RAZORPAY CREATE ORDER ERROR]', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Vite / Static Files (Must be last)
  // ─────────────────────────────────────────────────────────────────────────
  let vite: any = null;
  if (!isProd) {
    vite = await createViteServer({ server: { middlewareMode: true } });
    app.use(vite.middlewares);
  } else {
    const staticPath = path.join(__dirname, 'dist');
    app.use(express.static(staticPath, { maxAge: '1h' }));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(staticPath, 'index.html'));
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Start Server
  // ─────────────────────────────────────────────────────────────────────────
  app.listen(PORT, () => {
    console.log(`🚀 Fruitopia Server running on http://localhost:${PORT}`);
    console.log(`📧 SMTP Email: Dynamic (Fresh transporter per send)`);
    console.log(`🔒 Port Detection: Smart (465/587/25 auto-config)`);
    console.log(`⏱️  Connection Timeout: 10 seconds`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});