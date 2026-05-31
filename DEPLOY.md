# Fruitopia — Deployment Guide

Complete deployment instructions for every supported platform.
After deploying to any platform, visit `/install` to run the setup wizard and connect your Firebase project.

---

## Firebase Console Setup (do this first)

Before deploying, set up your Firebase project so the install wizard has something to connect to.

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project**.
2. Give your project a name, optionally disable Google Analytics, and click **Create project**.
3. Inside your project, click **</> Web** to add a web app. Register the app and copy the `firebaseConfig` object — you'll paste these values into the install wizard.
4. In the left sidebar, go to **Build → Firestore Database**. Click **Create database**, choose **Production mode**, and select a region closest to your users.
5. In the left sidebar, go to **Build → Authentication**. Click **Get started**, then under **Sign-in providers** enable **Email/Password**.
6. Deploy the Firestore security rules from this repo:
   ```bash
   # Install Firebase CLI if you haven't already
   npm install -g firebase-tools

   # Log in
   firebase login

   # Deploy only the Firestore rules
   firebase deploy --only firestore:rules
   ```

---

## Local Development

Run the full app locally with hot-reload.

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server
npm run dev

# 3. Open the install wizard
# Visit: http://localhost:5173/install
```

The wizard will save your Firebase config to `public/firebase-config.json` (or you can edit it manually). After completing setup you can use the app at `http://localhost:5173`.

To preview the production build locally:

```bash
npm run build
npm run preview
# Visit: http://localhost:4173
```

---

## cPanel Shared Hosting

Suitable for most shared hosting providers (Hostinger, Namecheap, Bluehost, etc.).

```bash
# 1. On your LOCAL computer — build the project
npm install
npm run build
```

2. In your cPanel File Manager (or via FTP/SFTP), upload the **entire contents** of the `dist/` folder into `public_html/`. Do not upload the `dist/` folder itself — upload what's inside it.
3. Upload `public/.htaccess` into `public_html/` as well. This file enables SPA routing so page refreshes work correctly.
4. Visit `yoursite.com/install` to run the setup wizard.
5. Complete the wizard — it uses `install-helper.php` (already in `public/`) to write `firebase-config.json` automatically.
6. Done. Your store is live at `yoursite.com`.

> **Note:** If you see a blank page or 404 on refresh, confirm `.htaccess` is present in `public_html/` and that `mod_rewrite` is enabled on your host (it is on virtually all cPanel hosts by default).

---

## Vercel

Zero-config deployment. Vercel detects Vite automatically.

1. Push your repo to GitHub (or GitLab / Bitbucket).
2. Go to [vercel.com](https://vercel.com), click **Add New → Project**, and import your repository.
3. Vercel auto-detects the Vite framework. Leave all settings at their defaults.
4. Click **Deploy**. No environment variables are needed at this stage.
5. Visit `yourproject.vercel.app/install` to run the setup wizard.
6. Done.

> **SPA routing on Vercel** is handled automatically via the `vercel.json` already present in this repo.

> **Custom domain:** In your Vercel project → Settings → Domains, add your domain and follow the DNS instructions.

---

## Netlify

Deploy via drag-and-drop or continuous deployment from Git.

### Option A — Drag and drop (quickest)

```bash
# Build locally first
npm run build
```

1. Go to [app.netlify.com](https://app.netlify.com) and log in.
2. On the **Sites** page, drag your entire `dist/` folder onto the drop zone.
3. Netlify assigns a random URL instantly (e.g. `random-name.netlify.app`).
4. Visit `yoursite.netlify.app/install` to complete setup.
5. Done.

### Option B — Connect GitHub repo

1. In Netlify, click **Add new site → Import an existing project**.
2. Connect your GitHub account and select the repo.
3. Set **Build command** to `npm run build` and **Publish directory** to `dist`.
4. Click **Deploy site**.
5. Visit the assigned URL and go to `/install`.
6. Done.

> **SPA routing on Netlify** — create a `public/_redirects` file (already present in this repo) with the content `/* /index.html 200`. This is already included in the `public/` folder.

---

## VPS / Ubuntu Server

For a VPS running Ubuntu 20.04+ with nginx or Apache.

### With nginx

```bash
# 1. Build locally and transfer the dist/ folder to your server
npm run build
scp -r dist/ user@yourserver:/var/www/fruitopia

# 2. On the server — install nginx if needed
sudo apt update && sudo apt install -y nginx

# 3. Create a site config
sudo nano /etc/nginx/sites-available/fruitopia
```

Paste this nginx config (replace `yoursite.com` with your domain or server IP):

```nginx
server {
    listen 80;
    server_name yoursite.com www.yoursite.com;
    root /var/www/fruitopia;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
# 4. Enable the site and restart nginx
sudo ln -s /etc/nginx/sites-available/fruitopia /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# 5. (Optional) Add HTTPS with Certbot
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yoursite.com -d www.yoursite.com
```

6. Visit `yoursite.com/install` to run the setup wizard.
7. Done.

### With Apache

```bash
# Install Apache
sudo apt update && sudo apt install -y apache2

# Enable mod_rewrite
sudo a2enmod rewrite

# Copy dist contents
sudo cp -r dist/. /var/www/html/

# Copy .htaccess (already handles SPA routing)
sudo cp public/.htaccess /var/www/html/.htaccess

# Make sure AllowOverride is set to All in your vhost config
# Then restart Apache
sudo systemctl restart apache2
```

Visit `yourip/install` or `yoursite.com/install` to complete setup.

---

## Post-Deployment Checklist

- [ ] `/install` wizard completed successfully
- [ ] Firebase config values saved (API key, project ID, etc.)
- [ ] Firestore rules deployed (`firebase deploy --only firestore:rules`)
- [ ] Admin panel accessible at `/admin`
- [ ] Test order placement end-to-end
- [ ] Storefront loads correctly on mobile
- [ ] Custom domain pointed (if applicable)
- [ ] Payment gateways tested (see **Payment Gateways** section below)

---

## Payment Gateways (Automatic Payments)

Automatic gateways (SSLCommerz, PayPal, Stripe, Razorpay, bKash, Nagad) need a
**server** to talk to the gateway APIs. The static frontend alone cannot do this.
How the server runs depends on the platform:

| Platform                | Serves SPA | Runs `/api/*` server | Payments work?                          |
|-------------------------|:----------:|:--------------------:|------------------------------------------|
| Render                  |     ✅     |  ✅ `server.mjs`     | ✅ Yes (out of the box)                  |
| cPanel **with Node app**|     ✅     |  ✅ `server.mjs`     | ✅ Yes (run `npm start`)                 |
| Vercel                  |     ✅     |  ✅ `api/` functions | ✅ Yes (serverless)                      |
| Netlify                 |     ✅     |  ❌ (static only)    | ⚠️ Needs `/api/*` proxy to a Node host   |
| cPanel static / VPS     |     ✅     |  ❌ (static only)    | ⚠️ Needs `/api/*` proxy to a Node host   |

### Where credentials come from

You enter gateway credentials in **Admin → Settings → Payment**. The checkout
sends them to the backend with each request, so on **Render, cPanel-with-Node,
and Vercel** no extra configuration is needed beyond the admin panel.

The **Sandbox Mode** checkbox per gateway switches between the test and live
gateway URLs. Make sure the credentials you enter match the mode:
- Sandbox ON → use the gateway's **sandbox/test** credentials.
- Sandbox OFF → use your **live/production** credentials.

### Optional: environment variables (Vercel)

On Vercel you may instead set credentials as project environment variables
(they act as a fallback when the admin panel is empty):

```
SSLCZ_STORE_ID, SSLCZ_STORE_PASSWORD, SSLCZ_SANDBOX
PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_SANDBOX
STRIPE_SECRET_KEY, STRIPE_PUBLIC_KEY, STRIPE_SANDBOX
RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_SANDBOX
BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME, BKASH_PASSWORD, BKASH_SANDBOX
NAGAD_MERCHANT_ID, NAGAD_MERCHANT_NUMBER, NAGAD_PRIVATE_KEY, NAGAD_SANDBOX
```

### Netlify / static-only hosts: proxy `/api/*` to a Node server

Netlify (and plain static cPanel/VPS) do not run the payment server. Deploy the
Node server (`server.mjs`) somewhere that does — e.g. Render — and forward API
calls to it:

- **Netlify:** edit `netlify.toml` and set the `/api/*` redirect `to` value to
  your Node server origin (e.g. `https://your-app.onrender.com/api/:splat`).
  This repo already includes that redirect; just update the URL.
- **VPS (nginx):** add a proxy block before the SPA `location /`:
  ```nginx
  location /api/ {
      proxy_pass https://your-app.onrender.com/api/;
      proxy_set_header Host $host;
  }
  ```

The simplest path if you want payments with zero proxying is to deploy the whole
app on **Render**, **Vercel**, or **cPanel with a Node app** — all three serve
both the SPA and `/api/*` together.

