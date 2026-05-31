/**
 * Vercel Serverless Function: /api/send-email
 *
 * REFACTORED: Dynamic SMTP configuration
 * - Creates fresh Nodemailer transporter every call (no caching)
 * - Smart port detection (465 vs 587 vs 25)
 * - 10-second connection timeout
 * - Immediate error responses (prevents UI hangs)
 *
 * Gmail SMTP setup:
 *   host: smtp.gmail.com
 *   port: 587
 *   email: yourname@gmail.com
 *   password: YOUR_APP_PASSWORD  ← NOT your Gmail login password!
 *             (Google Account → Security → 2-Step Verification → App Passwords)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';

interface InboundAttachment {
  filename?: string;
  content?: string; // base64 (without data: URI prefix)
  contentType?: string;
}

/**
 * Create a FRESH Nodemailer transporter with dynamic port/security detection.
 * Called EVERY TIME an email needs to be sent — no caching.
 */
function createDynamicTransporter(smtp: any) {
  const port = Number(smtp.port || 587);
  
  let transportConfig: any = {
    host: smtp.host,
    port,
    auth: {
      user: smtp.email,
      pass: smtp.password,
    },
    connectionTimeout: 10000,  // 10 second timeout
    socketTimeout: 10000,
  };

  // Smart port detection: auto-configure TLS based on port
  if (port === 465) {
    // Implicit SSL (SMTPS)
    transportConfig.secure = true;
    transportConfig.tls = { rejectUnauthorized: false };
  } else if (port === 587 || port === 25) {
    // Explicit STARTTLS
    transportConfig.secure = false;
    transportConfig.requireTLS = true;
    transportConfig.tls = { rejectUnauthorized: false };
  } else {
    // Fallback for custom ports
    transportConfig.secure = port === 465;
    transportConfig.requireTLS = port !== 465;
    transportConfig.tls = { rejectUnauthorized: false };
  }

  return nodemailer.createTransport(transportConfig);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { to, subject, html, smtpSettings, attachments } = req.body || {};

  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, html' });
  }

  const smtp = smtpSettings || { isEnabled: false };

  // If SMTP is not configured, just acknowledge (email skipped)
  if (!smtp.isEnabled || !smtp.host || !smtp.email || !smtp.password) {
    console.log(`[EMAIL SKIPPED] SMTP not configured. Would have sent to: ${to} | Subject: ${subject}`);
    return res.status(200).json({
      success: true,
      simulated: true,
      message: 'SMTP not configured — email skipped. Configure SMTP in Admin → Settings → SMTP.',
    });
  }

  try {
    // ✅ CREATE FRESH TRANSPORTER EVERY TIME (not cached)
    const transporter = createDynamicTransporter(smtp);

    // Normalize attachments: accept only well-formed entries with base64
    // content. Silently drop malformed entries instead of failing the send.
    const normalizedAttachments = Array.isArray(attachments)
      ? attachments
          .filter((a: InboundAttachment) => a && typeof a.content === 'string' && a.content.length > 0)
          .map((a: InboundAttachment) => ({
            filename: a.filename || 'attachment',
            content: a.content as string,
            encoding: 'base64' as const,
            contentType: a.contentType || 'application/octet-stream',
          }))
      : [];

    const info = await transporter.sendMail({
      from: `"${smtp.fromName || 'Store'}" <${smtp.email}>`,
      to,
      subject,
      html,
      attachments: normalizedAttachments.length ? normalizedAttachments : undefined,
    });

    console.log(
      `[EMAIL SENT] To: ${to} | MessageID: ${info.messageId} | Attachments: ${normalizedAttachments.length}`,
    );
    return res.status(200).json({ success: true, messageId: info.messageId });

  } catch (err: any) {
    console.error('[EMAIL ERROR]', err.message, err.code);
    
    // Provide helpful debugging info based on error type
    let hint = 'Check SMTP credentials in Admin → Settings → SMTP';
    if (err.code === 'ECONNREFUSED') {
      hint = 'Connection refused. Check SMTP host & port. Verify firewall/provider allows outbound SMTP.';
    } else if (err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
      hint = 'Connection timeout. SMTP server not responding. Check host, port, and network connectivity.';
    } else if (err.message?.includes('Invalid login') || err.message?.includes('authentication')) {
      hint = 'Auth failed. Verify email & password in Admin → Settings → SMTP. For Gmail: use an App Password.';
    }

    return res.status(500).json({
      success: false,
      error: err.message,
      code: err.code || 'UNKNOWN',
      hint,
    });
  }
}
