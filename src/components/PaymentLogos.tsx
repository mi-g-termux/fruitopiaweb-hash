import React from 'react';

/* ─────────────────────────────────────────────────────────────────────────────
   PROFESSIONAL PAYMENT LOGOS
   Each logo is a self-contained SVG pill at 200×64 viewBox.
   Uses real brand colours, crisp geometry, and clean typography.
───────────────────────────────────────────────────────────────────────────── */

export const BkashLogo: React.FC<{ className?: string }> = ({ className = "h-8" }) => (
  <svg className={className} viewBox="0 0 200 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Background pill */}
    <rect width="200" height="64" rx="10" fill="#E2136E"/>
    {/* Subtle top-left highlight */}
    <rect width="200" height="22" rx="10" fill="white" fillOpacity="0.08"/>
    {/* Left: concentric target rings — bKash brand mark */}
    <circle cx="38" cy="32" r="20" fill="white" fillOpacity="0.15"/>
    <circle cx="38" cy="32" r="15" fill="white" fillOpacity="0.18"/>
    <circle cx="38" cy="32" r="10" fill="white" fillOpacity="0.9"/>
    <circle cx="38" cy="32" r="5"  fill="#E2136E"/>
    {/* Separator */}
    <line x1="70" y1="14" x2="70" y2="50" stroke="white" strokeOpacity="0.2" strokeWidth="1"/>
    {/* Brand name */}
    <text x="83" y="40" fill="white" fontFamily="system-ui,-apple-system,sans-serif" fontSize="22" fontWeight="800" letterSpacing="-0.5">bKash</text>
  </svg>
);

export const NagadLogo: React.FC<{ className?: string }> = ({ className = "h-8" }) => (
  <svg className={className} viewBox="0 0 200 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Background pill */}
    <rect width="200" height="64" rx="10" fill="#F26422"/>
    <rect width="200" height="22" rx="10" fill="white" fillOpacity="0.08"/>
    {/* Stylised "N" mark — forward-arrow feel */}
    <polygon points="20,48 20,16 34,16 50,38 50,16 64,16 64,48 50,48 34,26 34,48" fill="white" fillOpacity="0.9"/>
    {/* Separator */}
    <line x1="76" y1="14" x2="76" y2="50" stroke="white" strokeOpacity="0.2" strokeWidth="1"/>
    {/* Brand name */}
    <text x="88" y="40" fill="white" fontFamily="system-ui,-apple-system,sans-serif" fontSize="22" fontWeight="800" letterSpacing="-0.5">nagad</text>
  </svg>
);

export const StripeLogo: React.FC<{ className?: string }> = ({ className = "h-8" }) => (
  <svg className={className} viewBox="0 0 200 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Deep purple background */}
    <rect width="200" height="64" rx="10" fill="#635BFF"/>
    <rect width="200" height="22" rx="10" fill="white" fillOpacity="0.06"/>
    {/* Stripe "S" mark — simplified arc glyph */}
    <path d="M46 24c-8 0-12 4-12 8 0 5 4 7.5 11 9s9 3 9 6-3 5-8 5c-6 0-10-2-12-4l-3 6c3 2 8 4 15 4 9 0 14-4 14-10 0-5-4-8-11-9.5S40 36.5 40 34c0-2.5 2.5-4 7-4 5 0 8 1.5 10 3l3-5.5C57 25.5 52 24 46 24z" fill="white" fillOpacity="0.9"/>
    {/* Separator */}
    <line x1="76" y1="14" x2="76" y2="50" stroke="white" strokeOpacity="0.2" strokeWidth="1"/>
    {/* Brand name */}
    <text x="88" y="40" fill="white" fontFamily="system-ui,-apple-system,sans-serif" fontSize="22" fontWeight="800" letterSpacing="-0.5">stripe</text>
  </svg>
);

export const PaypalLogo: React.FC<{ className?: string }> = ({ className = "h-8" }) => (
  <svg className={className} viewBox="0 0 200 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Deep navy background */}
    <rect width="200" height="64" rx="10" fill="#003087"/>
    <rect width="200" height="22" rx="10" fill="white" fillOpacity="0.06"/>
    {/* PayPal double-P monogram */}
    {/* Outer P */}
    <rect x="18" y="18" width="5" height="28" rx="2.5" fill="#009CDE"/>
    <path d="M23 18h10c5 0 8 3 8 7.5S38 33 33 33H23V18z" fill="#009CDE"/>
    <path d="M23 28h10c5 0 8 3 8 7.5S38 43 33 43H23V28z" fill="#012169" fillOpacity="0.6"/>
    {/* Inner P — offset */}
    <rect x="28" y="24" width="5" height="24" rx="2.5" fill="#012169"/>
    <path d="M33 24h10c5 0 7 3 7 7S48 38 43 38H33V24z" fill="#012169"/>
    {/* Separator */}
    <line x1="76" y1="14" x2="76" y2="50" stroke="white" strokeOpacity="0.2" strokeWidth="1"/>
    {/* Brand name */}
    <text x="88" y="40" fill="white" fontFamily="system-ui,-apple-system,sans-serif" fontSize="22" fontWeight="800" letterSpacing="-0.5">PayPal</text>
  </svg>
);

export const RocketLogo: React.FC<{ className?: string }> = ({ className = "h-8" }) => (
  <svg className={className} viewBox="0 0 200 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Purple background */}
    <rect width="200" height="64" rx="10" fill="#7B2D8B"/>
    <rect width="200" height="22" rx="10" fill="white" fillOpacity="0.08"/>
    {/* Clean rocket silhouette */}
    {/* Body */}
    <path d="M38 12c0 0-12 12-12 24h24C50 24 38 12 38 12z" fill="white" fillOpacity="0.9"/>
    {/* Fins */}
    <path d="M26 36l-6 10h12L26 36z" fill="white" fillOpacity="0.7"/>
    <path d="M50 36l6 10H44L50 36z" fill="white" fillOpacity="0.7"/>
    {/* Window */}
    <circle cx="38" cy="30" r="4" fill="#7B2D8B"/>
    <circle cx="38" cy="30" r="2.5" fill="white" fillOpacity="0.4"/>
    {/* Separator */}
    <line x1="76" y1="14" x2="76" y2="50" stroke="white" strokeOpacity="0.2" strokeWidth="1"/>
    {/* Brand name */}
    <text x="88" y="40" fill="white" fontFamily="system-ui,-apple-system,sans-serif" fontSize="22" fontWeight="800" letterSpacing="-0.5">Rocket</text>
  </svg>
);

export const VisaMastercardLogo: React.FC<{ className?: string }> = ({ className = "h-8" }) => (
  <svg className={className} viewBox="0 0 200 64" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Dark card background */}
    <rect width="200" height="64" rx="10" fill="#0F172A"/>
    <rect width="200" height="22" rx="10" fill="white" fillOpacity="0.04"/>
    {/* EMV chip */}
    <rect x="14" y="24" width="18" height="14" rx="3" fill="#C9A227" fillOpacity="0.9"/>
    <rect x="17" y="27" width="12" height="8" rx="1.5" fill="#0F172A" fillOpacity="0.4"/>
    <line x1="23" y1="24" x2="23" y2="38" stroke="#C9A227" strokeOpacity="0.5" strokeWidth="1"/>
    {/* VISA text wordmark */}
    <text x="42" y="38" fill="#2563EB" fontFamily="system-ui,-apple-system,sans-serif" fontSize="18" fontWeight="900" letterSpacing="1">VISA</text>
    {/* Separator */}
    <line x1="104" y1="14" x2="104" y2="50" stroke="white" strokeOpacity="0.15" strokeWidth="1"/>
    {/* Mastercard overlapping circles */}
    <circle cx="124" cy="32" r="14" fill="#EB001B" fillOpacity="0.9"/>
    <circle cx="142" cy="32" r="14" fill="#F79E1B" fillOpacity="0.9"/>
    {/* Overlap blend — darker amber */}
    <path d="M133 19.5a14 14 0 010 25A14 14 0 01133 19.5z" fill="#FF5F00" fillOpacity="0.85"/>
    {/* MC text */}
    <text x="162" y="38" fill="white" fillOpacity="0.7" fontFamily="system-ui,-apple-system,sans-serif" fontSize="11" fontWeight="700">MC</text>
  </svg>
);

/**
 * Professional store bag logo — used in Navbar, Footer, Hero, Cart, Admin.
 * Admin can override this via Settings > Brand > Logo Image.
 */
export const QuirkyFruityLogo: React.FC<{ className?: string }> = ({ className = "w-9 h-9" }) => (
  <svg viewBox="0 0 100 100" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bagGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#10b981"/>
        <stop offset="100%" stopColor="#059669"/>
      </linearGradient>
      <linearGradient id="handleGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#6ee7b7"/>
        <stop offset="100%" stopColor="#10b981"/>
      </linearGradient>
    </defs>
    {/* Bag body */}
    <rect x="18" y="38" width="64" height="46" rx="7" fill="url(#bagGrad)"/>
    {/* Top flap highlight */}
    <rect x="18" y="38" width="64" height="14" rx="7" fill="#34d399" fillOpacity="0.45"/>
    {/* Handle */}
    <path d="M35 38 C35 22 65 22 65 38" stroke="url(#handleGrad)" strokeWidth="7" strokeLinecap="round" fill="none"/>
    {/* Handle inner shadow */}
    <path d="M40 38 C40 28 60 28 60 38" stroke="#059669" strokeWidth="3" strokeLinecap="round" fill="none" fillOpacity="0.55"/>
    {/* Label stripe */}
    <rect x="38" y="58" width="24" height="14" rx="4" fill="white" fillOpacity="0.22"/>
    {/* Sparkle */}
    <path d="M74 24 L76 20 L78 24 L82 26 L78 28 L76 32 L74 28 L70 26 Z" fill="#fbbf24"/>
    <circle cx="66" cy="18" r="2.5" fill="#fbbf24" fillOpacity="0.75"/>
  </svg>
);
