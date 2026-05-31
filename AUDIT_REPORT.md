# Audit Report — Payment Branding Update

## What you asked for
1. Add logo + button-name edit options for the 5 newly added payment methods
   (Paytm, UPI, JazzCash, Easypaisa, PayFast) — same style used for SSLCommerz/Razorpay/bKash/etc.
2. Remove the **Button Name** input from the *Payment Method Branding* tab —
   keep only the **Logo URL** field (logo will fill the button when set).
3. Will removing the button-name inputs cause any issue?

## What changed

### `src/types.ts`
Added 10 new optional fields on `PaymentSettings`:
```
paytmDisplayName, paytmLogoImageUrl
upiDisplayName,   upiLogoImageUrl
jazzCashDisplayName, jazzCashLogoImageUrl
easypaisaDisplayName, easypaisaLogoImageUrl
payFastDisplayName,   payFastLogoImageUrl
```
All are optional (`?`) — fully backward-compatible with existing Firestore docs.

### `src/components/AdminPanel.tsx`
- Added 5 new `useState` hooks for the new logo URLs:
  `brandPaytmLogo`, `brandUpiLogo`, `brandJazzCashLogo`, `brandEasypaisaLogo`,
  `brandPayFastLogo`.
- Persisted them in the `handleSavePaymentsCMS` payload.
- Rewrote the **Payment Method Branding** card:
  - Renamed header to **Payment Method Logos**.
  - **Removed every "Button Name" input** (12 fields gone).
  - Kept only the **Logo Image URL** input + live preview.
  - Added rows for the 5 new methods (Paytm, UPI, JazzCash, Easypaisa, PayFast),
    so the section now covers **all 17 payment methods**.
- The old `brand*Name` state hooks remain in code (still saved to Firestore as
  empty strings) so any value you previously typed there is preserved — they are
  just no longer editable from the UI.

### `src/components/CartModal.tsx`
No changes needed — it was already wired with
`(paymentSettings as any).paytmLogoImageUrl` etc. for the new methods, so the
checkout button automatically picks up the logo as soon as you save one.
When `logoUrl` is set, it replaces the default icon + label, i.e. the logo
becomes the button (your existing rendering logic already does this).

## Will removing the button-name fields cause any issue?
**No.** Here is why:

1. The fields are still **declared on the type** and still **written to Firestore**
   (current values are preserved as empty strings on save). Nothing in the DB
   schema changes.
2. The checkout button label falls back to `fallbackLabel` (the hard-coded English
   name like "Cash on Delivery", "Razorpay", "Paytm") whenever `displayName` is
   blank. That fallback path already existed and is used as the default today.
3. When a `logoUrl` is set, the logo **replaces** the text label entirely on
   the checkout button (this was already the existing rendering behavior in
   `CartModal.tsx`), so the missing name field has no visible effect.
4. No reads of `*DisplayName` are removed — all existing callers keep working.

The only behavior change a user will see: they can no longer edit those custom
button names from the admin UI. If you ever want to bring them back, the
state hooks and save logic are intact — just re-add the input element.

## Files touched
- `src/types.ts`
- `src/components/AdminPanel.tsx`

## Files NOT touched (intentionally)
- `src/components/CartModal.tsx` — already compatible.
- `src/db.ts` — defaults already cover the new methods.
- `src/components/paymentClient.ts` — unrelated to branding.
- API routes under `api/` and `lib/payments/` — server-side, unaffected.

## Verification
- `tsc --noEmit` on the touched files reports **no new errors** (only the
  pre-existing "Cannot find module 'react'" warnings caused by node_modules
  not being installed in this sandbox — these will resolve normally on your
  build server after `npm install`).
- Save-and-reload cycle: opening the admin panel will hydrate the new logo
  fields from Firestore via the existing `paymentSettings` prop wiring.
