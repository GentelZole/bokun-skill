---
name: bokun-api-integration
description: "Integrate with Bokun.io tourism booking platform API. Covers HMAC-SHA1 authentication, activity/product creation, booking sync, availability checks, and fallback patterns. Used for boat/tour rental platforms syncing with Bokun."
triggers:
  - bokun api
  - bokun integration
  - tourism booking api
  - activity sync
  - hmac-sha1 authentication
  - tour operator api
  - boat rental sync
allowed_tools:
  - terminal
  - write_file
  - patch
  - read_file
  - web_search
metadata: {}
---

# Bokun API Integration

## Overview

Bokun.io is a booking platform for tour operators and activity providers. This skill covers integrating your platform with Bokun's REST API for:
- Creating activities/products when boats/tours are listed
- Syncing bookings bidirectionally
- Checking availability
- Handling authentication (HMAC-SHA1)

## Authentication

Bokun uses custom HMAC-SHA1 signature authentication:

```typescript
import * as crypto from "crypto";

const BOKUN_ACCESS_KEY = process.env.BOKUN_ACCESS_KEY;
const BOKUN_SECRET_KEY = process.env.BOKUN_SECRET_KEY;

function generateSignature(date: string, method: string, path: string): string {
  const stringToSign = `${date}${BOKUN_ACCESS_KEY}${method}${path}`;
  const hmac = crypto.createHmac("sha1", BOKUN_SECRET_KEY);
  hmac.update(stringToSign, "utf-8");
  return hmac.digest("base64");
}

function getDateUTC(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const hours = String(now.getUTCHours()).padStart(2, "0");
  const minutes = String(now.getUTCMinutes()).padStart(2, "0");
  const seconds = String(now.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

export async function bokunRequest<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  retries: number = 2
): Promise<T> {
  const date = getDateUTC();
  const signature = generateSignature(date, method, path);

  const headers = {
    "X-Bokun-Date": date,
    "X-Bokun-AccessKey": BOKUN_ACCESS_KEY,
    "X-Bokun-Signature": signature,
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json",
  };

  const url = `https://api.bokun.io${path}`;
  const options: RequestInit = { method, headers };

  if (body && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bokun API Error ${response.status}: ${errorText}`);
    }

    return response.json() as Promise<T>;
  } catch (error) {
    clearTimeout(timeoutId);
    if (retries > 0 && (error instanceof TypeError || (error as Error).name === 'AbortError')) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return bokunRequest<T>(method, path, body, retries - 1);
    }
    throw error;
  }
}
```

## Key Endpoints

### Activity/Product Creation
```typescript
// POST /activity.json
export async function createActivity(activityData: Record<string, unknown>) {
  return bokunRequest("POST", "/activity.json", activityData);
}
```

### Booking Creation
```typescript
// POST /booking.json
export async function createBooking(bookingData: Record<string, unknown>) {
  return bokunRequest("POST", "/booking.json", bookingData);
}
```

### Availability Check
```typescript
// POST /product/{productId}/availability.json
export async function checkAvailability(productId: number, dateStart: string, dateEnd: string, numPersons: number) {
  return bokunRequest("POST", `/product/${productId}/availability.json`, {
    dateStart, dateEnd, numPersons
  });
}
```

### Search
```typescript
// POST /activity.json/search
export async function searchActivities(lang = "EN", currency = "SAR") {
  return bokunRequest("POST", `/activity.json/search?lang=${lang}&currency=${currency}`, {
    paging: { page: 1, perPage: 20 }
  });
}
```

## Sync Patterns

### Boat → Bokun Activity Sync
When a boat is created in your system, create a corresponding Bokun activity:

```typescript
export async function createBokunActivityForBoat(boatId: number, boatData: any) {
  const activityData = {
    title: boatData.name_en,
    description: boatData.description_en || '',
    maxParticipants: boatData.capacity,
    price: {
      amount: boatData.price_amount,
      currency: boatData.price_currency || 'SAR',
    },
    location: boatData.marina || '',
    tags: boatData.features_en || [],
    images: (boatData.images || []).map((url: string) => ({ url, alt: boatData.name_en })),
  };
  
  const result = await createActivity(activityData);
  const bokunActivityId = result.id ? String(result.id) : null;
  
  if (bokunActivityId) {
    // Store Bokun activity ID in your database
    await pool.query('UPDATE boats SET bokun_activity_id = $1 WHERE id = $2', [bokunActivityId, boatId]);
    return { success: true, bokunActivityId };
  }
  
  return { success: false, error: 'No activity ID returned from Bokun' };
}
```

### Booking Sync
When a booking is created locally, sync it to Bokun:

```typescript
export async function createBokunBooking(localBookingId: number, bookingData: any) {
  // Get boat's Bokun activity ID
  const boat = await pool.query('SELECT bokun_activity_id FROM boats WHERE id = $1', [bookingData.boatId]);
  
  if (!boat.rows[0]?.bokun_activity_id) {
    return { success: false, error: 'Boat not linked to Bokun activity' };
  }
  
  const bokunBookingData = {
    productId: parseInt(boat.rows[0].bokun_activity_id),
    date: bookingData.startDate,
    startTime: bookingData.startTime || "00:00",
    numberOfParticipants: bookingData.passengers || 1,
    leadTraveler: {
      firstName: bookingData.customerName.split(' ')[0],
      lastName: bookingData.customerName.split(' ').slice(1).join(' ') || '',
      email: bookingData.customerEmail,
      phoneNumber: bookingData.customerPhone || '',
    },
    totalPrice: bookingData.totalPrice || 0,
    currency: bookingData.currency || 'SAR',
    notes: `Local booking ID: ${localBookingId}`,
  };
  
  const result = await createBooking(bokunBookingData);
  const bokunBookingId = result.id ? String(result.id) : null;
  
  if (bokunBookingId) {
    await pool.query('UPDATE bookings SET bokun_booking_id = $1 WHERE id = $2', [bokunBookingId, localBookingId]);
    return { success: true, bokunBookingId };
  }
  
  return { success: false, error: 'No booking ID returned from Bokun' };
}
```

## Fallback Pattern

When Bokun is unavailable, fall back to local database:

```typescript
export async function checkProductAvailability(productId: number, dateStart: string, dateEnd: string) {
  try {
    // Try Bokun first
    const availability = await checkAvailability(productId, dateStart, dateEnd, 1);
    return { available: true, source: 'bokun', data: availability };
  } catch (error) {
    // Fallback: Check local bookings table
    const result = await pool.query(`
      SELECT COUNT(*) as count FROM bookings
      WHERE boat_id = $1 AND status = 'confirmed'
      AND (start_date <= $2 AND end_date >= $3)
    `, [productId, dateEnd, dateStart]);
    
    const available = parseInt(result.rows[0].count) === 0;
    return { available, source: 'database', data: { conflictingBookings: result.rows[0].count } };
  }
}
```

## Payment Provider Compatibility

Bokun's supported payment providers (as of 2026):
- **Stripe** (Europe, USA, Canada, Australia, NZ, Singapore, Hong Kong, Mexico, Brazil)
- **Braintree** (Europe, USA, Canada, Australia, NZ, Singapore, Hong Kong)
- **PayPal** (almost all locations)
- **Rapyd** (almost all locations — good for Saudi Arabia/MENA)
- **Teya** (almost all locations)
- **Repaid/Trust My Travel** (almost all locations)
- **Plug'n Pay** (USA, Canada, Caribbean)
- **Central Pay** (Europe/Iceland only — Alipay/WeChat)
- **Paytrail** (Europe only)
- **Nets Easy** (Sweden, Denmark, Norway)
- **GMO** (Japan only)

**NOT supported by Bokun:** Hyperpay, Tap Payments, Tabby, Tamara, Moyasar. If you need these payment methods, you must integrate them separately in your own checkout flow (outside Bokun's widget) and then confirm the booking via Bokun API.

**For Saudi Arabia specifically:** Rapyd is the best native Bokun integration option (supports Mada, Visa, Mastercard, Apple Pay). For Hyperpay or BNPL (Tabby/Tamara), you need a custom integration outside Bokun.

## Bokun → Local Sync (Images & Arabic Descriptions)

When syncing from Bokun to local database, the standard `updateLocalTourFromBokun()` pattern only saves English fields. **You must also extract images and Arabic descriptions.**

### Shared Data Extractor Pattern

Create a shared utility module (`lib/bokun-data-extractor.ts`) to handle extraction consistently across all sync methods:

```typescript
/**
 * Extract image URLs from Bokun activity response.
 * Bokun returns images in multiple locations:
 * - activity.photos[] with originalUrl or url
 * - activity.images[] with originalUrl or url  
 * - activity.keyPhoto with originalUrl or url
 */
export function extractImagesFromBokun(activity: Record<string, unknown>): string[] {
  const images: string[] = [];

  // Try photos array first (most common)
  if (activity.photos && Array.isArray(activity.photos)) {
    for (const img of activity.photos as Array<Record<string, unknown>>) {
      const url = (img.originalUrl || img.url) as string;
      if (url) images.push(url);
    }
  }

  // Fallback to images array
  if (images.length === 0 && activity.images && Array.isArray(activity.images)) {
    for (const img of activity.images as Array<Record<string, unknown>>) {
      const url = (img.originalUrl || img.url) as string;
      if (url) images.push(url);
    }
  }

  // Add key photo first if not already included
  if (activity.keyPhoto) {
    const keyPhoto = activity.keyPhoto as Record<string, unknown>;
    const keyUrl = (keyPhoto.originalUrl || keyPhoto.url) as string;
    if (keyUrl && !images.includes(keyUrl)) {
      images.unshift(keyUrl);
    }
  }

  return images;
}

/**
 * Extract image objects with url and title for JSON storage
 */
export function extractImageObjectsFromBokun(activity: Record<string, unknown>): Array<{ url: string; title: string }> {
  const imageObjects: Array<{ url: string; title: string }> = [];

  const processImageArray = (arr: unknown[]) => {
    for (const img of arr) {
      const imgObj = img as Record<string, unknown>;
      const url = (imgObj.originalUrl || imgObj.url) as string;
      const title = (imgObj.title || imgObj.alt || imgObj.description || '') as string;
      if (url) imageObjects.push({ url, title });
    }
  };

  if (activity.photos && Array.isArray(activity.photos)) {
    processImageArray(activity.photos);
  }

  if (imageObjects.length === 0 && activity.images && Array.isArray(activity.images)) {
    processImageArray(activity.images);
  }

  // Add key photo first
  if (activity.keyPhoto) {
    const keyPhoto = activity.keyPhoto as Record<string, unknown>;
    const keyUrl = (keyPhoto.originalUrl || keyPhoto.url) as string;
    const keyTitle = (keyPhoto.title || keyPhoto.alt || 'Key Photo') as string;
    if (keyUrl && !imageObjects.some(img => img.url === keyUrl)) {
      imageObjects.unshift({ url: keyUrl, title: keyTitle });
    }
  }

  return imageObjects;
}

/**
 * Extract Arabic name from Bokun activity.
 * May be in: titleAr, translations.AR.title, or translations.ar.title
 */
export function extractArabicName(activity: Record<string, unknown>): string | null {
  if (activity.titleAr && typeof activity.titleAr === 'string') {
    return activity.titleAr;
  }

  if (activity.translations) {
    const translations = activity.translations as Record<string, unknown>;
    if (translations.AR) {
      const arTranslation = translations.AR as Record<string, unknown>;
      if (arTranslation.title && typeof arTranslation.title === 'string') {
        return arTranslation.title;
      }
    }
    if (translations.ar) {
      const arTranslation = translations.ar as Record<string, unknown>;
      if (arTranslation.title && typeof arTranslation.title === 'string') {
        return arTranslation.title;
      }
    }
  }

  return null;
}

/**
 * Extract Arabic description from Bokun activity
 */
export function extractArabicDescription(activity: Record<string, unknown>): string | null {
  if (activity.descriptionAr && typeof activity.descriptionAr === 'string') {
    return activity.descriptionAr;
  }

  if (activity.translations) {
    const translations = activity.translations as Record<string, unknown>;
    if (translations.AR) {
      const arTranslation = translations.AR as Record<string, unknown>;
      if (arTranslation.description && typeof arTranslation.description === 'string') {
        return arTranslation.description;
      }
    }
    if (translations.ar) {
      const arTranslation = translations.ar as Record<string, unknown>;
      if (arTranslation.description && typeof arTranslation.description === 'string') {
        return arTranslation.description;
      }
    }
  }

  return null;
}

/**
 * Extract all syncable data from Bokun activity
 */
export function extractSyncableData(activity: Record<string, unknown>): {
  name_en: string;
  name_ar: string | null;
  description_en: string;
  description_ar: string | null;
  images_json: string;
  price: number;
  capacity: number;
} {
  const images = extractImageObjectsFromBokun(activity);
  const nameAr = extractArabicName(activity);
  const descriptionAr = extractArabicDescription(activity);

  return {
    name_en: (activity.title as string) || 'Untitled',
    name_ar: nameAr,
    description_en: (activity.description as string) || '',
    description_ar: descriptionAr,
    images_json: JSON.stringify(images),
    price: (activity.price as number) || 0,
    capacity: (activity.passCapacity as number) || 10,
  };
}
```

### Enhanced Update Function

Use the extractor in your update functions:

```typescript
import { extractSyncableData } from '@/lib/bokun-data-extractor';

async function updateLocalTourFromBokun(
  localTourId: number,
  bokunProduct: Record<string, unknown>,
  syncStatusId: number
): Promise<void> {
  const pool = getPool();

  // Extract enhanced data including images and Arabic translations
  const syncData = extractSyncableData(bokunProduct);

  await pool.query(`
    UPDATE tours 
    SET name_en = $1, description_en = $2, price_amount = $3,
        max_guests = $4, updated_at = CURRENT_TIMESTAMP,
        images = $5, name_ar = COALESCE($6, name_ar), description_ar = COALESCE($7, description_ar)
    WHERE id = $8
  `, [
    syncData.name_en,
    syncData.description_en,
    syncData.price,
    syncData.capacity,
    syncData.images_json,
    syncData.name_ar,
    syncData.description_ar,
    localTourId,
  ]);
}
```

**Key:** Use `COALESCE($6, name_ar)` to preserve existing Arabic content if Bokun doesn't have it.

### Post-Sync Image Fetch

After manual sync completes, fetch activities with both EN and AR locales to ensure complete data:

```typescript
async function postSyncImageFetch(syncStatusId: number): Promise<void> {
  const pool = getPool();

  // Get all entities with bokun_activity_id
  const boatsResult = await pool.query(`
    SELECT id, bokun_activity_id FROM boats WHERE bokun_activity_id IS NOT NULL
  `);
  const toursResult = await pool.query(`
    SELECT id, bokun_activity_id FROM tours WHERE bokun_activity_id IS NOT NULL
  `);

  const entities = [
    ...boatsResult.rows.map(r => ({ ...r, type: 'boat' })),
    ...toursResult.rows.map(r => ({ ...r, type: 'tour' })),
  ];

  for (const entity of entities) {
    try {
      // Fetch with EN locale for images
      const activityEn = await getActivity(parseInt(entity.bokun_activity_id), 'EN', 'SAR');
      // Fetch with AR locale for Arabic translations
      const activityAr = await getActivity(parseInt(entity.bokun_activity_id), 'AR', 'SAR');

      const syncData = extractSyncableData(activityEn);

      // Override Arabic fields from AR locale response
      const nameAr = (activityAr.title as string) || syncData.name_ar;
      const descriptionAr = (activityAr.description as string) || syncData.description_ar;

      const table = entity.type === 'boat' ? 'boats' : 'tours';

      await pool.query(`
        UPDATE ${table}
        SET images = $1, name_ar = COALESCE($2, name_ar), description_ar = COALESCE($3, description_ar),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
      `, [syncData.images_json, nameAr, descriptionAr, entity.id]);

      console.log(`[Post-Sync] Updated ${entity.type} ${entity.id} with ${JSON.parse(syncData.images_json).length} images`);
    } catch (error) {
      console.warn(`[Post-Sync] Failed for ${entity.type} ${entity.id}:`, error);
    }
  }
}
```

Call this after manual sync completes:

```typescript
// In manual sync route, after main sync:
console.log('[Manual Sync] Triggering post-sync image and translation fetch...');
try {
  await postSyncImageFetch(syncStatusId);
} catch (postSyncError) {
  console.warn('[Manual Sync] Post-sync image fetch failed (non-fatal):', postSyncError);
}
```

### Automatic Sync via Webhook

For experiences to auto-sync after Bokun updates, add a webhook endpoint:

```typescript
// app/api/bokun/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/database';
import { getActivity } from '@/lib/bokun-api';
import { extractSyncableData } from '@/lib/bokun-data-extractor';

export async function POST(request: NextRequest) {
  const pool = getPool();
  const body = await request.json();
  
  const activityId = body.activityId || body.productId || body.id;
  if (!activityId) {
    return NextResponse.json({ error: 'Missing activityId' }, { status: 400 });
  }

  // Create sync status record
  const syncStatusResult = await pool.query(`
    INSERT INTO sync_status (sync_type, direction, status, started_at, details)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, ['webhook', 'bokun_to_local', 'in_progress', new Date(), JSON.stringify(body)]);
  
  const syncStatusId = syncStatusResult.rows[0].id;

  try {
    // Find local boat/tour with this Bokun activity ID
    const boatResult = await pool.query(
      'SELECT id, updated_at FROM boats WHERE bokun_activity_id = $1',
      [activityId]
    );
    const tourResult = await pool.query(
      'SELECT id, updated_at FROM tours WHERE bokun_activity_id = $1',
      [activityId]
    );

    if (boatResult.rows.length === 0 && tourResult.rows.length === 0) {
      return NextResponse.json({ success: true, message: 'No matching local entity' });
    }

    // Fetch full activity details (EN and AR locales)
    const bokunActivityEn = await getActivity(parseInt(String(activityId)), 'EN', 'SAR');
    const bokunActivityAr = await getActivity(parseInt(String(activityId)), 'AR', 'SAR');

    const syncData = extractSyncableData(bokunActivityEn);
    const nameAr = (bokunActivityAr.title as string) || syncData.name_ar;
    const descriptionAr = (bokunActivityAr.description as string) || syncData.description_ar;

    let synced = 0;

    // Update boat if exists
    if (boatResult.rows.length > 0) {
      const localBoat = boatResult.rows[0];
      await pool.query(`
        UPDATE boats 
        SET name_en = $1, description_en = $2, price_amount = $3,
            capacity = $4, updated_at = CURRENT_TIMESTAMP,
            images = $5, name_ar = COALESCE($6, name_ar), description_ar = COALESCE($7, description_ar)
        WHERE id = $8
      `, [
        syncData.name_en, syncData.description_en, syncData.price, syncData.capacity,
        syncData.images_json, nameAr, descriptionAr, localBoat.id,
      ]);
      synced++;
    }

    // Update tour if exists
    if (tourResult.rows.length > 0) {
      const localTour = tourResult.rows[0];
      await pool.query(`
        UPDATE tours 
        SET name_en = $1, description_en = $2, price_amount = $3,
            max_guests = $4, updated_at = CURRENT_TIMESTAMP,
            images = $5, name_ar = COALESCE($6, name_ar), description_ar = COALESCE($7, description_ar)
        WHERE id = $8
      `, [
        syncData.name_en, syncData.description_en, syncData.price, syncData.capacity,
        syncData.images_json, nameAr, descriptionAr, localTour.id,
      ]);
      synced++;
    }

    return NextResponse.json({ success: true, activityId, synced });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
```

**Configure in Bokun dashboard:** Settings → Webhooks → Add endpoint URL `https://your-domain.com/api/bokun/webhook`

**CRITICAL: Bokun does NOT provide a programmatic API to register webhooks.** Webhook registration must be done manually through the Bokun Partner Dashboard. There is no REST/GraphQL endpoint to create, update, or manage webhooks via API. The Bokun developer docs (bokun.dev) only cover how to BUILD a webhook receiver, not how to register one programmatically.

**Bokun webhook headers** (sent with every webhook POST):
- `x-bokun-hmac` — SHA-256 HMAC hex digest of raw body (for signature validation)
- `x-bokun-apikey` — API key that identifies the Bokun account
- `x-bokun-experience-id` — Base64-encoded experience/activity ID
- `x-bokun-topic` — Event topic (e.g., `experiences/availability_update`)
- `x-bokun-vendor-id` — Base64-encoded vendor ID

**Supported webhook event topics:**
- `experiences/availability_update` — availability changed
- `experiences/product_update` — product details changed (title, description, images, pricing)

### Language Strategy (Arabic vs English)

**User preference:** Arabic descriptions in Bokun, then Boating translates to English.

**Problem:** Bokun widget does NOT auto-translate. If you put Arabic in Bokun, the English widget shows Arabic too.

**Solutions:**
1. **Use Bokun's multi-language feature** — Add both Arabic AND English descriptions in Bokun dashboard. Widget selects language based on `?lang=` parameter.
2. **Use English in Bokun** — Simplest. Widget shows English. Local database stores Arabic separately.
3. **Use Arabic in Bokun** — Widget shows Arabic in both languages (not ideal for English users).

**Recommended:** Option 1 (multi-language in Bokun) for best UX, or Option 2 (English in Bokun + Arabic in local DB) for simplicity.

## Live-verified platform facts (2026-09-04, read before claiming what Bokun can/cannot do)

Verified against the Boating account + official rest-v1/v2 OpenAPI specs:

1. **Sized photo variants exist.** `keyPhoto.derived` / `photos[].derived` is an **array of
   `{name, url}`** pointing at `imgcdn.bokun.tools` with `?w=NNN` sizes (~49KB) — while
   `originalUrl` is the 175KB–1.8MB full-res original. Typing `derived` as an object (not
   array) silently falls back to originalUrl — the classic cause of slow Bokun images on a
   site. Use `derived[].url` (match the needed width) and add `imgcdn.bokun.tools` to
   next/image remotePatterns + CSP img-src.
2. **City/type filtering belongs server-side.** v1 `POST /activity.json/search` accepts
   `facetFilters: [{name, values}]` — live-tested names: `city`, `country`,
   `activityCategories` (DIVING, SEA_ANGLING, SAILING_OR_BOAT_TOUR), `activityAttributes`
   (BEACH, GROUP_FRIENDLY, PRIVATE_ACTIVITY), `textFilter`, `comboActivity`. Use these to
   build site-side filters.
3. **The online-sales widget supports NO filter/search URL params.** Its bundles read only
   `language`, `experienceIds` (multi-checkout) and analytics params; the product-list
   widget has no search/filter UI. Don't re-probe this — filter in your own grid and
   deep-link per-product iframes.
4. **Bundles = combo products (v2):** `combo: {isCombo: true, ticketPerComboComponent,
   ticketComboComponents:[childIds]}`, but parent/child linkage lives on
   `startTimes[].comboStartTimeMappings[]` ({comboChildStartTimeId, inheritPickupFromParent,
   rateMappings, pricingCategoryMappings}); availability = intersection of parents; widget
   sells the combo as one product. Manage components via `GET/PUT /experience/{id}/components`.
5. **v2 update surface is sub-resource based:** `POST /experience` creates; **the
   `/experience/{id}` path is DELETE-only — there is no GET/PUT detail.** Edit via
   `/{id}/components`, `/{id}/photo` (upload), `/{id}/dailyPricing` (GET/POST/DELETE),
   `/{id}/allocations` (PUT), `/startTime/{id}/allocations`, `/{id}/availability/changed`.
6. **Location modeling:** v2 `location` is a GooglePlaceDto ({city, countryCode, lat, lng});
   v1 items carry `locationCode{country,location,name}` + googlePlace. Products with these
   fields unset are invisible to city facets — enrich products before building filters.

## Pitfalls

### 1. Activity Creation Returns 404
**Cause:** Wrong API endpoint or missing required fields
**Fix:** Ensure you're using `/activity.json` (not `/product.json`) and include required fields: `title`, `description`

### 2. Signature Authentication Fails
**Cause:** Date format mismatch or incorrect string concatenation order
**Fix:** Use exact format `YYYY-MM-DD HH:MM:SS` and concatenate as: `date + accessKey + method + path`

### 3. Timeouts on Slow Responses
**Cause:** Bokun API can be slow (5-15s)
**Fix:** Set 10s timeout with AbortController, implement retry logic (2-3 retries with 1s delay)

### 4. Missing Activity IDs After Creation
**Cause:** Activity created but response doesn't include ID
**Fix:** Check response structure - some endpoints return `id`, others return `activityId`

### 5. Currency Code Mismatches
**Cause:** Bokun expects ISO 4217 currency codes (SAR, USD, EUR)
**Fix:** Validate currency codes before sending, default to 'SAR' for Saudi market

### 6. Empty Results ≠ Broken API
**Cause:** New Bokun accounts have 0 activities - this is normal, not an error
**Fix:** Check response structure: `{"tookInMillis": 18, "totalHits": 0, "items": []}` with status 200 means API is working correctly. Empty results just mean no activities exist yet.

### 7. GET vs POST Endpoints
**Cause:** Bokun search endpoints require POST with body, GET returns 404
**Fix:** Always use POST for `/activity.json/search`, `/booking.json/search`, etc. GET is only for specific resource lookups like `/activity/{id}.json`

## Verification Protocol

Before claiming Bokun API is broken, verify:

```bash
# 1. Test authentication (should return 200 OK)
curl -X POST "https://api.bokun.io/activity.json/search?lang=EN&currency=SAR" \
  -H "Content-Type: application/json" \
  -H "X-Bokun-Date: $(date -u '+%Y-%m-%d %H:%M:%S')" \
  -H "X-Bokun-AccessKey: $BOKUN_ACCESS_KEY" \
  -H "X-Bokun-Signature: $SIGNATURE" \
  -d '{"paging":{"page":1,"perPage":10}}'

# Expected: HTTP 200 with {"totalHits": 0, "items": []} for new accounts
# This means API is WORKING, just empty

# 2. Verify fallback to database
# If Bokun returns empty results, check that your code falls back to local database
# This is the CORRECT behavior for new accounts
```

**API Status Indicators:**
- ✅ **Working**: HTTP 200, response has `tookInMillis`, `totalHits`, `items` fields (even if empty)
- ❌ **Broken**: HTTP 401/403 (auth failed), HTTP 500 (server error), timeout, network error
- ⚠️ **Empty but working**: HTTP 200 with `totalHits: 0` - this is normal for new accounts

**Common mistake**: Claiming API is broken when it returns 0 results. This is NOT a bug - it just means no activities exist yet. The fallback to database should handle this gracefully.

## Testing

Test Bokun integration with:
```bash
# Test activity search
curl -X POST "https://api.bokun.io/activity.json/search?lang=EN&currency=SAR" \
  -H "Content-Type: application/json" \
  -H "X-Bokun-Date: $(date -u '+%Y-%m-%d %H:%M:%S')" \
  -H "X-Bokun-AccessKey: $BOKUN_ACCESS_KEY" \
  -H "X-Bokun-Signature: $SIGNATURE" \
  -d '{"paging":{"page":1,"perPage":10}}'
```

## Booking Widgets (Client-Side Embeds)

Bokun provides embeddable booking widgets for websites — these are separate from the REST API and use a different authentication model (UUID-based, no HMAC).

### Widget Types

| Type | URL Pattern | Needs Product ID? |
|------|-------------|-------------------|
| **Product List** | `/online-sales/{channelUUID}/product-list` | ❌ No — shows all products |
| **Experience Calendar** | `/online-sales/{channelUUID}/experience-calendar/{productId}` | ✅ Yes — shows calendar for one product |
| **Product Page** | `/online-sales/{channelUUID}/experience/{productId}` | ✅ Yes — full product page |

### Embed Code Structure

Two parts required:

```html
<!-- 1. Loader script (once in <head>) -->
<script
  type="text/javascript"
  src="https://widgets.bokun.io/assets/javascripts/apps/build/BokunWidgetsLoader.js?bookingChannelUUID=YOUR_UUID"
  async
></script>

<!-- 2. Widget container (wherever you want it) -->
<div class="bokunWidget" data-src="https://widgets.bokun.io/online-sales/YOUR_UUID/product-list"></div>
<noscript>Please enable javascript in your browser to book</noscript>
```

### Getting the Booking Channel UUID

Owner must go to: **Sales Tools → Booking Widgets → Generate Embed Code** in Bokun dashboard. The UUID is in the script URL as `bookingChannelUUID=...`.

### React/Next.js Widget Component

**PREFERRED: Use direct iframe embed.** The BokunWidgetsLoader script approach (`div.bokunWidget` + `data-src`) is unreliable in production — it can hang on "Loading..." indefinitely even with correct CSP. The direct iframe approach is simpler, more reliable, and works consistently.

```tsx
"use client";
import { cn } from "@/lib/utils";

const BOOKING_CHANNEL_UUID = "YOUR_CHANNEL_UUID"; // From Bokun dashboard

export function BokunWidget({
  productId,
  locale = "ar",
  className,
}: { productId?: string; locale?: string; className?: string }) {
  const widgetUrl = productId
    ? `https://widgets.bokun.io/online-sales/${BOOKING_CHANNEL_UUID}/experience/${productId}?language=${locale}&primaryColor=1a2b4a&primaryHoverColor=2d4a7a`
    : `https://widgets.bokun.io/online-sales/${BOOKING_CHANNEL_UUID}?language=${locale}&primaryColor=1a2b4a&primaryHoverColor=2d4a7a`;

  return (
    <div className={cn("bokun-widget-container w-full rounded-lg overflow-hidden", className)}>
      <iframe
        src={widgetUrl}
        className="w-full min-h-[600px] border-0"
        frameBorder="0"
        allowFullScreen
        title={locale === "ar" ? "نظام الحجز" : "Booking System"}
      />
      <noscript>Please enable javascript in your browser to book</noscript>
    </div>
  );
}
```

**CSP requirements** (only `frame-src` needed for iframe approach):
```javascript
// next.config.mjs
const ContentSecurityPolicy = `
  default-src 'self';
  frame-src 'self' https://widgets.bokun.io https://book.bokun.io;
  connect-src 'self' https://widgets.bokun.io https://api.bokun.io;
  img-src 'self' data: https:;
  style-src 'self' 'unsafe-inline';
`;
```

**UNRELIABLE: BokunWidgetsLoader approach** (do NOT use — hangs in production):
The `BokunWidgetsLoader.js` script with `<div class="bokunWidget" data-src="...">` approach is documented by Bokun but consistently fails to render in Next.js on Cloud Run. The loader script loads successfully but the iframe never gets injected into the DOM. Symptoms: shows loading spinner indefinitely, `document.querySelectorAll('iframe')` returns 0 even though the script is present.

### Pitfall: Product List Widget When IDs Unknown

When you don't have Bokun product IDs yet (new account, products not synced), use the **Product List** widget — it shows ALL products from the Bokun account without needing any specific ID. This is the fallback that always works once the channel UUID is set.

### Pitfall: Widget Shows Nothing

If the widget renders but shows no products, it means:
1. The `bookingChannelUUID` is wrong or placeholder
2. No products exist in the Bokun account yet
3. The website domain is not registered as a booking channel in Bokun

### Pitfall: Getting Bokun Activity IDs from Dashboard (Not API)

When the Bokun v2 API returns 403 or auth errors, you can still get activity IDs from the Bokun dashboard UI:

1. **Login to Bokun dashboard** (e.g., `https://app.bokun.io`)
2. **Navigate to**: Products → Experiences
3. **Click on each experience** to view details
4. **Copy the Activity ID** from the URL or page (e.g., `5826321`)
5. **Update your database**:
   ```sql
   UPDATE boats SET bokun_activity_id = '5826321' WHERE slug = 'red-sea-explorer';
   UPDATE boats SET bokun_activity_id = '5826336' WHERE slug = 'coral-reef-voyager';
   ```

**Why this works:** The Bokun dashboard uses a different auth flow than the API. You can manually extract IDs when API integration fails or when you need to quickly link existing Bokun products to your local database.

**Alternative:** If you have Bokun API access, use the v1 search endpoint:
```bash
curl -X POST "https://api.bokun.io/activity.json/search?lang=EN&currency=SAR" \
  -H "Content-Type: application/json" \
  -H "X-Bokun-Date: $(date -u '+%Y-%m-%d %H:%M:%S')" \
  -H "X-Bokun-AccessKey: $BOKUN_ACCESS_KEY" \
  -H "X-Bokun-Signature: $SIGNATURE" \
  -d '{"paging":{"page":1,"perPage":10}}'
```

## Cloud Run Deploy: Source vs Image

When `gcloud run deploy --source` reports "Build failed" but Cloud Build logs show `Successfully built` + `PUSH ... DONE`, the image IS in the registry. Deploy it directly:

```bash
gcloud run deploy SERVICE --image gcr.io/PROJECT/IMAGE:latest --region REGION
```

This bypasses the source build step and uses the already-pushed image.

## Next.js + Database on Cloud Build

Pages that fetch data at build time (via `generateStaticParams()` or top-level `await` DB calls) will fail on Cloud Build because the build container has no database access. Fix: add `export const dynamic = "force-dynamic"` to every page that queries a database. This forces server-side rendering at runtime (where Cloud SQL is available) instead of static generation at build time.

## Credentials Management

### Option A: Deploy-Time Injection (Simple)

Store Bokun credentials in Google Cloud Secret Manager and inject as env vars at deploy time:
```bash
echo -n "your-access-key" | gcloud secrets create BOKUN_ACCESS_KEY --data-file=- --project=PROJECT_ID
echo -n "your-secret-key" | gcloud secrets create BOKUN_SECRET_KEY --data-file=- --project=PROJECT_ID

# Grant access to Cloud Run service account
gcloud secrets add-iam-policy-binding BOKUN_ACCESS_KEY --member="serviceAccount:SA_EMAIL" --role="roles/secretmanager.secretAccessor"
gcloud secrets add-iam-policy-binding BOKUN_SECRET_KEY --member="serviceAccount:SA_EMAIL" --role="roles/secretmanager.secretAccessor"

# Deploy with secrets
gcloud run deploy SERVICE --update-secrets="BOKUN_ACCESS_KEY=BOKUN_ACCESS_KEY:latest,BOKUN_SECRET_KEY=BOKUN_SECRET_KEY:latest"
```

### Option B: Runtime Secret Manager Client (Preferred for Next.js)

For Next.js apps where you want dynamic credential loading with caching and fallback:

**Install:** `npm install @google-cloud/secret-manager`

**Secret Manager client** (`lib/secret-manager.ts`):
```typescript
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const secretCache = new Map<string, { value: string; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let client: SecretManagerServiceClient | null = null;

function getClient(): SecretManagerServiceClient {
  if (!client) client = new SecretManagerServiceClient();
  return client;
}

export async function getSecret(secretName: string, projectId?: string): Promise<string> {
  const cacheKey = `${projectId || 'default'}:${secretName}`;
  const cached = secretCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const smClient = getClient();
  const name = projectId
    ? `projects/${projectId}/secrets/${secretName}/versions/latest`
    : `secrets/${secretName}/versions/latest`;

  const [version] = await smClient.accessSecretVersion({ name });
  const secretValue = version.payload?.data?.toString('utf8') || '';
  if (!secretValue) throw new Error(`Secret ${secretName} is empty`);

  secretCache.set(cacheKey, { value: secretValue, expires: Date.now() + CACHE_TTL });
  return secretValue;
}

export async function getBokunCredentials(): Promise<{ accessKey: string; secretKey: string }> {
  try {
    const [accessKey, secretKey] = await Promise.all([
      getSecret('bokun-access-key'),
      getSecret('bokun-secret-key'),
    ]);
    return { accessKey, secretKey };
  } catch {
    // Fallback to environment variables
    const accessKey = process.env.BOKUN_ACCESS_KEY;
    const secretKey = process.env.BOKUN_SECRET_KEY;
    if (!accessKey || !secretKey) {
      throw new Error('Bokun credentials not found in Secret Manager or environment variables');
    }
    return { accessKey, secretKey };
  }
}
```

**Integration with bokunRequest:** Instead of reading env vars at module load time, call `ensureCredentials()` at request time:
```typescript
let cachedAccessKey: string | null = null;
let cachedSecretKey: string | null = null;

async function ensureCredentials() {
  if (cachedAccessKey && cachedSecretKey) return { accessKey: cachedAccessKey, secretKey: cachedSecretKey };
  const creds = await getBokunCredentials();
  cachedAccessKey = creds.accessKey;
  cachedSecretKey = creds.secretKey;
  return creds;
}

// In bokunRequest:
const { accessKey, secretKey } = await ensureCredentials();
const signature = generateSignature(date, method, path, accessKey, secretKey);
```

**Pitfall:** The `@google-cloud/secret-manager` package uses `#private` fields in its type definitions. If your `tsconfig.json` targets ES2014 or lower, you'll get `TS18028: Private identifiers are only available when targeting ECMAScript 2015 and higher`. These errors come from `node_modules/` types (gaxios, google-auth-library, gtoken) — they don't affect runtime. Ensure `"target": "ES2017"` or higher in tsconfig.

**Secret names in Secret Manager:** Use lowercase with hyphens: `bokun-access-key`, `bokun-secret-key`. The gcloud CLI secret names (uppercase) are for deploy-time injection (Option A); the runtime client (Option B) uses its own naming.

**IAM required:** The Cloud Run service account needs `roles/secretmanager.secretAccessor` on the project or specific secrets.

### Pitfall: Cloud Run Environment Variables Not Available

When deploying to Cloud Run, environment variables set in `.env.production.local` are NOT automatically available at runtime. They must be explicitly set via `gcloud run services update --update-env-vars` or via Secret Manager.

```bash
# Set env vars directly (for non-secret values)
gcloud run services update SERVICE --region REGION --project PROJECT \
  --update-env-vars="BOKUN_ACCESS_KEY=xxx,BOKUN_SECRET_KEY=yyy"

# OR use Secret Manager (preferred for secrets)
gcloud run services update SERVICE --region REGION --project PROJECT \
  --update-secrets="BOKUN_ACCESS_KEY=bokun-access-key:latest,BOKUN_SECRET_KEY=bokun-secret-key:latest"
```

**Symptom:** API calls fail with "credentials not available" even though they work locally. The fix is always to check Cloud Run env vars, not the source code.

## Multi-Product Shopping Cart (Bokun Online Sales)

Bokun supports booking multiple experiences in a single checkout via the Online Sales widget. This allows users to add multiple tours/experiences to a cart and checkout once.

### Architecture

1. **Local cart state** — managed via `localStorage` + `CustomEvent` for cross-component communication
2. **Checkout redirect** — opens Bokun Online Sales with multiple `experienceIds` as query params
3. **No server-side cart needed** — Bokun handles all checkout logic

### Implementation Pattern

```tsx
// components/booking/ShoppingCart.tsx
"use client";
import { useEffect, useState } from "react";

interface CartItem {
  id: string;        // Bokun activity/experience ID
  name: string;
  nameAr?: string;
  price: number;
  currency: string;
  quantity: number;
  image?: string;
}

const BOOKING_CHANNEL_UUID = "YOUR_UUID";

export function ShoppingCart({ locale = "ar" }: { locale?: string }) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  useEffect(() => {
    // Load from localStorage
    const saved = localStorage.getItem("bokun_cart");
    if (saved) setCartItems(JSON.parse(saved));

    // Listen for add-to-cart events from any component
    const handler = (event: CustomEvent<CartItem>) => {
      setCartItems((prev) => {
        const existing = prev.find((item) => item.id === event.detail.id);
        const newCart = existing
          ? prev.map((item) => item.id === event.detail.id
              ? { ...item, quantity: item.quantity + 1 } : item)
          : [...prev, { ...event.detail, quantity: 1 }];
        localStorage.setItem("bokun_cart", JSON.stringify(newCart));
        return newCart;
      });
    };

    window.addEventListener("add-to-cart", handler as EventListener);
    return () => window.removeEventListener("add-to-cart", handler as EventListener);
  }, []);

  const handleCheckout = () => {
    // Build Bokun multi-product URL
    const productIds = cartItems.map((item) => item.id).join(",");
    const url = `https://widgets.bokun.io/online-sales/${BOOKING_CHANNEL_UUID}?experienceIds=${productIds}`;
    window.open(url, "_blank");
    localStorage.removeItem("bokun_cart");
    setCartItems([]);
  };

  // ... render cart UI with quantity controls, remove, total
}
```

### Add-to-Cart Button Pattern

```tsx
// components/booking/AddToCartButton.tsx
export function AddToCartButton({ tour, locale }: { tour: CartItem; locale: string }) {
  const handleAdd = () => {
    window.dispatchEvent(new CustomEvent("add-to-cart", { detail: tour }));
  };
  return (
    <button onClick={handleAdd}>
      {locale === "ar" ? "أضف إلى السلة" : "Add to Cart"}
    </button>
  );
}
```

### Key Points

- **Only show "Add to Cart" for tours with `bokun_activity_id`** — filter out non-Bokun tours
- **Use `CustomEvent` pattern** — allows any component to add items without prop drilling
- **localStorage persistence** — cart survives page refreshes
- **Bokun checkout URL** — `?experienceIds=id1,id2,id3` opens multi-product checkout
- **ShoppingCart component** — place in the page layout (not inside server components)

### Pitfall: ShoppingCart in Server Components

`ShoppingCart` uses `useState`, `useEffect`, and `localStorage` — it MUST be in a client component. If your page is a server component (e.g., `app/[locale]/tours/page.tsx`), add `ShoppingCart` inside a client component wrapper like `TourListingClient`.
