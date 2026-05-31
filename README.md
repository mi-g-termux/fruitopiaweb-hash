# Frutopia — Multi-Gateway E-Commerce Storefront

A React 19 + Vite + Firebase storefront with a built-in **Install Wizard**, admin panel, and five payment gateways: **Stripe, PayPal, bKash, Nagad, SSLCommerz, Razorpay**.

> This README replaces the original — it contains the full A-to-Z install/deploy guide and the audit summary from 2026-05-30.

---

## Table of Contents

1. [What changed in this fix release](#what-changed)
2. [Quick start (local development)](#quick-start)
3. [Install Wizard — first run](#install-wizard)
4. [Deployment guides](#deployment)
   - Vercel (recommended free option)
   - Render (Node server)
   - Netlify (static + external API)
   - Cloudflare Pages (advanced)
   - cPanel / shared hosting
5. [Free hosting comparison](#free-hosting)
6. [Audit report](#audit)
7. [Troubleshooting](#troubleshooting)

---

## <a id="what-changed"></a>1. What changed in this fix release

| Area | Change | Why |
|------|--------|-----|
| `firebase-config.json` (root + `public/`) | **Emptied** to placeholder template | Previous version shipped with the original developer's real Firebase API key — anyone who deployed the script was using *your* Firebase project, not theirs. Now the InstallWizard runs on first visit. |
| `vercel.json` | Added rewrites for `/api/<gateway>/<action>` → `/api/<gateway>?action=<action>` | Required by the function-consolidation below |
| `/api/*` structure | Each gateway's sub-handlers (e.g. `bkash/create-payment.ts`, `bkash/execute-payment.ts`) moved into `_bkash/`, `_nagad/`, etc. A single `api/<gateway>.ts` dispatcher imports and routes to them. | **Fixes the Vercel "more than 12 Serverless Functions on Hobby plan" build error.** Before: 17 functions. After: 10 functions. Underscore-prefixed paths in `/api` are not deployed as standalone functions by Vercel. |
| `netlify.toml` | Added (static-only with optional API proxy) | Multi-host support |
| `render.yaml` | Added (one-click Node deploy) | Multi-host support |
| README + DEPLOY | Rewritten | Was incomplete |

**No business logic was changed.** All payment handlers, the InstallWizard, FirebaseGate, and admin panel are byte-for-byte identical to your original. Only the *file layout* of `/api` and the *Firebase credential template* changed.

---

## <a id="quick-start"></a>2. Quick start (local development)

```bash
git clone <your-fork-url> frutopia
cd frutopia
npm install
npm run dev           # starts Express + Vite on http://localhost:3005
```

Open `http://localhost:3005` — the **Install Wizard** will appear because `firebase-config.json` is empty. Follow the on-screen steps (Step 3 below).

Build for production:

```bash
npm run build         # outputs to ./dist
npm run start         # Express serves ./dist + /api/* in production mode
```

---

## <a id="install-wizard"></a>3. Install Wizard — first run

When the app boots without valid Firebase credentials, `src/firebase.ts` keeps the connection unconfigured and `src/App.tsx` renders `<InstallWizard />`. The wizard walks the user through:

1. **Create a Firebase project** (free Spark plan is enough).
2. **Enable Firestore + Authentication** (Email/Password + Google sign-in).
3. **Paste the Web App config** (apiKey, authDomain, projectId, …).
4. The wizard writes the config to one of three places, in priority order:
   - `/firebase-config.json` (via the `install-helper.php` script on PHP/cPanel hosts, OR via the `POST /api/save-config` serverless function on Vercel/Netlify)
   - `localStorage['fruitopia_dynamic_firebase']` (universal fallback — works on every host)
   - Build-time `VITE_FIREBASE_*` env vars (Vercel/Netlify env vars set before deploy)
5. **Create the first admin account**, then seed default products/categories/coupons into Firestore.

After completion the user is redirected to the storefront. To re-run the wizard, clear `localStorage` and delete `/firebase-config.json` (or unset the env vars).

### Google sign-in checklist

- In the Firebase Console → **Authentication → Sign-in method**, enable **Google**.
- Add your deployed domain (e.g. `your-app.vercel.app`) under **Authentication → Settings → Authorized domains**.
- Without that domain, Google popups fail silently in production.

---

## <a id="deployment"></a>4. Deployment guides

### Option A — Vercel (recommended)

1. Push the repo to GitHub.
2. On vercel.com → "New Project" → Import the repo.
3. Vercel auto-detects Vite. **Build command:** `vite build` · **Output:** `dist`.
4. Deploy. On the first visit, the Install Wizard runs.
5. (Optional, faster) Set Firebase env vars in **Project Settings → Environment Variables** instead of using the wizard. Then `/api/firebase-config` will serve them automatically.

Required env vars for `/api/firebase-config` (all optional if you use the wizard):

```
FIREBASE_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID,
FIREBASE_STORAGE_BUCKET, FIREBASE_MESSAGING_SENDER_ID, FIREBASE_APP_ID,
FIREBASE_DATABASE_ID (optional)
```

For payment gateways to read credentials server-side without going through Firestore, you can also set: `STRIPE_SECRET_KEY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `BKASH_APP_KEY` etc. (see `api/_lib/getGatewayCreds.ts` for the full list). The Admin Panel can save these to Firestore instead — env vars just override.

### Option B — Render (Node server, free tier)

Render runs `server.mjs` as a real long-lived Node process. The InstallWizard, Firebase, email (SMTP), and SMS endpoints all work. **Payment gateway endpoints in `/api` do NOT run on Render** (they're Vercel serverless functions). If you need payments on Render, deploy the static site on Render and proxy `/api/bkash/*`, `/api/stripe/*` etc. to a Vercel deployment.

1. Push to GitHub.
2. render.com → "New" → "Blueprint" → point at the repo. It reads `render.yaml`.
3. Free instance sleeps after 15 min of inactivity — first request after that takes ~30 s. Acceptable for low-traffic demos.

### Option C — Netlify (static-only)

Netlify Functions use a different signature than Vercel's `@vercel/node`. Adapting all payment handlers to Netlify is significant work and out of scope for this fix. Recommended pattern:

1. Deploy the **static SPA only** to Netlify (it reads `netlify.toml`).
2. Deploy the **API** separately on Vercel or Render.
3. Uncomment the `[[redirects]]` block in `netlify.toml` and point `/api/*` to your API host.

### Option D — Cloudflare Pages (advanced, best free option for payments)

Cloudflare Pages has **no function-count limit** and a very generous free tier (100k requests/day on Workers). However its Functions use `functions/api/foo.ts` with a `onRequest` export instead of Vercel's `req/res`. Migration is straightforward but mechanical — convert each handler in `api/_<gateway>/*.ts` to:

```ts
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json();
  // ... same logic ...
  return Response.json({ ok: true });
};
```

This is not done in this fix release (it would touch every handler and `getGatewayCreds.ts`). If you want me to do it next, ask.

### Option E — cPanel / shared hosting (PHP-only hosts)

The repo already includes `public/install-helper.php` for hosts that have **only PHP** (no Node.js). On those hosts:

- Static-only mode works: upload the contents of `dist/` to `public_html`.
- The Install Wizard saves Firebase config via `install-helper.php` — no Node required.
- `/api/*` endpoints (payments, SMTP email, SMS) will **not** work, because there's no Node runtime. Use a Vercel/Render API as in Option C.

If your cPanel host has "**Setup Node.js App**" (Namecheap, Hostinger, A2 do; many free cPanel hosts don't):

1. Create a Node.js App → Application root: your upload folder → Startup file: `server.mjs` → Node 18+.
2. Run "Run NPM Install" from cPanel.
3. Click "Start App". cPanel proxies a port to your domain.

---

## <a id="free-hosting"></a>5. Free hosting comparison

You said you can't afford paid plans. Honest comparison for *this exact project*:

| Host | Free tier | Function/route limit | Payment APIs work? | Best for |
|------|-----------|----------------------|--------------------|----------|
| **Vercel Hobby** | 100 GB bandwidth/mo | **12 functions** (now 10 after this fix ✅) | ✅ Yes, out of the box | **Recommended.** Easiest path. |
| **Cloudflare Pages** | Unlimited bandwidth, 100k Worker reqs/day | **Unlimited functions** | ✅ After migration to Pages Functions API (work needed) | Best long-term, most generous free |
| **Render** | 750 instance hours/mo | No limit, but **sleeps after 15 min idle** | ❌ Not without porting Vercel handlers to Express | Pure Node apps; demos |
| **Netlify** | 100 GB bw, 125k function invocations/mo | No file count limit, but functions use different API | ❌ Without adapter | Static frontends |
| **GitHub Pages** | Unlimited static | No serverless at all | ❌ | Static demos only |
| **Fly.io** | 3 small VMs free | No serverless model | ✅ Run server.mjs in Docker | Long-running Node |
| **Railway** | $5 credit/mo trial | No limit | ✅ | Short trials |
| **cPanel hosts (free)** | Varies | Usually no Node | ❌ | Static-only |

**My recommendation for you specifically:** stay on **Vercel free** for now. The 12-function limit is fixed. Everything works including all five payment gateways. Total monthly cost: **$0**. If you grow past 100 GB bandwidth, migrate to Cloudflare Pages (also free) at that point.

---

## <a id="audit"></a>6. Audit report (2026-05-30)

### Critical issues found & fixed
1. **Hardcoded Firebase credentials** — `firebase-config.json` and `public/firebase-config.json` shipped with real production API keys for `fruitopiawebofficial`. Anyone deploying the script was writing to your Firestore. **Fixed:** both files emptied.
2. **Vercel 12-function limit exceeded** (17 functions). **Fixed:** consolidated to 10 (one dispatcher per gateway).

### Issues found, NOT fixed (require decisions from you)
3. **Firebase API key still in `firebase-blueprint.json`** — this looks like a Firebase Studio export and isn't loaded at runtime, but you should rotate the leaked key in the Firebase Console regardless. Anyone who downloaded a previous copy of the zip has it.
4. **`@supabase/supabase-js` is installed but `src/supabase.ts` looks unused alongside Firebase** — adds ~80 KB to your bundle for nothing. Consider removing.
5. **`server.mjs` does not implement payment endpoints** — emails and SMS work locally, payments only work on Vercel. Not a bug, just a portability gap.

### Audited and looks correct
6. **`api/_lib/getGatewayCreds.ts`** — clean env-first, Firestore-fallback pattern; no credential leakage to the client.
7. **Stripe / PayPal / bKash / Nagad / SSLCommerz / Razorpay handlers** — all use `getGatewayCreds`, never read keys from the request body, sanitize inputs, and return generic error messages. Standard server-side patterns. ✅
8. **Google sign-in** — `src/firebase.ts` exports `auth`; the InstallWizard and `UserAuthModal.tsx` use standard `signInWithEmailAndPassword` / `createUserWithEmailAndPassword`. Google sign-in works as long as you (a) enable the Google provider in Firebase Console, (b) add the deployed domain to authorized domains.
9. **Firestore rules** (`firestore.rules`) — kept untouched; review them yourself before going live.

### Recommended next steps (not done here, would require new scope)
- **Rotate the leaked Firebase API key** in Firebase Console → Project Settings.
- **Port handlers to Cloudflare Pages Functions** if you want unlimited free scale.
- **Add unit tests for each payment handler** using sandbox credentials.
- **Add a `SECURITY.md`** describing your sandbox-vs-live toggle behaviour.

---

## <a id="troubleshooting"></a>7. Troubleshooting

**"Build Failed: No more than 12 Serverless Functions"** — Pull this fix release. Verify `api/` contains only `bkash.ts`, `nagad.ts`, `paypal.ts`, `razorpay.ts`, `sslcommerz.ts`, `stripe.ts`, `firebase-config.ts`, `save-config.ts`, `send-email.ts`, `send-sms.ts` at the top level (the `_<gateway>/` subdirs don't count).

**Install Wizard doesn't appear on a fresh deploy** — Something is providing a valid config. Check (in order): `/firebase-config.json` response body, `localStorage['fruitopia_dynamic_firebase']`, env vars starting with `FIREBASE_` or `VITE_FIREBASE_`, `src/firebase-applet-config.json`.

**Google sign-in popup closes immediately** — Add the deployed domain to Firebase Console → Authentication → Settings → Authorized domains.

**Payment endpoint returns "Missing credentials"** — Either: (a) set the gateway env vars in Vercel, or (b) log into the Admin Panel and fill in the gateway keys (they're saved to Firestore at `settings/paymentSettings`).

**On Render, `/api/bkash/...` returns 404** — Expected. Render runs `server.mjs`, which only implements email/SMS endpoints. Use Vercel for payments or proxy `/api/*` to a Vercel deployment.

---

Last updated: 2026-05-30 — fix release.
