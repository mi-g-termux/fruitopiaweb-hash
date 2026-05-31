# 🚀 Fruitopia — Complete Installation Guide

> **Welcome!** This guide walks you through setting up your own Fruitopia e-commerce store from scratch. Follow these steps in order and you'll have a live, multi-device store in about 15 minutes.

---

## 📋 Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Create a Firebase Project](#2-create-a-firebase-project)
3. [Set Up Firebase Services](#3-set-up-firebase-services)
   - [3a. Firestore Database](#3a-firestore-database)
   - [3b. Authentication](#3b-authentication)
   - [3c. Storage](#3c-storage)
4. [Get Your Firebase Credentials](#4-get-your-firebase-credentials)
5. [Install & Run Locally](#5-install--run-locally)
6. [Run the Install Wizard](#6-run-the-install-wizard)
7. [Deploy Firestore Security Rules](#7-deploy-firestore-security-rules)
8. [Configure Storage CORS](#8-configure-storage-cors)
9. [Deploy Your Store](#9-deploy-your-store)
   - [Vercel (Recommended)](#vercel-recommended)
   - [Netlify](#netlify)
   - [cPanel / Shared Hosting](#cpanel--shared-hosting)
   - [VPS / Ubuntu Server](#vps--ubuntu-server)
10. [Post-Deployment Checklist](#10-post-deployment-checklist)

---

## 1. Prerequisites

Before starting, make sure you have these installed on your computer:

| Tool | Version | Check with | Download |
|------|---------|------------|----------|
| **Node.js** | v18+ | `node --version` | [nodejs.org](https://nodejs.org) |
| **npm** | v9+ | `npm --version` | (comes with Node.js) |
| **Git** | any | `git --version` | [git-scm.com](https://git-scm.com) |
| **Firebase CLI** | latest | `firebase --version` | `npm install -g firebase-tools` |
| **Google Cloud SDK** *(optional)* | latest | `gsutil --version` | [cloud.google.com/sdk](https://cloud.google.com/sdk/docs/install) |

> **Note:** For CORS configuration (Step 8), you'll need `gsutil` from the Google Cloud SDK. For most hosting platforms, this is optional — skip it if you're not using image uploads.

---

## 2. Create a Firebase Project

1. Go to the **[Firebase Console](https://console.firebase.google.com)** and click **Create a project** (or **Add project**).

2. Enter a project name (e.g., `My Fruitopia Store`).

3. **Disable Google Analytics** (optional — not needed for this app).

4. Click **Create project** and wait a few seconds.

5. Once created, you'll land on the project **Overview** page.

---

## 3. Set Up Firebase Services

### 3a. Firestore Database

1. In the left sidebar, go to **Build → Firestore Database**.

2. Click **Create database**.

3. Choose **Start in production mode** (recommended).

4. Select a **Cloud Firestore location** closest to your customers (e.g., `us-central`, `europe-west1`, `asia-southeast1`).

5. Click **Done**. Your database is created in about 30 seconds.

### 3b. Authentication

1. In the left sidebar, go to **Build → Authentication**.

2. Click **Get started**.

3. Under **Sign-in providers**, click **Email/Password**.

4. Toggle **Enable** to ON, then click **Save**.

### 3c. Storage

1. In the left sidebar, go to **Build → Storage**.

2. Click **Get started**.

3. Choose **Start in production mode**.

4. Select the same location as your Firestore database.

5. Click **Done**.

6. **Update Storage Security Rules** — click the **Rules** tab and replace the content with:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /images/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

7. Click **Publish**.

---

## 4. Get Your Firebase Credentials

1. In the Firebase Console, click the **gear icon ⚙️** (Project settings) in the top-left.

2. Go to the **General** tab.

3. Scroll to **Your apps** and click the **</> Web** icon (or **Add app → Web** if no app exists yet).

4. **Register your app** — give it a nickname (e.g., "Fruitopia Store") and click **Register app**.

5. You'll see your **firebaseConfig** object. Copy it — it looks like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyC7...",
  authDomain: "my-project.firebaseapp.com",
  projectId: "my-project",
  storageBucket: "my-project.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123..."
};
```

6. Keep this open — you'll paste these values into the Install Wizard in Step 6.

---

## 5. Install & Run Locally

### Clone or Download the Project

**Option A — Using Git:**

```bash
git clone https://github.com/your-repo/fruitopia.git
cd fruitopia
```

**Option B — Download ZIP:**

1. Download the project ZIP file.
2. Extract it to a folder on your computer.
3. Open a terminal in that folder.

### Install Dependencies

```bash
npm install
```

### Start the Dev Server

```bash
npm run dev
```

Your storefront opens at **http://localhost:5173** and the Install Wizard is at **http://localhost:5173/install**.

---

## 6. Run the Install Wizard

The Install Wizard is a 7-step guided setup that connects your store to Firebase.

### Step 1 — Welcome

- Click **Begin Setup**.

### Step 2 — Requirements Check

- The wizard checks your internet connection, browser storage, and Firebase reachability.
- If all three pass with green checkmarks, click **Next →**.
- If any fail, follow the on-screen instructions to resolve (e.g., check your internet connection).

### Step 3 — Firebase Credentials

- Paste the 6 values from your Firebase `firebaseConfig` object (copied in Step 4 above):

| Field | Example Value |
|-------|--------------|
| **API Key** | `AIzaSyC7...` |
| **Auth Domain** | `my-project.firebaseapp.com` |
| **Project ID** | `my-project` |
| **Storage Bucket** | `my-project.appspot.com` |
| **Messaging Sender ID** | `123456789012` |
| **App ID** | `1:123456789012:web:abc...` |

- Click **Test Connection** → it should return a green "✅ Connected successfully!" message.
- Click **Next →**.

### Step 4 — Admin Account

- Create your admin **Username** (e.g., `admin`).
- Create an admin **Password** (minimum 6 characters).
- **Confirm password**.
- Click **Next →**.

### Step 5 — Store Information

- Enter your **Store Name** (e.g., "Fruitopia").
- Optionally add a **Contact Email**, **Currency** (e.g., `USD`), and **Currency Symbol** (e.g., `$`).
- These can all be changed later in the Admin Panel.
- Click **Next →**.

### Step 6 — Installing

- Click **Install Now**.
- The wizard runs 7 sub-steps automatically:

| # | Step | What Happens |
|---|------|-------------|
| 1 | Connecting to Firebase | Hot-swaps the Firebase connection |
| 2 | Saving configuration | Persists credentials to your server |
| 3 | Setting up admin auth | Creates Firebase Auth user for admin |
| 4 | Setting up store data | Seeds sample products, categories, coupons |
| 5 | Creating admin account | Saves admin credentials to Firestore |
| 6 | Saving store settings | Saves currency, contact info, branding |
| 7 | Finalising installation | Writes install_status marker |

- **All 7 steps should complete with green checkmarks.** If any step fails (red ❌), read the error message — most commonly this means Firestore security rules haven't been deployed yet. See Step 7 below.

> **⚠️ If you see "Awaiting manual upload" at Step 2**: The wizard couldn't auto-save credentials to your server (common on localhost). It downloaded a `firebase-config.json` file. Leave the wizard open, put this file in the `public/` folder of your project, then click **"I've uploaded it, Continue →"**.

### Step 7 — Complete 🎉

- You'll see a success screen with a full checklist.
- Click **🏪 Go to Store** to see your live storefront, or **⚙️ Go to Admin Panel** to start managing your store.

---

## 7. Deploy Firestore Security Rules

The Install Wizard seeds data into Firestore. For the app to read/write correctly, the security rules must allow authenticated admin access.

1. **Login to Firebase CLI** (first time):

```bash
firebase login
```

2. In your project folder, **initialize Firebase** (one time):

```bash
firebase init firestore
```

> When prompted, select **Use an existing project** and choose your Firebase project.

3. **Deploy the rules**:

```bash
firebase deploy --only firestore:rules
```

You should see: `✔  Deploy complete!`

> **Why this is important:** The `firestore.rules` file in your project allows unauthenticated reads (for the storefront) but requires authenticated admin for writes. Without deploying these rules, the default "production mode" rules block ALL writes until you authenticate, which means the Install Wizard's data seeding will fail.

---

## 8. Configure Storage CORS

If you want to upload product images and logos (not just emojis), you need to configure CORS for your Firebase Storage bucket.

### Option A — Using Google Cloud SDK (Recommended)

1. Install the **[Google Cloud SDK](https://cloud.google.com/sdk/docs/install)**.

2. Authenticate:

```bash
gcloud auth login
```

3. Set your project:

```bash
gcloud config set project YOUR_PROJECT_ID
```

4. The project already includes a `cors.json` file. Apply it:

```bash
gsutil cors set cors.json gs://YOUR_PROJECT_ID.appspot.com
```

> Replace `YOUR_PROJECT_ID` with your actual Firebase Project ID (found in Firebase Console → Project Settings).

5. Verify it worked:

```bash
gsutil cors get gs://YOUR_PROJECT_ID.appspot.com
```

### Option B — Using Google Cloud Shell (No SDK install)

1. Go to **[Google Cloud Console](https://console.cloud.google.com)**.
2. Click the **>_** (Activate Cloud Shell) icon in the top-right.
3. Run:

```bash
echo '[{"origin":["http://localhost:5173","http://localhost:3000","https://yourdomain.com"],"method":["GET","PUT","POST","DELETE","HEAD"],"responseHeader":["Content-Type","x-goog-meta-*","Authorization","x-goog-*"],"maxAgeSeconds":3600}]' > cors.json
gsutil cors set cors.json gs://YOUR_PROJECT_ID.appspot.com
```

> Replace `YOUR_PROJECT_ID` and add your production domain to the `origin` list.

---

## 9. Deploy Your Store

### Vercel (Recommended — Easiest)

1. Push your project to a GitHub repository.

2. Go to **[vercel.com](https://vercel.com)** and click **Add New → Project**.

3. Import your GitHub repository.

4. Vercel auto-detects Vite — **do not change any settings**.

5. Click **Deploy**.

6. After deployment, visit **`https://your-project.vercel.app/install`** to run the Install Wizard on your live site.

> **SPA routing** is handled automatically via `vercel.json` in the project.

> **Custom domain:** Go to Vercel project → Settings → Domains → add your domain.

### Netlify

**Option A — Drag and Drop (Quickest):**

```bash
npm run build
```

2. Go to **[app.netlify.com](https://app.netlify.com)**.
3. Drag the `dist/` folder onto the deploy zone.
4. Visit **`https://random-name.netlify.app/install`** to run the Install Wizard.

**Option B — Connect GitHub:**

1. In Netlify, click **Add new site → Import an existing project**.
2. Connect your GitHub repo.
3. Set **Build command:** `npm run build`, **Publish directory:** `dist`.
4. Click **Deploy site**.
5. Visit **`/install`** to run the wizard.

> **SPA routing:** The project includes `public/_redirects` with `/* /index.html 200`.

### cPanel / Shared Hosting

1. **Build locally:**

```bash
npm run build
```

2. Open your **cPanel File Manager** (or use FTP/SFTP).

3. Upload the **entire contents** of the `dist/` folder into `public_html/`.

   > ⚠️ Do NOT upload the `dist/` folder itself — upload what's INSIDE it.

4. Also upload `public/.htaccess` into `public_html/`. This file enables SPA routing so page refreshes work correctly.

5. Visit **`https://yoursite.com/install`** to run the Install Wizard.

The wizard uses `install-helper.php` (already in `dist/`) to save your Firebase config.

> **Blank page or 404 on refresh?**  
> Make sure `.htaccess` is in `public_html/` and `mod_rewrite` is enabled (it is on virtually all cPanel hosts by default).

### VPS / Ubuntu Server

```bash
# 1. Build locally
npm run build

# 2. Transfer to your server
scp -r dist/ user@yourserver:/var/www/fruitopia

# 3. On the server, install nginx
sudo apt update && sudo apt install -y nginx

# 4. Create a site config
sudo nano /etc/nginx/sites-available/fruitopia
```

Paste this config (replace `yoursite.com` with your domain):

```nginx
server {
    listen 80;
    server_name yoursite.com www.yoursite.com;
    root /var/www/fruitopia;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
# 5. Enable the site
sudo ln -s /etc/nginx/sites-available/fruitopia /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# 6. (Optional) Add HTTPS with Certbot
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yoursite.com -d www.yoursite.com
```

7. Visit **`https://yoursite.com/install`** to run the wizard.

---

## 10. Multi-Device Sync (The .env File)

For true multi-device access — where any phone, laptop, or browser that visits your site connects to Firebase automatically — you need to populate the `.env` file with your Firebase credentials before building.

### Why this matters

Without `.env`:
- Each device must run the Install Wizard (per-browser localStorage)
- A new visitor sees empty/mock data until the admin logs in

With `.env`:
- Every device connects to Firebase immediately on page load
- No per-device setup needed
- The Install Wizard is only for the initial admin

### How to set it up

1. Open `.env` in the project root.

2. Paste your Firebase credentials:

```env
VITE_FIREBASE_API_KEY="AIzaSyC7..."
VITE_FIREBASE_AUTH_DOMAIN="my-project.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="my-project"
VITE_FIREBASE_STORAGE_BUCKET="my-project.appspot.com"
VITE_FIREBASE_MESSAGING_SENDER_ID="123456789012"
VITE_FIREBASE_APP_ID="1:123456789012:web:abc123..."
VITE_FIREBASE_DATABASE_ID="(default)"
VITE_APP_URL="https://yourdomain.com"
```

3. **Rebuild and redeploy**:

```bash
npm run build
# Then deploy the dist/ folder again (see Step 9)
```

> **What about the Install Wizard?** The wizard is still useful for first-time setup (seeding products, creating admin account, etc.). But once `.env` is populated, all visitors see the live site immediately — no per-browser setup required.

---

## 📋 Post-Deployment Checklist

- [ ] ✅ Install Wizard completed (all 7 steps green)
- [ ] ✅ Firestore security rules deployed (`firebase deploy --only firestore:rules`)
- [ ] ✅ Storage CORS configured (`gsutil cors set cors.json gs://...`)
- [ ] ✅ Admin Panel accessible at `/admin`
- [ ] ✅ Log in with the admin credentials you created
- [ ] ✅ Can add/edit products from Admin Panel
- [ ] ✅ Can change currency, logo, site name — persists across page refresh
- [ ] ✅ Can upload images (products, logos) — no CORS errors
- [ ] ✅ Storefront loads correctly on mobile phone
- [ ] ✅ `.env` populated with Firebase credentials for multi-device access
- [ ] ✅ Custom domain pointed (if applicable)
- [ ] ✅ Test place an order end-to-end

---

## ❓ Troubleshooting

### "Access to Firebase Storage has been blocked by CORS policy"

**Cause:** Firebase Storage bucket doesn't allow requests from your domain.

**Fix:** Apply the CORS config as described in [Step 8](#8-configure-storage-cors).

### "Firestore PERMISSION_DENIED" during Install Wizard

**Cause:** Default Firestore security rules block all writes.

**Fix:** Deploy the rules as described in [Step 7](#7-deploy-firestore-security-rules).

### Blank page or 404 on page refresh

**Cause:** The server doesn't know to serve `index.html` for SPA routes.

**Fix (Vercel):** Already handled by `vercel.json`.  
**Fix (Netlify):** Already handled by `public/_redirects`.  
**Fix (cPanel):** Make sure `.htaccess` is in `public_html/`.  
**Fix (nginx):** Make sure `try_files $uri $uri/ /index.html;` is in your config.

### Admin Panel shows data but it disappears on refresh

**Cause (was):** The `fbOk()` check required Firebase Auth to be signed in for ALL writes. If the Auth sign-in failed silently (Path 4), writes skipped to localStorage.

**Fix (applied):** The `fbOk()` function no longer requires `auth.currentUser`. Firestore Security Rules are the correct enforcement layer. Re-deploy `firestore.rules` and run the Install Wizard again.

### "No errors" but nothing loads

1. Check the browser console (F12 → Console tab) for error messages.
2. Make sure Firebase is configured — visit `/install` to verify.
3. Make sure Firestore has data — visit `/admin` to check.
4. Make sure the Engine is set to "Firebase" — Admin Panel → Cloud Infrastructure.

---

## 📚 Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    User's Browser                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │  App.tsx (boot check → InstallWizard or Store)     │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │  AppContext (real-time state hub)             │  │  │
│  │  │  └── onSnapshot() ← live data from Firestore  │  │  │
│  │  │  └── dbService (polymorphic CRUD)             │  │  │
│  │  │  └── firebaseService (settings, uploads)      │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
│                          │                                │
│                          ▼                                │
│              ┌──────────────────────┐                     │
│              │   Firebase SDK       │                     │
│              │  (firebase.ts init)  │                     │
│              └──────────┬───────────┘                     │
└─────────────────────────┼─────────────────────────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │   Firebase Console   │
              │  ┌────────────────┐  │
              │  │ Firestore DB   │  │ ← Products, Orders, Settings
              │  ├────────────────┤  │
              │  │ Auth           │  │ ← Admin login
              │  ├────────────────┤  │
              │  │ Storage        │  │ ← Product images, Logos
              │  └────────────────┘  │
              └──────────────────────┘
```

**Boot Priority Chain (how Firebase config is resolved):**

1. `/firebase-config.json` — server-side file (cPanel/PHP)
2. `VITE_FIREBASE_*` env vars — baked into build (multi-device)
3. `localStorage` — per-browser (Install Wizard)
4. `firebase-applet-config.json` — local development fallback

---

Need help? Open an issue on GitHub or contact the development team.
