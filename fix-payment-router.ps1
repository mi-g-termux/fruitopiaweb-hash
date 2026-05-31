# fix-payment-router.ps1
# Run this in PowerShell in your project root
# Right-click PowerShell → "Run as Administrator" (important!)
# Then: .\fix-payment-router.ps1

Write-Host "🚀 Fixing Payment Router..." -ForegroundColor Green
Write-Host ""

# Step 1: Create payment.ts
Write-Host "Step 1: Creating payment.ts router..." -ForegroundColor Blue

$paymentContent = @'
import type { VercelRequest, VercelResponse } from '@vercel/node';

import bkashCreate from './bkash/create-payment';
import bkashExecute from './bkash/execute-payment';
import nagadCreate from './nagad/create-payment';
import nagadVerify from './nagad/verify-payment';
import sslcommerzCreate from './sslcommerz/create-payment';
import sslcommerzIpn from './sslcommerz/ipn';
import razorpayCreate from './razorpay/create-order';
import razorpayVerify from './razorpay/verify-payment';
import paypalCreate from './paypal/create-order';
import paypalCapture from './paypal/capture-order';
import paypalCallback from './paypal/callback';
import stripeCreate from './stripe/create-payment-intent';
import stripeConfirm from './stripe/confirm-payment';

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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const requestId = Math.random().toString(36).slice(2, 8);
  const startTime = Date.now();

  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.status(204).end();
      return;
    }

    const gateway = normalise(req.query.gateway);
    const action  = normalise(req.query.action);

    console.log(`[${requestId}] Payment Router: ${req.method} | gateway=${gateway}, action=${action}`);

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
      console.warn(`[${requestId}] Unknown action for gateway ${gateway}: ${action}`);
      res.status(404).json({
        error: `Unknown action "${action}" for gateway "${gateway}"`,
        available: Object.keys(gatewayActions),
      });
      return;
    }

    console.log(`[${requestId}] Invoking ${gateway}/${action}...`);
    const result = await handler(req, res);

    const elapsed = Date.now() - startTime;
    console.log(`[${requestId}] Success: ${gateway}/${action} completed in ${elapsed}ms`);
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    console.error(`[${requestId}] ERROR after ${elapsed}ms:`, {
      message: err?.message,
      stack: err?.stack,
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

function normalise(value: string | string[] | undefined): string {
  if (!value) return '';
  const str = Array.isArray(value) ? value[0] : value;
  if (typeof str !== 'string') return '';
  return str.trim().toLowerCase();
}
'@

Set-Content -Path "api/payment.ts" -Value $paymentContent -Encoding UTF8
Write-Host "✓ payment.ts created" -ForegroundColor Green

# Step 2: Create proxy files
Write-Host ""
Write-Host "Step 2: Creating 13 proxy files..." -ForegroundColor Blue

# Helper function to create proxy files
function Create-ProxyFile {
    param(
        [string]$Path,
        [string]$Gateway,
        [string]$Action
    )
    
    $content = @"
import type { VercelRequest, VercelResponse } from '@vercel/node';
import paymentHandler from '../payment';
export default function handler(req: VercelRequest, res: VercelResponse) {
  req.query.gateway = '$Gateway';
  req.query.action = '$Action';
  return paymentHandler(req, res);
}
"@
    
    $dir = Split-Path -Path $Path -Parent
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    
    Set-Content -Path $Path -Value $content -Encoding UTF8
}

# BKASH
Create-ProxyFile "api/bkash/create-payment.ts" "bkash" "create-payment"
Create-ProxyFile "api/bkash/execute-payment.ts" "bkash" "execute-payment"

# NAGAD
Create-ProxyFile "api/nagad/create-payment.ts" "nagad" "create-payment"
Create-ProxyFile "api/nagad/verify-payment.ts" "nagad" "verify-payment"

# SSLCOMMERZ
Create-ProxyFile "api/sslcommerz/create-payment.ts" "sslcommerz" "create-payment"
Create-ProxyFile "api/sslcommerz/ipn.ts" "sslcommerz" "ipn"

# RAZORPAY
Create-ProxyFile "api/razorpay/create-order.ts" "razorpay" "create-order"
Create-ProxyFile "api/razorpay/verify-payment.ts" "razorpay" "verify-payment"

# PAYPAL
Create-ProxyFile "api/paypal/create-order.ts" "paypal" "create-order"
Create-ProxyFile "api/paypal/capture-order.ts" "paypal" "capture-order"
Create-ProxyFile "api/paypal/callback.ts" "paypal" "callback"

# STRIPE
Create-ProxyFile "api/stripe/create-payment-intent.ts" "stripe" "create-payment-intent"
Create-ProxyFile "api/stripe/confirm-payment.ts" "stripe" "confirm-payment"

Write-Host "✓ All 13 proxy files created" -ForegroundColor Green

# Step 3: Create vercel.json
Write-Host ""
Write-Host "Step 3: Updating vercel.json..." -ForegroundColor Blue

$vercelContent = @'
{
  "buildCommand": "vite build",
  "outputDirectory": "dist",
  "rewrites": [
    { "source": "/firebase-config.json", "destination": "/api/firebase-config" },
    { "source": "/api/bkash/:action", "destination": "/api/payment?gateway=bkash&action=:action" },
    { "source": "/api/nagad/:action", "destination": "/api/payment?gateway=nagad&action=:action" },
    { "source": "/api/sslcommerz/:action", "destination": "/api/payment?gateway=sslcommerz&action=:action" },
    { "source": "/api/razorpay/:action", "destination": "/api/payment?gateway=razorpay&action=:action" },
    { "source": "/api/paypal/:action", "destination": "/api/payment?gateway=paypal&action=:action" },
    { "source": "/api/stripe/:action", "destination": "/api/payment?gateway=stripe&action=:action" },
    { "source": "/api/(.*)", "destination": "/api/$1" },
    { "source": "/((?!api/|.*\\..+$).*)", "destination": "/index.html" }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ]
}
'@

Set-Content -Path "vercel.json" -Value $vercelContent -Encoding UTF8
Write-Host "✓ vercel.json updated" -ForegroundColor Green

# Summary
Write-Host ""
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "✅ ALL FILES FIXED!" -ForegroundColor Green
Write-Host "════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host ""
Write-Host "Files created/updated:" -ForegroundColor Cyan
Write-Host "  ✓ api/payment.ts (router)" -ForegroundColor Green
Write-Host "  ✓ api/bkash/create-payment.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ api/bkash/execute-payment.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ api/nagad/create-payment.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ api/nagad/verify-payment.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ api/sslcommerz/create-payment.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ api/sslcommerz/ipn.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ api/razorpay/create-order.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ api/razorpay/verify-payment.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ api/paypal/create-order.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ api/paypal/capture-order.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ api/paypal/callback.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ api/stripe/create-payment-intent.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ api/stripe/confirm-payment.ts (proxy)" -ForegroundColor Green
Write-Host "  ✓ vercel.json (updated)" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. git add api/ vercel.json" -ForegroundColor Cyan
Write-Host "  2. git commit -m 'fix: payment router 500 error'" -ForegroundColor Cyan
Write-Host "  3. vercel --prod" -ForegroundColor Cyan
Write-Host "  4. Check logs: vercel logs --follow" -ForegroundColor Cyan
Write-Host ""
Write-Host "Done! 🚀" -ForegroundColor Green
