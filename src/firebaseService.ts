/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — Firebase Service Layer (firebaseService.ts)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Convenience wrappers around the low-level firebase.ts and db.ts modules.
 * Provides a clean, simple API for:
 *
 *   getLiveSettings(callback)  — Subscribe to real-time settings changes
 *   updateSettings(settings)   — Save admin configuration to Firestore
 *   fileToDataUrl(file)        — Read a File as base64 data URL (no Storage)
 *
 * IMAGE STORAGE: All images (product photos, logos, etc.) are stored as
 * base64 data URLs directly inside Firestore documents. This works on the
 * Firebase Spark (free) plan without enabling billing.
 *
 * All functions handle the "Firebase not configured" case gracefully:
 * they either return null, throw a clear error, or no-op.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  getIsFirebaseConfigured,
  fileToBase64,
} from './firebase';
import { dbService } from './db';
import type { SiteSettings } from './types';
import { doc, onSnapshot } from 'firebase/firestore';

// Re-export for convenience
export type { SiteSettings };

// ════════════════════════════════════════════════════════════════════════════
//  getLiveSettings — real-time Firestore listener
// ════════════════════════════════════════════════════════════════════════════

/**
 * Subscribe to real-time changes to the site settings document in Firestore.
 *
 * The callback fires immediately with the current data, then again every time
 * the document changes on ANY connected device. This is the key function for
 * multi-device sync of currency, logo, hero text, etc.
 *
 * @param callback - Called with the current SiteSettings (or null if not found / error)
 * @returns An unsubscribe function — call this to stop listening (e.g. in useEffect cleanup)
 *
 * @example
 *   useEffect(() => {
 *     const unsub = getLiveSettings((settings) => {
 *       if (settings) setCurrency(settings.currency);
 *     });
 *     return unsub;
 *   }, []);
 */
export function getLiveSettings(
  callback: (settings: SiteSettings | null) => void,
): () => void {
  if (!getIsFirebaseConfigured()) {
    console.warn('[firebaseService] Firebase not configured — getLiveSettings unavailable.');
    callback(null);
    return () => {};
  }

  let unsub: (() => void) | null = null;
  let cancelled = false;

  // Dynamic import to avoid circular deps and ensure we get the live db instance
  import('./firebase').then(({ db }) => {
    if (cancelled || !db) {
      if (!db) callback(null);
      return;
    }

    unsub = onSnapshot(
      doc(db, 'settings', 'siteSettings'),
      (snap) => {
        if (snap.exists()) {
          callback(snap.data() as SiteSettings);
        } else {
          console.log('[firebaseService] No siteSettings document found in Firestore.');
          callback(null);
        }
      },
      (err) => {
        console.error('[firebaseService] getLiveSettings onSnapshot error:', err);
        callback(null);
      },
    );
  });

  return () => {
    cancelled = true;
    if (unsub) unsub();
  };
}

// ════════════════════════════════════════════════════════════════════════════
//  updateSettings — persist admin configuration to Firestore
// ════════════════════════════════════════════════════════════════════════════

/**
 * Save admin settings to Firestore. The write is synchronous — it awaits the
 * Firestore promise before returning, so the caller can show a success state
 * only after the backend confirms persistence.
 *
 * Uses `setDoc` with `{ merge: true }` to update only the provided fields
 * without overwriting existing data.
 *
 * @param settingsData - Partial SiteSettings. Only the fields you pass are updated.
 * @throws If Firebase is not configured or the write fails.
 *
 * @example
 *   await updateSettings({ currency: 'EUR', currencySymbol: '€' });
 *   toast.success('Currency updated across all devices!');
 */
export async function updateSettings(
  settingsData: Partial<SiteSettings>,
): Promise<void> {
  if (!getIsFirebaseConfigured()) {
    throw new Error('Firebase is not configured. Set up Firebase before saving settings.');
  }

  await dbService.saveSiteSettings({
    ...(await dbService.getSiteSettings()),
    ...settingsData,
  } as SiteSettings);
}

// ════════════════════════════════════════════════════════════════════════════
//  fileToDataUrl — read a File as base64 (no Firebase Storage needed)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Read a File object (from an `<input type="file">` or drag-and-drop) as a
 * base64 data URL string. The result can be stored directly in Firestore —
 * no Firebase Storage bucket required.
 *
 * ⚠️ FIRESTORE SIZE LIMIT: Base64 adds ~37% overhead. A 500 KB file becomes
 * ~685 KB base64. Firestore's per-document limit is 1 MiB. Keep images
 * under ~600 KB to stay safe.
 *
 * @param file - The File object to read (JPG, PNG, WebP, GIF, SVG)
 * @returns A data URL string (e.g. "data:image/png;base64,iVBORw0KGgo...")
 * @throws If the file cannot be read by the browser
 *
 * @example
 *   const dataUrl = await fileToDataUrl(file);
 *   setProdImage(dataUrl);  // Save base64 directly to Firestore
 */
export async function fileToDataUrl(file: File): Promise<string> {
  return fileToBase64(file);
}
