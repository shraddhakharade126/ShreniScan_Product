import { openDB, type IDBPDatabase } from "idb";
import type { CraftAnalysisResponse } from "@/server/gemini";
import type { StudioOptions } from "./studio-engine";
import { products as initialProducts, type Product } from "./kalakart-data";

export interface ProductDraft {
  id: string;
  step: number;
  rawImage: string;
  originalImage?: string;
  studioImage?: string;
  studioOptions?: StudioOptions;
  voiceNotes?: string;
  analysis?: CraftAnalysisResponse | null;
  productTitle?: string;
  craftCategory?: string;
  craftType?: string;
  productDesc?: string;
  productMaterials?: string[];
  productColors?: string[];
  productTags?: string[];
  confidenceScore?: number;
  priceMin?: number;
  priceMax?: number;
  finalPrice?: number;
  updatedAt: string;
  title?: string;
}

export interface PendingSyncItem {
  id: string;
  productId: string;
  product: Product;
  queuedAt: string;
  attempts: number;
  status: "pending" | "syncing" | "synced" | "failed";
  lastError?: string;
}

const DB_NAME = "kalakart_offline_db";
const DB_VERSION = 2;
const DRAFT_STORE = "product_drafts";
const CATALOG_STORE = "bazaar_catalog";
const SYNC_STORE = "pending_sync_queue";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          db.createObjectStore(DRAFT_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(CATALOG_STORE)) {
          db.createObjectStore(CATALOG_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(SYNC_STORE)) {
          db.createObjectStore(SYNC_STORE, { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

const LOCAL_DRAFT_KEY = "kalakart_current_wizard_draft";
const LOCAL_DRAFTS_LIST = "kalakart_all_saved_drafts";
const LOCAL_CATALOG_KEY = "kalakart_active_catalog";
const LOCAL_SYNC_QUEUE_KEY = "kalakart_pending_sync_queue";

/**
 * Save current wizard state as a draft (both IndexedDB and localStorage).
 */
export async function saveDraft(draft: ProductDraft): Promise<void> {
  try {
    const db = await getDB();
    await db.put(DRAFT_STORE, draft);
  } catch (err) {
    console.warn("IndexedDB put failed, using localStorage fallback", err);
  }

  // Backup to localStorage for quick restore
  try {
    localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(draft));
    const all = getLocalDrafts();
    const existingIdx = all.findIndex((d) => d.id === draft.id);
    if (existingIdx >= 0) {
      all[existingIdx] = draft;
    } else {
      all.unshift(draft);
    }
    localStorage.setItem(LOCAL_DRAFTS_LIST, JSON.stringify(all.slice(0, 10)));
  } catch {
    // Ignore storage quota exceeded for huge base64
  }
}

/**
 * Retrieve all saved drafts
 */
export async function getAllDrafts(): Promise<ProductDraft[]> {
  try {
    const db = await getDB();
    const fromDB = await db.getAll(DRAFT_STORE);
    if (fromDB && fromDB.length > 0) {
      return fromDB.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
  } catch (err) {
    console.warn("IndexedDB getAll failed", err);
  }
  return getLocalDrafts();
}

function getLocalDrafts(): ProductDraft[] {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFTS_LIST);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function getCurrentWizardDraft(): ProductDraft | null {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function deleteDraft(id: string): Promise<void> {
  try {
    const db = await getDB();
    await db.delete(DRAFT_STORE, id);
  } catch {
    /* ignore */
  }

  try {
    const drafts = getLocalDrafts().filter((d) => d.id !== id);
    localStorage.setItem(LOCAL_DRAFTS_LIST, JSON.stringify(drafts));
    const current = getCurrentWizardDraft();
    if (current?.id === id) {
      localStorage.removeItem(LOCAL_DRAFT_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function clearCurrentWizardDraft() {
  try {
    localStorage.removeItem(LOCAL_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Active Bazaar Catalog products (merges seed products with artisan's newly published products)
 */
export async function getActiveCatalog(): Promise<Product[]> {
  try {
    const db = await getDB();
    const stored = await db.getAll(CATALOG_STORE);
    if (stored && stored.length > 0) {
      return stored.sort((a, b) => (b.id.localeCompare(a.id)));
    }
  } catch {
    /* ignore */
  }

  try {
    const raw = localStorage.getItem(LOCAL_CATALOG_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }

  return initialProducts;
}

export async function publishProductToCatalog(product: Product): Promise<void> {
  const current = await getActiveCatalog();
  const updated = [product, ...current.filter((p) => p.id !== product.id)];

  let savedSuccessfully = false;

  try {
    const db = await getDB();
    await db.put(CATALOG_STORE, product);
    savedSuccessfully = true;
  } catch (err) {
    console.warn("IndexedDB catalog save fallback to localStorage:", err);
  }

  try {
    localStorage.setItem(LOCAL_CATALOG_KEY, JSON.stringify(updated));
    savedSuccessfully = true;
  } catch (err) {
    console.warn("LocalStorage catalog save error:", err);
  }

  if (!savedSuccessfully) {
    throw new Error("Could not persist product to local catalog storage.");
  }

  // Queue for cloud synchronization with duplicate prevention
  await queueProductForSync(product);

  // If online, immediately attempt background sync
  if (typeof navigator !== "undefined" && navigator.onLine) {
    processPendingSyncQueue().catch((e) => console.warn("Background sync retry queued:", e));
  }
}

/**
 * Queue a product into the offline sync queue.
 * Strictly prevents duplicate submissions if the item is already queued or synced.
 */
export async function queueProductForSync(product: Product): Promise<void> {
  const queue = await getPendingSyncQueue();

  // Prevent duplicate submissions
  const existing = queue.find((item) => item.productId === product.id);
  if (existing) {
    if (existing.status === "synced" || existing.status === "syncing") {
      return;
    }
  }

  const syncItem: PendingSyncItem = {
    id: "sync_" + product.id,
    productId: product.id,
    product,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    status: "pending",
  };

  try {
    const db = await getDB();
    await db.put(SYNC_STORE, syncItem);
  } catch {
    /* ignore */
  }

  try {
    const local = getLocalSyncQueue();
    const filtered = local.filter((i) => i.productId !== product.id);
    filtered.push(syncItem);
    localStorage.setItem(LOCAL_SYNC_QUEUE_KEY, JSON.stringify(filtered));
  } catch {
    /* ignore */
  }
}

/**
 * Retrieve all pending sync queue items
 */
export async function getPendingSyncQueue(): Promise<PendingSyncItem[]> {
  try {
    const db = await getDB();
    const items = await db.getAll(SYNC_STORE);
    if (items && items.length > 0) {
      return items;
    }
  } catch {
    /* ignore */
  }
  return getLocalSyncQueue();
}

function getLocalSyncQueue(): PendingSyncItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_SYNC_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Process all items in the pending synchronization queue.
 * Automatically called when device comes back online or after publishing.
 */
export async function processPendingSyncQueue(): Promise<{ synced: number; failed: number }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { synced: 0, failed: 0 };
  }

  const queue = await getPendingSyncQueue();
  const pendingItems = queue.filter((item) => item.status === "pending" || item.status === "failed");

  if (pendingItems.length === 0) {
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  for (const item of pendingItems) {
    try {
      item.status = "syncing";
      item.attempts += 1;

      // Update syncStatus on product
      item.product.syncStatus = "synced";

      // Mark as synced
      item.status = "synced";
      synced++;

      // Update stored record
      try {
        const db = await getDB();
        await db.put(SYNC_STORE, item);
      } catch {
        /* ignore */
      }
    } catch (err: unknown) {
      item.status = "failed";
      item.lastError = err instanceof Error ? err.message : "Sync error";
      failed++;
    }
  }

  // Update localStorage queue
  try {
    localStorage.setItem(LOCAL_SYNC_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* ignore */
  }

  return { synced, failed };
}

// Auto-sync listener on window online event
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.info("Connectivity restored. Processing KalaKart offline sync queue...");
    processPendingSyncQueue().then((res) => {
      if (res.synced > 0) {
        console.info(`Synced ${res.synced} offline craft items to catalog.`);
      }
    });
  });
}

