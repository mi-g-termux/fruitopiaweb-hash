/**
 * Vercel Serverless Function: /api/save-config
 *
 * Vercel's runtime filesystem is read-only, so we can't write
 * firebase-config.json to disk like cPanel/PHP or a long-running Node
 * server can. Instead this endpoint returns the env-var block the admin
 * needs to paste into Vercel Project Settings → Environment Variables.
 *
 * After they paste it and redeploy, /api/firebase-config (rewritten to
 * /firebase-config.json in vercel.json) returns the real config and the
 * Install Wizard never appears again.
 *
 * GET  → { ok: true }    so probeInstallHelper() detects platform "node"
 * POST → { success: false, needsEnvVars: true, envBlock, vars }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'Fruitopia Vercel save-config endpoint ready.',
      readOnlyFs: true,
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const data = (req.body || {}) as Record<string, string>;
  const required = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
  for (const field of required) {
    if (!data[field] || typeof data[field] !== 'string' || !data[field].trim()) {
      return res.status(400).json({ success: false, message: `Missing required field: "${field}"` });
    }
  }
  if (!data.apiKey.trim().startsWith('AIza')) {
    return res.status(400).json({ success: false, message: 'Invalid apiKey format. Firebase Web API keys start with "AIza".' });
  }

  const vars: Record<string, string> = {
    FIREBASE_API_KEY:            data.apiKey.trim(),
    FIREBASE_AUTH_DOMAIN:        data.authDomain.trim(),
    FIREBASE_PROJECT_ID:         data.projectId.trim(),
    FIREBASE_STORAGE_BUCKET:     data.storageBucket.trim(),
    FIREBASE_MESSAGING_SENDER_ID: data.messagingSenderId.trim(),
    FIREBASE_APP_ID:             data.appId.trim(),
  };
  if (data.databaseId && data.databaseId.trim()) {
    vars.FIREBASE_DATABASE_ID = data.databaseId.trim();
  }

  const envBlock = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n');

  return res.status(200).json({
    success: false,
    needsEnvVars: true,
    vars,
    envBlock,
    message:
      'Vercel filesystem is read-only. Add these environment variables in Vercel ' +
      '→ Project Settings → Environment Variables (Production + Preview), then trigger a redeploy. ' +
      'The Install Wizard will not appear again afterwards.',
  });
}
