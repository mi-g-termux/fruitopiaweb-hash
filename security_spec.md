# Firebase Security Specification & TDD Spec

This specification outlines the data invariants, security boundaries, and validation guards for our ecommerce CMS platform, including threat vectors ("The Dirty Dozen") and the test specifications.

## 1. Core Data Invariants

- **Branding and Settings**: Write operations to `settings/*` are restricted strictly to Authenticated Admin Users. Normal visitors or guests can only read public configurations.
- **Stock Depletion & Price Integrity**: Customers can never update a product's details directly. Buying a product decreases stock through the checkout service, but users cannot spoof product prices or set discount fields.
- **Order Protection & Attribution**: Once placed, an order's `orderNumber`, `paymentMethod`, and pricing items are immutable. A customer can read their own order under their authenticated UID, while administrators have full tracking read/status write access.
- **Coupon System Validation**: Public visitors can only read coupons using exact lookups during checkout validation (reads are allowed if checking active state, but write operations are strictly blocked to prevent unauthorized creations/deletions).

---

## 2. The "Dirty Dozen" Threat Payloads

The following payloads represent malicious requests designed to overwrite data state, spoof roles, inject massive payloads, or leak private contact info. Each of these must be blocked returning `PERMISSION_DENIED` by the security rules:

1. **Self-Admin Spoofing**: A user tries to write a document inside `settings/adminSettings` to change the password or username.
2. **Settings Escalation**: A user attempts to disable global bKash instructions or inject custom payment address targets inside `settings/paymentSettings`.
3. **Malicious Product Creation**: A guest attempts to bypass products listings and write a mock product `/products/p_hack` with price `0.01` and unlimited stock.
4. **Negative Pricing Insertion**: A user tries to create an order `/orders/o_hack` where the item list total is positive, but the discount is modified to exceed the total size, leading to negative billed amounts.
5. **Unauthorized Status Escalation**: A buyer attempts to patch an existing order at `/orders/order_123` changing `orderStatus` to `'Delivered'` or `paymentStatus` to `'Paid'`.
6. **Coupon Spam Creation**: An unauthorized visitor issues a setDoc block to `/coupons/FREE99` setting the discount value to `100%`.
7. **Bypassing Mandatory Keys**: A malicious script attempts to write a product without mandatory properties (like `price` or `stock`) to test schema vulnerabilities.
8. **PII Data Scrape**: A registered customer attempts to pull list scans on `/orders` without specifying their email/UID filter parameter, attempting to download private physical shipping addresses.
9. **Junk Character ID Attack**: A script fires a writing block with a 2MB binary string as a product ID (ID poisoning).
10. **Shadow Field Inject**: A user attempts to write comments to reviews containing hidden privileged administration properties (like `isAdmin: true` or `isApproved: true`).
11. **Future Stamp Tampering**: A user attempts to send an order timestamp with a manufactured past or future date, bypassing `request.time` rules.
12. **Malicious Review Approvals**: A user updates a review with `isApproved: true` to bypass moderation logic.

---

## 3. Test Runner Design

Our security rules verify assertions statically and reject operations immediately if credentials, structure, or fields fail to meet policies. The actual runtime testing is governed by the `firestore.rules` compiler and tests.
