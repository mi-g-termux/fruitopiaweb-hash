/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — Firestore Real-Time Service Layer
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This module provides real-time listeners and CRUD operations for:
 *  • Store Configuration (settings/store_config) — currency, logo, name
 *  • Coupons Collection (coupons) — discount codes with validation
 *  • Categories Collection (categories) — product categories
 *
 * KEY ARCHITECTURE:
 *  • All collection reads use onSnapshot for real-time updates
 *  • Admin panel changes instantly propagate to customer storefronts
 *  • Image uploads are Base64-encoded before Firestore write
 *  • No Cloud Storage required — everything stays in Firestore
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  doc,
  collection,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  Unsubscribe,
  getDoc,
  writeBatch,
  query,
  where,
} from 'firebase/firestore';
import { getDb, getIsFirebaseConfigured, handleFirestoreError, OperationType, fileToBase64 as _fileToBase64Compressed } from './firebase';
import { SiteSettings, Coupon, Category } from './types';

// ═════════════════════════════════════════════════════════════════════════════
// STORE CONFIG (Global Settings + Currency)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * StoreConfig interface — single document at settings/store_config
 * Contains: currency, logo (Base64), store name, and any global branding
 */
export interface StoreConfig {
  storeCurrency: string;        // e.g., "USD", "TRY", "BDT"
  currencySymbol: string;       // e.g., "$", "₺", "৳"
  currencyPosition?: 'before' | 'after';
  storeName: string;
  storeLogo: string;            // Base64-encoded image data URI
  lastUpdatedAt?: number;       // Unix timestamp
}

/**
 * Initialize or update the store config document.
 * Call this once when the admin first configures the app.
 *
 * @param config - Partial StoreConfig (merges with existing)
 * @returns Promise that resolves when Firestore write completes
 */
export async function saveStoreConfig(config: Partial<StoreConfig>): Promise<void> {
  if (!getIsFirebaseConfigured() || !getDb()) {
    console.warn('[firestore-service] Firebase not configured; skipping saveStoreConfig');
    return;
  }

  try {
    const db = getDb()!;
    const docRef = doc(db, 'settings', 'store_config');

    // Merge with existing to avoid overwriting unrelated fields
    const existing = await getDoc(docRef);
    const merged: StoreConfig = {
      storeCurrency: config.storeCurrency ?? existing?.data()?.storeCurrency ?? 'USD',
      currencySymbol: config.currencySymbol ?? existing?.data()?.currencySymbol ?? '$',
      currencyPosition: config.currencyPosition ?? existing?.data()?.currencyPosition ?? 'before',
      storeName: config.storeName ?? existing?.data()?.storeName ?? 'Fruitopia',
      storeLogo: config.storeLogo ?? existing?.data()?.storeLogo ?? '',
      lastUpdatedAt: Date.now(),
    };

    await setDoc(docRef, merged, { merge: true });
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, 'settings/store_config');
    throw e;
  }
}

/**
 * Fetch the current store config from Firestore (one-time read).
 *
 * @returns Promise<StoreConfig | null>
 */
export async function getStoreConfig(): Promise<StoreConfig | null> {
  if (!getIsFirebaseConfigured() || !getDb()) {
    console.warn('[firestore-service] Firebase not configured; returning null');
    return null;
  }

  try {
    const db = getDb()!;
    const docRef = doc(db, 'settings', 'store_config');
    const snap = await getDoc(docRef);
    return snap.exists() ? (snap.data() as StoreConfig) : null;
  } catch (e) {
    handleFirestoreError(e, OperationType.READ, 'settings/store_config');
    return null;
  }
}

/**
 * Subscribe to real-time updates of the store config.
 * Fires immediately with current data, then on every change.
 *
 * @param callback - Called with updated StoreConfig or null if doc doesn't exist
 * @returns Unsubscribe function — call to stop listening
 *
 * USAGE:
 *   const unsub = onStoreConfigChange((config) => {
 *     setCurrency(config?.currencySymbol ?? '$');
 *   });
 *   // Later, in cleanup:
 *   unsub();
 */
export function onStoreConfigChange(callback: (config: StoreConfig | null) => void): Unsubscribe {
  if (!getIsFirebaseConfigured() || !getDb()) {
    console.warn('[firestore-service] Firebase not configured; listener will be no-op');
    // Return a no-op unsubscribe function
    return () => {};
  }

  const db = getDb()!;
  const docRef = doc(db, 'settings', 'store_config');

  return onSnapshot(
    docRef,
    (snap) => {
      const config = snap.exists() ? (snap.data() as StoreConfig) : null;
      callback(config);
    },
    (err) => {
      handleFirestoreError(err, OperationType.READ, 'settings/store_config (listener)');
      // Don't crash — just notify callback that data is unavailable
      callback(null);
    }
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// COUPONS COLLECTION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Create or update a coupon in Firestore.
 *
 * @param coupon - Coupon object (id will be auto-generated if missing)
 * @returns Promise that resolves when Firestore write completes
 */
export async function saveCoupon(coupon: Coupon): Promise<void> {
  if (!getIsFirebaseConfigured() || !getDb()) {
    console.warn('[firestore-service] Firebase not configured; skipping saveCoupon');
    return;
  }

  try {
    const db = getDb()!;
    const couponId = coupon.id || `coup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const docRef = doc(db, 'coupons', couponId);

    await setDoc(docRef, { ...coupon, id: couponId }, { merge: true });
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, 'coupons/' + coupon.id);
    throw e;
  }
}

/**
 * Delete a coupon from Firestore.
 *
 * @param couponId - ID of the coupon to delete
 * @returns Promise that resolves when Firestore delete completes
 */
export async function deleteCoupon(couponId: string): Promise<void> {
  if (!getIsFirebaseConfigured() || !getDb()) {
    console.warn('[firestore-service] Firebase not configured; skipping deleteCoupon');
    return;
  }

  try {
    const db = getDb()!;
    const docRef = doc(db, 'coupons', couponId);
    await deleteDoc(docRef);
  } catch (e) {
    handleFirestoreError(e, OperationType.DELETE, 'coupons/' + couponId);
    throw e;
  }
}

/**
 * Fetch all coupons from Firestore (one-time read).
 *
 * @returns Promise<Coupon[]>
 */
export async function getAllCoupons(): Promise<Coupon[]> {
  if (!getIsFirebaseConfigured() || !getDb()) {
    console.warn('[firestore-service] Firebase not configured; returning empty array');
    return [];
  }

  try {
    const db = getDb()!;
    const coll = collection(db, 'coupons');
    const snap = await getDocs(coll);
    return snap.docs.map((doc) => doc.data() as Coupon);
  } catch (e) {
    handleFirestoreError(e, OperationType.READ, 'coupons (collection)');
    return [];
  }
}

/**
 * Subscribe to real-time updates of all coupons.
 * Fires immediately, then on every change.
 *
 * @param callback - Called with updated Coupon[]
 * @returns Unsubscribe function — call to stop listening
 */
export function onCouponsChange(callback: (coupons: Coupon[]) => void): Unsubscribe {
  if (!getIsFirebaseConfigured() || !getDb()) {
    console.warn('[firestore-service] Firebase not configured; listener will be no-op');
    return () => {};
  }

  const db = getDb()!;
  const coll = collection(db, 'coupons');

  return onSnapshot(
    coll,
    (snap) => {
      const coupons = snap.docs.map((doc) => doc.data() as Coupon);
      callback(coupons);
    },
    (err) => {
      handleFirestoreError(err, OperationType.READ, 'coupons (listener)');
      callback([]);
    }
  );
}

/**
 * Validate a coupon code against the live Firestore collection.
 * Returns the coupon object if valid and active, null otherwise.
 *
 * @param code - The coupon code string to validate
 * @returns Promise<Coupon | null>
 */
export async function validateCouponCode(code: string): Promise<Coupon | null> {
  if (!getIsFirebaseConfigured() || !getDb()) {
    console.warn('[firestore-service] Firebase not configured; coupon validation unavailable');
    return null;
  }

  try {
    const db = getDb()!;
    const coll = collection(db, 'coupons');
    const q = query(coll, where('code', '==', code.toUpperCase().trim()));
    const snap = await getDocs(q);

    if (snap.docs.length === 0) return null;

    const coupon = snap.docs[0].data() as Coupon;

    // Check expiry
    if (coupon.expiryDate) {
      const expiry = new Date(coupon.expiryDate).getTime();
      if (expiry < Date.now()) return null;
    }

    // Check if active
    if (!coupon.isActive) return null;

    return coupon;
  } catch (e) {
    console.warn('[firestore-service] Coupon validation error:', e);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// CATEGORIES COLLECTION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Create or update a category in Firestore.
 *
 * @param category - Category object (id will be auto-generated if missing)
 * @returns Promise that resolves when Firestore write completes
 */
export async function saveCategory(category: Category): Promise<void> {
  if (!getIsFirebaseConfigured() || !getDb()) {
    console.warn('[firestore-service] Firebase not configured; skipping saveCategory');
    return;
  }

  try {
    const db = getDb()!;
    const catId = category.id || `cat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const docRef = doc(db, 'categories', catId);

    await setDoc(docRef, { ...category, id: catId }, { merge: true });
  } catch (e) {
    handleFirestoreError(e, OperationType.WRITE, 'categories/' + category.id);
    throw e;
  }
}

/**
 * Delete a category from Firestore.
 *
 * @param categoryId - ID of the category to delete
 * @returns Promise that resolves when Firestore delete completes
 */
export async function deleteCategory(categoryId: string): Promise<void> {
  if (!getIsFirebaseConfigured() || !getDb()) {
    console.warn('[firestore-service] Firebase not configured; skipping deleteCategory');
    return;
  }

  try {
    const db = getDb()!;
    const docRef = doc(db, 'categories', categoryId);
    await deleteDoc(docRef);
  } catch (e) {
    handleFirestoreError(e, OperationType.DELETE, 'categories/' + categoryId);
    throw e;
  }
}

/**
 * Fetch all categories from Firestore (one-time read).
 *
 * @returns Promise<Category[]>
 */
export async function getAllCategories(): Promise<Category[]> {
  if (!getIsFirebaseConfigured() || !getDb()) {
    console.warn('[firestore-service] Firebase not configured; returning empty array');
    return [];
  }

  try {
    const db = getDb()!;
    const coll = collection(db, 'categories');
    const snap = await getDocs(coll);
    return snap.docs.map((doc) => doc.data() as Category);
  } catch (e) {
    handleFirestoreError(e, OperationType.READ, 'categories (collection)');
    return [];
  }
}

/**
 * Subscribe to real-time updates of all categories.
 * Fires immediately, then on every change.
 *
 * @param callback - Called with updated Category[]
 * @returns Unsubscribe function — call to stop listening
 */
export function onCategoriesChange(callback: (categories: Category[]) => void): Unsubscribe {
  if (!getIsFirebaseConfigured() || !getDb()) {
    console.warn('[firestore-service] Firebase not configured; listener will be no-op');
    return () => {};
  }

  const db = getDb()!;
  const coll = collection(db, 'categories');

  return onSnapshot(
    coll,
    (snap) => {
      const categories = snap.docs.map((doc) => doc.data() as Category);
      callback(categories);
    },
    (err) => {
      handleFirestoreError(err, OperationType.READ, 'categories (listener)');
      callback([]);
    }
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// UTILITY: FILE TO BASE64 CONVERSION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Convert a File object to a Base64 data URI string.
 * This is used by image upload handlers to encode images before Firestore storage.
 *
 * @param file - The File object from input[type="file"]
 * @returns Promise<string> — Base64 data URI (e.g., "data:image/png;base64,...")
 * @throws Error if file reading fails
 *
 * USAGE:
 *   const imageFile = event.target.files[0];
 *   const base64String = await fileToBase64(imageFile);
 *   await saveCoupon({ ...coupon, logoImage: base64String });
 */
export function fileToBase64(file: File): Promise<string> {
  return _fileToBase64Compressed(file);
}

/**
 * Validate image file before Base64 encoding.
 *
 * @param file - The File object to validate
 * @param maxSizeMB - Maximum file size in megabytes (default: 2)
 * @returns { valid: boolean, error?: string }
 */
export function validateImageFile(
  file: File,
  maxSizeMB: number = 2
): { valid: boolean; error?: string } {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'Unsupported file type. Use JPG, PNG, WebP, GIF, or SVG.' };
  }

  if (file.size > maxSizeMB * 1024 * 1024) {
    return {
      valid: false,
      error: `Image too large. Maximum size is ${maxSizeMB}MB.`,
    };
  }

  return { valid: true };
}

export default {
  saveStoreConfig,
  getStoreConfig,
  onStoreConfigChange,
  saveCoupon,
  deleteCoupon,
  getAllCoupons,
  onCouponsChange,
  validateCouponCode,
  saveCategory,
  deleteCategory,
  getAllCategories,
  onCategoriesChange,
  fileToBase64,
  validateImageFile,
};
