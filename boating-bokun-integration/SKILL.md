---
name: boating-bokun-integration
description: Bokun API integration for Boating KSA - location field pitfall + common pitfalls, solutions, and best practices. Load this skill when working with Bokun widgets, API calls, or tour synchronization.
tags: [bokun, api, widgets, boating, integration]
triggers:
  - bokun
  - tour sync
  - widget
  - booking
---

# Bokun Integration - Boating KSA

## Critical Configuration

### Environment Variables (Cloud Run)
```bash
# REQUIRED for Bokun Widgets to work in Frontend
NEXT_PUBLIC_BOKUN_CHANNEL_UUID=9ce5dbac-a6d4-468a-ab56-5f261685f66a

# API Keys (stored in GCP Secrets)
BOKUN_ACCESS_KEY=<from-secrets>
BOKUN_API_KEY=<from-secrets>
BOKUN_SECRET_KEY=<from-secrets>
```

**CRITICAL**: Any environment variable used in Frontend components (like Bokun Widget) MUST start with `NEXT_PUBLIC_` or it won't be available to Client Components.

## Common Pitfalls & Solutions

### PITFALL: two timezone classes — business "today" must be Asia/Riyadh, wire time stays UTC
lib/ksa-date.ts (todayInKsa/monthKeyInKsa, Intl forced timeZone:'Asia/Riyadh',
host-independent so SSR===hydration) is the ONLY source for customer-facing
"today": widget opening month, search min-date, availability windows. Cloud Run
runs UTC; KSA is fixed +03 with no DST, so 00:00-02:59 Riyadh reads as YESTERDAY
on a UTC clock (verified 2026-09-20). NEVER convert with +03: Bokun HMAC
timestamps, Postgres timestamps, and availability ms-epoch dates (UTC-midnight
convention — converting shifts every trip a day). New date UI: ask "what clock
would the customer read?"

### PITFALL: Bokun rates = trip "options" — sell ALL of them, never just the default
Owner configures per-trip options (e.g. "Khor round trip" vs "Bayadhah Island
Trip") as additional RATES on the SAME activity + departure; the availability
entry carries them in `rates[]` + `pricesByRate[]`, with `defaultRateId` marking
which one Bokun's own widget preselects; each rate carries its own title+price. normalizeSlots (lib/bokun/slots.ts) now emits ONE Slot PER
PRICED RATE; multi-rate entries key as `entryId#rateId`, single-rate entries keep
Bokun's bare id untouched. findSlot's legacy shim resolves a bare key that misses
to the first (default-rate) slot so pre-multi-rate `bokun_bookings.slot_id` rows
still settle. Checkout/settlement needed no change — rateId always rode on the
slot. Rate titles come from Bokun (English only until the owner adds AR in the
dashboard). Live-verified 2026-09-19 on Lolo 1284355.

### PITFALL: Bokun search payload has NO flat location/city/country fields
The city lives ONLY in `googlePlace.city` (preferred) and `locationCode.location`
(verified live 2026-09-17, activity 1287936). Reading `item.location || item.city
|| 'Jeddah'` — as five call sites used to — mislabelled the Yanbu diving trip as
Jeddah (customer complaint). Single extractor now: `pickBokunActivityLocation()`
in lib/bokun-api.ts (googlePlace.city → locationCode.location → name → ""; never
invents a city). Fixtures in __tests__/lib/bokun-location.test.ts are verbatim
real payloads. The DB sync path (app/api/bokun/sync) was already reading them
correctly. NOTE lib/bokun-sync.ts lines ~77/122 hardcode city:'Jeddah' when
PUSHING boat data to Bokun (create path) — if a boat is not in Jeddah, the
Bokun-side address is wrong at creation; review before creating Yanbu listings.

### 1. Bokun API Response Structure
**Problem**: API returns data in `items` array, NOT `results`.
```typescript
// WRONG ❌
const tours = response.data.results;

// CORRECT ✅
const tours = response.data.items;
```

### 2. Bokun API Endpoints & Authentication
**Correct endpoints**:
- Search activities: `POST /activity.json/search` ✅ WORKS — use this for all activity lookups
- ~~Get activity by ID: `GET /activity.json/{id}`~~ ❌ **BROKEN (2026-07-22)** — returns 404 for ALL IDs, even valid ones. DO NOT USE. See Section 29.
- Get product list: `GET /product-list.json`

**⚠️ CRITICAL (2026-07-22)**: The `getActivity(id)` endpoint (`/activity/{id}.json`) returns `Bókun API Error 404` for every activity ID, including known-valid ones (1251403, 1258054, 1251353). This is NOT a credential or rate-limit issue — the endpoint is broken/deprecated on Bokun's side. **Always use `searchActivities()` and find the matching item from results.** Do NOT import or call `getActivity()` anywhere. See Section 32.

**Authentication** uses HMAC-SHA1 signature (NOT simple key headers):
```typescript
import * as crypto from 'crypto';

function generateSignature(date: string, accessKey: string, method: string, path: string, secretKey: string): string {
  const stringToSign = `${date}${accessKey}${method}${path}`;
  const hmac = crypto.createHmac('sha1', secretKey);
  hmac.update(stringToSign, 'utf-8');
  return hmac.digest('base64');
}

// Required headers for every request:
// X-Bokun-Date: "YYYY-MM-DD HH:mm:ss" (UTC)
// X-Bokun-AccessKey: <access_key>
// X-Bokun-Signature: <hmac_sha1_base64>
// Content-Type: application/json;charset=UTF-8
// Accept: application/json
```

**CRITICAL**: The date header format MUST be `YYYY-MM-DD HH:mm:ss` in UTC. The signature is computed over `${date}${accessKey}${method}${path}` (no spaces between parts).

### 3. Widget Loading Issues
**Problem**: Bokun Widget doesn't load on page.

**Two approaches — both can work:**

#### Option A: Official BokunWidgetsLoader (RECOMMENDED when you have the official embed code)
When the user provides the official Bokun embed code from their dashboard, use the `BokunWidgetsLoader.js` approach:

```tsx
"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const BOOKING_CHANNEL_UUID = "9ce5dbac-a6d4-468a-ab56-5f261685f66a";
const BOKUN_WIDGETS_LOADER = `https://widgets.bokun.io/assets/javascripts/apps/build/BokunWidgetsLoader.js?bookingChannelUUID=${BOOKING_CHANNEL_UUID}`;

export function BokunWidget({ productId, locale = "ar", className }: BokunWidgetProps) {
  const [widgetLoaded, setWidgetLoaded] = useState(false);

  const widgetUrl = productId
    ? `https://widgets.bokun.io/online-sales/${BOOKING_CHANNEL_UUID}/experience/${productId}`
    : `https://widgets.bokun.io/online-sales/${BOOKING_CHANNEL_UUID}`;

  useEffect(() => {
    const existingScript = document.querySelector(`script[src="${BOKUN_WIDGETS_LOADER}"]`);
    
    if (existingScript) {
      if (window.BokunWidgetsLoader) {
        window.BokunWidgetsLoader.refresh();
      }
      setWidgetLoaded(true);
      return;
    }

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = BOKUN_WIDGETS_LOADER;
    script.async = true;
    script.onload = () => setWidgetLoaded(true);
    script.onerror = () => console.error("Failed to load BokunWidgetsLoader");

    document.body.appendChild(script);
  }, [productId]);

  return (
    <div className={cn("min-h-[500px] w-full rounded-lg overflow-hidden relative", !widgetLoaded && "animate-pulse bg-gray-100", className)}>
      <div className="bokunWidget w-full min-h-[500px]" data-src={widgetUrl} />
      <noscript>Please enable javascript in your browser to book</noscript>
      {!widgetLoaded && (
        <div className="flex items-center justify-center h-full min-h-[500px] absolute inset-0 bg-white/80 z-10">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-nautical-gold border-t-transparent"></div>
            <p className="mt-4 text-sm text-deep-sea/60">
              {locale === "ar" ? "جارٍ تحميل نظام الحجز..." : "Loading booking system..."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
```

**Key requirements for BokunWidgetsLoader:**
- Use the exact `bookingChannelUUID` from the Bokun dashboard embed code
- The `div.bokunWidget` with `data-src` attribute is the official pattern
- Load the script dynamically in `useEffect` (not via Next.js `<Script>` component)
- Check if script already exists before adding it again
- Call `window.BokunWidgetsLoader.refresh()` when script is already loaded

**CSP requirements for BokunWidgetsLoader:**
```javascript
// next.config.mjs - headers section
{
  key: "Content-Security-Policy",
  value: "... script-src 'self' https://widgets.bokun.io https://static.bokun.io; frame-src 'self' https://widgets.bokun.io;"
}
```
Both `widgets.bokun.io` and `static.bokun.io` must be in `script-src` for the loader to work.

#### Option B: Direct iframe (fallback if loader fails)
If the BokunWidgetsLoader approach doesn't work, fall back to a direct `<iframe>`:

```tsx
<iframe
  src={widgetUrl}
  className="w-full h-full min-h-[500px] border-0"
  onLoad={() => setWidgetLoaded(true)}
  title="Bokun Booking Widget"
  allow="payment"
/>
```

**CSP requirements for direct iframe** (simpler):
```javascript
{
  key: "Content-Security-Policy",
  value: "... frame-src 'self' https://widgets.bokun.io;"
}
```
Only `frame-src` needs `widgets.bokun.io`. You do NOT need `static.bokun.io` in `script-src` when using direct iframe.

### 4. Widget URLs
**Experience** (shows description, images AND booking - PREFERRED for detail pages):
```
https://widgets.bokun.io/online-sales/{CHANNEL_UUID}/experience/{PRODUCT_ID}?language={locale}&primaryColor=1a2b4a&primaryHoverColor=2d4a7a
```
**NOTE**: This is the correct URL for full experience pages with images, description, calendar, and booking form. Tested and confirmed working.

**Product Page** (DOES NOT WORK as expected - returns blank/minimal page):
```
https://widgets.bokun.io/online-sales/{CHANNEL_UUID}/product-page/{PRODUCT_ID}?language={locale}
```
**WARNING**: Despite the name suggesting it would be ideal for detail pages, testing on 2026-07-19 showed this returns a minimal page with only currency selector and close button. Use `/experience/` instead.

**Experience Calendar** (calendar-only for specific product):
```
https://widgets.bokun.io/online-sales/{CHANNEL_UUID}/experience-calendar/{PRODUCT_ID}?lang={locale}
```

**Product List** (shows all products without needing specific IDs):
```
https://widgets.bokun.io/online-sales/{CHANNEL_UUID}/product-list?lang={locale}
```

**General Booking** (no specific product - shows all experiences):
```
https://widgets.bokun.io/online-sales/{CHANNEL_UUID}?language={locale}&primaryColor=1a2b4a&primaryHoverColor=2d4a7a
```

**Loader Script**:
```
https://widgets.bokun.io/assets/javascripts/apps/build/BokunWidgetsLoader.js?bookingChannelUUID={CHANNEL_UUID}
```

### 4b. Bokun Terminology: Experience = Activity
In Bokun, "Experience" (UI/dashboard term) and "Activity" (API/backend term) are the **same thing**. When a user says "I created an experience in Bokun", the corresponding field in the local DB is `bokun_activity_id`. No separate "activity" needs to be created - the experience IS the activity.

### 5. Tour Synchronization
**Problem**: Tours from Bokun don't appear in local database.

**Solution**:
1. Use `/api/bokun/sync` endpoint to trigger manual sync
2. Sync should be automatic (on-demand) when page loads, NOT via cron job
3. Ensure `bokun_activity_id` is included in API response:
```typescript
// In /app/api/tours/route.ts
SELECT t.*, t.bokun_activity_id, ...
```

### 5a. Tour Listing Must Filter to Real Bokun Experiences Only
**Problem**: The tours listing page (`/ar/tours`) shows ALL tours in the database, including test/seed data that has no real Bokun experience linked.

**Solution**: Filter the frontend to only show tours with a valid `bokun_activity_id`:
```typescript
// In TourList.tsx - after fetching tours from API
const allTours = data.tours || [];
const bokunTours = allTours.filter((tour) => tour.bokun_activity_id);
setTours(bokunTours);
```

**Why**: The database may contain 10+ tours from seed data, but only 2 have real Bokun experiences (e.g., لولو البحر `1251353`, White Orca `1251403`). Users should only see bookable experiences.

**Verification**:
```bash
# Check which tours have real Bokun IDs
curl -s https://boatingksa.com/api/tours | python3 -c "
import sys,json
d=json.load(sys.stdin)
for t in d.get('tours',[]):
    print(f'{t.get(\"name_ar\")} - bokun_id: {t.get(\"bokun_activity_id\",\"NONE\")}')
"
```

### 5c. Bokun HTML Descriptions Need Proper Rendering
**Problem**: Tour descriptions from Bokun contain HTML tags (`<p>`, `<strong>`, etc.) that appear as raw text on the page.

**Two approaches depending on context:**

**A) Card previews / listing pages — STRIP tags (plain text excerpt):**
```tsx
// In TourList.tsx or any card/preview component
{description && (
  <p className="text-sm text-deep-sea/60 mb-4 line-clamp-2">
    {description.replace(/<[^>]*>/g, "").trim()}
  </p>
)}
```
Use this for small cards where you just need a text excerpt. Rendering full HTML inside a `line-clamp-2` paragraph looks broken.

**B) Detail pages — RENDER HTML with `dangerouslySetInnerHTML`:**
```tsx
{description ? (
  <div 
    className="text-deep-sea/70 leading-relaxed prose prose-sm max-w-none"
    dangerouslySetInnerHTML={{ __html: description }}
  />
) : (
  <p className="text-deep-sea/70">{t("noDescription")}</p>
)}
```

**Note**: Bokun descriptions are trusted content (from the Bokun dashboard), so `dangerouslySetInnerHTML` is safe here.

**Pitfall (found 2026-07-19)**: The `/ar/tours` listing page was showing raw HTML like `<p style="font-size:14px;...">` as visible text. The fix was stripping tags for the card preview (approach A), NOT rendering HTML. Always match the approach to the display context.

### 5b. Adding New Experiences from Bokun
When a user creates a new Experience in Bokun dashboard:

**Step 1**: Verify it's visible via API:
```bash
curl -s "https://boating-app-f3zj23hsma-uc.a.run.app/api/bokun/sync" | jq '.activities[] | {id, title, price}'
```

**Step 2**: Check if already linked to local tours:
```bash
curl -s "https://boating-app-f3zj23hsma-uc.a.run.app/api/tours" | jq '.tours[] | {name: .name_en, slug: .slug, bokun_activity_id}'
```

**Step 3**: If not linked, either:
- **Auto-sync**: `POST /api/bokun/sync/manual` (pulls from Bokun → local)
- **Manual**: Create tour locally with `bokun_activity_id` field set
- **API**: `POST /api/tours` with `bokun_activity_id` in payload

**Verification**: Navigate to `/en/tours/[slug]` and check console:
```javascript
const iframe = document.querySelector('iframe[title="Bokun Booking Widget"]');
console.log(iframe.src); // Should contain the activity ID
```

### 6. Image URLs from Bokun
Bokun stores images in S3 and serves via CDN:
```
Original: https://bokun.s3.amazonaws.com/{uuid}.jpeg
CDN:      https://imgcdn.bokun.tools/{uuid}.jpeg?w=660&h=660
```

**Image extraction** from activity detail response:
```typescript
// activity.photos[] and activity.keyPhoto contain image objects
// Each has: originalUrl, derived[] (thumbnail/preview/large)
const images = [];
if (activity.photos?.length) {
  for (const img of activity.photos) {
    if (img.originalUrl) images.push(img.originalUrl);
  }
}
if (activity.keyPhoto?.originalUrl) {
  if (!images.includes(activity.keyPhoto.originalUrl)) {
    images.unshift(activity.keyPhoto.originalUrl); // key photo first
  }
}
```

**CRITICAL: Next.js Image Config** — Add Bokun domains to `next.config.js`:
```javascript
images: {
  remotePatterns: [
    { protocol: 'https', hostname: 'bokun.s3.amazonaws.com' },
    { protocol: 'https', hostname: 'imgcdn.bokun.tools' },
  ],
}
```
Without this, Next.js `<Image>` blocks all Bokun-hosted images even if URLs are correct in the DB.

**PERFORMANCE: Use regular `<img>` for Bokun S3 images** — Next.js `<Image>` component adds server-side optimization overhead that causes slow loading for external images. For Bokun S3 images, use regular `<img>` tags:
```tsx
// WRONG ❌ - Slow loading due to Next.js optimization overhead
<Image
  src={mainImage}
  alt={name}
  fill
  className="object-cover"
  priority
/>

// CORRECT ✅ - Fast loading, direct from S3
{mainImage.includes('bokun.s3.amazonaws.com') ? (
  <img
    src={mainImage}
    alt={name}
    className="absolute inset-0 w-full h-full object-cover"
    loading="eager"
  />
) : (
  <Image
    src={mainImage}
    alt={name}
    fill
    className="object-cover"
    priority
  />
)}
```
**When to use**: For external CDN images (Bokun S3, Unsplash, etc.), regular `<img>` is faster. Use Next.js `<Image>` only for local/static images where optimization provides real benefit.

### 7. Search Widget Auto-Load Pattern
**Problem**: When there's only one destination (e.g., only Jeddah), requiring users to search by city is pointless friction.

**Solution**: Auto-load all available products on page load:
```typescript
// In SearchWidget component
useEffect(() => {
  const loadAllProducts = async () => {
    const response = await fetch("/api/bokun/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ destination: "", dates: "", guests: 1, category: "all" }),
    });
    // ... map and set results
  };
  loadAllProducts();
}, []);
```

**API side**: Remove the validation that requires destination/dates:
```typescript
// WRONG ❌ - Forces user to search
if (!destination && !dates) {
  return Response.json({ success: false, error: 'Please provide destination or dates' }, { status: 400 });
}

// CORRECT ✅ - Return all products when no criteria
const response = await searchProducts(locale, currency, 1, 50);
let results = (response.items || []) as BokunRawItem[];
// ... map to clean shape
```

**When to use**: Single-city operations, small catalogs (<50 items), or when you want to showcase everything immediately.

### 8. Bokun Raw Item Field Mapping
**Problem**: Bokun API returns raw items with different field names than what the frontend expects.

**Solution**: Map raw Bokun fields to clean SearchResult shape:
```typescript
interface BokunRawItem {
  id?: number | string;
  title?: string;
  summary?: string;        // Long description
  excerpt?: string;        // Short description
  price?: number;          // Direct number, NOT {amount, currency}
  keyPhoto?: { originalUrl?: string };
  images?: Array<{ url?: string }>;
  maxCapacity?: number;
  location?: string;
  city?: string;
  country?: string;
  durationText?: string;   // e.g., "1 hour"
  activityCategories?: string[];
}

// Mapping function
const mapBokunItem = (item: BokunRawItem, idx: number): SearchResult => {
  const images: Array<{ url: string }> = [];
  if (item.keyPhoto?.originalUrl) {
    images.push({ url: item.keyPhoto.originalUrl });
  }
  if (item.images) {
    for (const img of item.images) {
      if (img.url) images.push({ url: img.url });
    }
  }

  return {
    id: typeof item.id === 'string' ? parseInt(item.id, 10) : (item.id || idx),
    title: item.title || 'Untitled',
    description: item.summary || item.excerpt || '',
    price: { amount: item.price || 0, currency: 'SAR' },
    images,
    maxCapacity: item.maxCapacity || 0,
    location: item.location || item.city || item.country || 'Jeddah',
    duration: item.durationText || '',
    category: item.activityCategories?.[0]?.toLowerCase() || 'tours',
    slug: (item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-') || `tour-${idx}`,
    available: true,
  };
};
```

**Key differences**:
- `price` is a direct number, not `{amount, currency}` object
- `summary`/`excerpt` map to `description`
- `keyPhoto.originalUrl` is the primary image
- `durationText` is pre-formatted (e.g., "1 hour")
- `location` may be in `location`, `city`, or `country` fields

See `references/bokun-field-mapping.md` for complete field reference.

### 9. Invalid Activity IDs (Ghost Sync Failures)
**Problem**: Tours/boats in the local DB may have `bokun_activity_id` values that don't exist in Bokun (return 404). These were created from test data, seed scripts, or deleted Bokun activities. The sync code tries to fetch details for these IDs, gets 404 errors, and silently skips image updates.

**Known invalid IDs** (as of 2026-07-13): 1251390-1251397, 5826321, 5826336, 1250209, TEST-*.

**Only valid activity IDs**: 1251403 (Jeddah Lion), 1251353 (لولو البحر).

**Fix**: Always validate activity existence before syncing:
```typescript
let details;
try {
  details = await getActivityDetails(activity.id);
} catch {
  console.warn(`Activity ${activity.id} not found in Bokun, skipping`);
  throw new Error(`Activity ${activity.id} does not exist in Bokun`);
}
```

**Cleanup invalid IDs from DB**:
```sql
-- Clear invalid tour activity IDs
UPDATE tours SET bokun_activity_id = NULL
WHERE bokun_activity_id NOT IN (SELECT DISTINCT bokun_activity_id FROM tours WHERE bokun_activity_id IS NOT NULL);
-- Then verify each ID returns 200 from Bokun API before keeping it
```

### 33. Experience Videos (added 2026-08-25)
Bokun activities carry a `videos` field (array of YouTube/Vimeo URLs, added in dashboard → experience → Media → Videos; full URLs only, not short links). All 5 experiences had it empty — owner never added any. `components/ui/ProductVideoSection.tsx` now renders them on tours/[slug] and boats/[slug] (converts watch URLs to youtube-nocookie/player.vimeo embeds; handles string or {url|videoUrl|embedUrl} objects). CSP frame-src includes youtube-nocookie.com, youtube.com, player.vimeo.com (next.config.mjs). So "cannot add videos" = owner dashboard step + this section displays them automatically.

### 34. Contact Form & List-Boat Persistence (2026-08-25)
- Official inboxes ONLY (owner directive): hello@boatingksa.com = SALES, ops@boatingksa.com = OPERATIONS. admin@boatingksa.com is NOT a real mailbox (login only). Contact form → hello@; boat listing requests → ops@.
- Sending domain: info@info.boatingksa.com (verified in Resend, EU region; records on Hostinger boatingksa.com zone — second Hostinger account, manual hPanel edits). Old sender noreply@send.allam.world deprecated.
- `/api/contact` persists to PostgreSQL `contact_messages` (never lose a message). `/api/list-boat` was BROKEN: form sent JSON {name,phone,email,boatType,capacity,marina} but route expected formData boatName/ownerName/ownerEmail → every submission failed silently + data only console-logged. Rewritten: accepts both shapes, saves to `boat_listing_requests`, emails ops@. Review UI: `/admin/listing-requests` (Boat Requests nav item, approve/reject, API /api/admin/listing-requests GET/PATCH).
- RESEND_API_KEY (resend-api-key secret) is send-only restricted — cannot list emails/domains via API.
- bokun_bookings/contact tables live in Cloud SQL boating-db; direct psql: <boating-db-host> user boating_user db boating (secret DB_PASSWORD).

### 35. "Owner updated Bokun availability but site shows none" (2026-09-13)
First suspect the OWNER'S DATA, not the sync. Direct Bokun API check (creds: `gcloud secrets versions access latest --secret=bokun-access-key/--secret=bokun-secret-key --project=boating-499409`; HMAC string = date+AK+METHOD+path):
- `GET /activity.json/{id}/availabilities?start=&end=` → does Bokun itself have the dates?
- `GET boatingksa.com/api/bokun/availability?activityId=&start=&end=` → what does the site see?
Bokun HAS dates + site slots:[] = our normalizeSlots dropped them. Two known causes:
1. **PER-BOOKING FLAT PRICING (fixed c8f0350 2026-09-13)**: rate `pricedPerPerson:false` → Bokun sends `pricePerBooking` + EMPTY `pricePerCategoryUnit`; old code dropped every slot → whole product off sale (this is what hit Lolo 1284355: owner created a NEW experience, flat 1500 SAR, 90 dates, site showed none). Now `slot.pricingModel: 'per_person'|'per_booking'`; quote() charges flat amount once (count still = participants for capacity); PartySelector shows 'per booking' label. NOTE: owner set availability on NEW activity **1284355** (also titled "Lolo of the sea") while OLD **1251353** has ZERO dates for the next 6 months — two dupes live; site's /api/bokun/products + slug `lolo-of-the-sea` resolve to 1284355. Tell owner to archive/stop selling 1251353 or link the old slug if bookings exist there.
2. **NO dates at all in Bokun** for that activity (White Orca 1251403 + old Lolo 1251353 = 0 entries for 6 months as of 2026-09-13) → owner edited the wrong experience or availability didn't save; dashboard fix only.
Also: there is NO webhook traffic hitting /api/webhooks/bokun (Cloud Run logs: 0 requests) — availability is read LIVE per request (2-min cache + per-month widget fetch), so Bokun dashboard changes propagate within ~2 min once slots aren't dropped. Product data (title/price/image) similarly live; /api/bokun/products 60s single-flight cache.

### 36. Webhook receiver exists but Bokun never calls it
Cloud Run logs show zero POSTs to /api/webhooks/bokun ever. Not needed for availability (live fetch) but any webhook-dependent feature must be re-verified: registration is dashboard-only (Settings → Webhooks) and may simply never have been configured.

### 39. "No permission to access web services" — API keys revoked account-wide (2026-09-14 18:00)
Symptom: site tours/boats listings + diving section go EMPTY (products API returns 0), /api/bokun/search 500s, availability 502s; Cloud Run logs show `Bókun API Error 400 on POST /activity.json/search: "No permission to access web services."`. Confirmed NOT a code/secret-rotation issue: the SAME access/secret pair that worked hours earlier fails on v1 AND v2 AND both stored secrets → Bokun-side revocation. Hosted widget pages also break (widget HTML embeds `window.bookingChannelUUID = ''`). Data in the account survives — it's auth. FIX IS DASHBOARD-ONLY: app.bokun.io (or extranet.bokun.io) → Settings → Integrations/Web Services → re-enable web services / regenerate access key + secret, then update GCP secrets BOKUN_ACCESS_KEY/BOKUN_SECRET_KEY (new version) and `gcloud run services update boating-app --update-secrets=... --region=us-central1` (no rebuild needed; redeploy if that fails). Verify: `curl -X POST https://api.bokun.io/activity.json/search` with fresh HMAC returns 200, then site /api/bokun/products non-empty.

### 37. Flip a rate per-person → per-booking (flat price) via API (CONFIRMED 2026-09-13, worked on all 4 boats)
`PUT /restapi/v2.0/experience/{id}/components` with HMAC-SHA1 (same signer as v1). Steps:
1. `GET /restapi/v2.0/experience/{id}/components?componentType=RATES&componentType=PRICING` — copy rate id/title/pickup/dropoff/cancellationPolicyId/min/maxPerBooking + price-rule ids.
2. PUT body: `rates.rates[]` with `pricedPerPerson:false` + `allStartTimes:true` + `allPricingCategories:true`; `rates.defaultRate:{id}`; `pricing.experiencePriceRules[]` = ONE rule `{rate:{id},priceCatalogId,currency:'SAR',amount:'<string>'}` with NO pricingCategoryId (= flat per-booking). Omitted old rules are DELETED (category rules like Children:0 drop out cleanly).
3. DTO quirks (validated by 400s): `tieredPricingEnabled` must be OMITTED for pricedPerPerson:false rates and PRESENT (false) for pricedPerPerson:true rates. Price-rule `id` from GET is rejected on PUT ("refers to invalid id") — resend rules WITHOUT id as new. `amount` must be a STRING. No publish endpoint — PUT is live immediately.
4. Verify: `GET /activity.json/{id}/availabilities` → pricesByRate shows `pricePerBooking:{amount}`; site `/api/bokun/availability` → `pricingModel:'per_booking'` + categories[0].amount = flat (frontend normalizeSlots from c8f0350 renders it as one-time charge).
Extras inventory: `rates[].extraConfigs[]` (extra id, selectionType OPTIONAL, pricingType INCLUDED_IN_PRICE). Party add-on = rate 2582057 'Plan Your Own Private Party' 600 SAR/person + free extra 303234, only on Lolo2 1284355; all other experiences have no extras. When an experience must keep BOTH a flat default rate and a per-person party rate, put the flat one in defaultRate and resend both rates + both rules.
Also fixed: v2 GET detail `/restapi/v2.0/experience/{id}` is 404 but `/experience/{id}/components` WORKS. v1 `GET /activity.json/{id}` works again (200) — old "permanently broken" note outdated.

### 38. Bokun localizes durationText per locale — parse both forms
With `lang=AR`, product `durationText`/`duration` comes back as "١٢ ساعة" (Arabic-Indic digits), NOT "12 hours". Any regex parsing duration from Bokun must normalize `[٠-٩]`→`[0-9]` first and match `hour|ساع`. Arabic plural rules: 3-10 → ساعات, 11+ → ساعة (singular). DivingTripSection.tsx does this; copy the pattern. Site products API `/api/bokun/products` passes the localized string through untouched.

### 41. Rate-title contract + duration grid (LIVE 2026-10-12) + operator repo
Boat trips are now 8 flat per-booking rates per boat titled `Khor · 2h..6h` / `Bayadhah · 6h,8h,10h` (U+00B7 middle dot — the site wizard PARSES this; renaming breaks the duration step). 27 departures/boat carry real durationHours (Khor 2h×8, 3h×5, 4h×4, 5h×3, 6h×2; Bayadhah 6h/8h ×06,12 + 10h ×06). Event 1282749: Standard 700 per-PERSON + 5 `Boat — <Name>` per-booking extras (Lolo 1200, White Orca 1400, Oryx/Meveda/Altayar 1600) rendered in place by BoatExtraPicker (no fleet navigation on event pages). `allStartTimes:true` auto-materialises availability entries after a START_TIMES rebuild — no bulk POST needed. Combo gotcha: each boat's 12:00 startTime is a combo child of the event and is UNDELETABLE — reuse its id, only delete free departures. Price grid + scripts + playbooks + pre-restructure snapshots: private repo GentelZole/boating-bokun-operator. Nav renamed الجولات→التجارب / Tours→Experiences; hero scrim black/15 + filter brightness(1.38).

### 42. Dockerfile base images: node:20-bookworm apt repos now FAIL (expired Debian InRelease signatures) → node:20-trixie (builder) / node:20-trixie-slim (runtime). commit 4b6ff56.

### 40. Speed blame attribution: Bokun payload vs owner uploads vs our code (measured 2026-10-08)
Owner complaint "site slow = Bokun servers or huge uploads" — verified TRUE, with our-side wins available. Recipe used (no PSI quota needed): `curl -w dns/conn/tls/ttfb/total` ×3 per page + `lighthouse --port=9333` (existing Chrome) twice per page: default `--throttling-method=simulate` (what Google/CrUX scores) AND `--throttling-method=provided` (real network truth). HMAC note: sign path WITH query string (`/activity.json/{id}/availabilities?start=&end=`) — signing path-only returns 400 "Invalid signature".
Measured: our Cloud Run TTFB ~0.5s warm (cold first hit 2.4s), pages score 97/99 unthrottled with LCP <2.5s ✅. Simulated 4G fails LCP (home 4.7s, tour detail 5.0s) purely on byte weight: hero video `videos/hero-marina-480p.mp4` 975KB (owner upload, 46% of home page), `imgcdn.bokun.tools` 14 reqs/743KB per tour page, Bokun month-availability = 671KB raw JSON in 0.45–1.5s (our API passes ~302KB through; we add only 0–0.3s over direct Bokun calls), self-hosted Arabic fonts ~240KB. Our-side fixes ranked: (1) video preload=none, (2) trim+cache availability response to calendar fields only, (3) fetchpriority=high+preload hero `?w=1600`, (4) font subsetting.

### 43. WhatsApp / sales-agent integration points (verified against the live DB)
- `POST /api/bookings` and the Bokun booking + payment routes authenticate a CUSTOMER session (`requireUser(request.headers)`). Any automation (WhatsApp agent, POS, chatbot) must call new `/api/internal/*` endpoints guarded by an HMAC service secret in Secret Manager — do not try to mint or reuse customer sessions.
- There is NO boat→owner contact mapping: the `boats` table is empty under the Bokun-only architecture and `boats.owner_id` has no rows. Notifications to a boat owner need a new mapping table (e.g. `wa_contacts(entity_ref, phone, role)` keyed by Bokun activity id); per-user contacts exist only on `"user".phone`.
- Real volume baseline (last measured): ~48 lifetime `bokun_bookings`, ~12 new per 30 days, and most rows end in `failed`/`expired` — the drop-off is the payment step. An agent that qualifies the request and hands over a Moyasar link attacks the actual leak; do not size infra for volume the site does not have.
- New services belong in project `boating-499409`, region `us-central1`, alongside `boating-app`, reusing Cloud SQL `boating-499409:us-central1:boating-db`.

### 44. Owner portal and finance: what Bokun can and cannot back (verified against the live account)

Before building any owner/finance surface, know which half Bokun supplies:

**Bokun supplies (read it, do not duplicate it locally)**
- `POST /booking.json/booking-search` → rows in **`items`** (a route that maps only `results` returns `totalHits` with zero rows — this is the ``{bookings: [], total: 9}`` bug). Each row carries `paymentStatus`, `paidAmountAsMoney`, `salesSegment`, `channel.title`, `customerInvoice{totalAsMoney,totalDueAsMoney,payments[]}`, `productBookings[]`.
- `GET /booking.json/booking/{id}` → `status`, `totalPrice`, `totalPaid`, `totalDue`, `activityBookings[]` (date, startTime, pricing category + quantity).
- `GET /restapi/v2.0/booking/{id}/payments`, `/invoices?invoiceType=SELLER` (line items carry `commissionAmount`/`commissionPercentage`), and `/audit-records` (real who/when trail — use it instead of inventing an audit table).

**Bokun does NOT supply — build and own it here**
- Commission accounting, owner net, payout statements. There is no such endpoint; compute from sales + the contract rate and store it locally.
- Extranet user/role provisioning. Staff accounts and roles are created by hand in the Bokun extranet.
- Local `boat_availability` is a **disconnected** table: the customer calendar is served from Bokun. Any owner “block these dates” feature must write to Bokun availability, otherwise the block changes nothing on the site.

**Moyasar-paid bookings look unpaid in Bokun.** After a successful Moyasar payment the booking sits in Bokun as `paymentStatus=NOT_PAID`, `totalPaid=0`, `totalDue` = full price, `customerInvoice.payments` empty. That is expected for an external gateway — reconcile money against Moyasar + `payments`, never against Bokun's paid flag. If Bokun itself must show it paid, post the payment explicitly (`POST /booking.json/edit` → `AddBookingPaymentAction`; refunds `RefundBookingPaymentAction`).

**Paid E2E runs are a scarce resource.** `/api/booking/checkout` is rate-limited (6 attempts / 10 min, in-memory per Cloud Run instance), and hosted checkout links are single-use. Sequence payment scenarios deliberately and record when the limiter hit, so a blocked run is not reported as an app failure.

## Testing Checklist

Before deploying Bokun-related changes:

- [ ] `NEXT_PUBLIC_BOKUN_CHANNEL_UUID` is set in Cloud Run
- [ ] `BOKUN_ACCESS_KEY` and `BOKUN_SECRET_KEY` are bound to Cloud Run via `--set-secrets` (not just env vars)
- [ ] Widget loads on `/tours/[slug]` pages
- [ ] `/api/tours` returns `bokun_activity_id` for each tour
- [ ] `/api/bokun/search` returns results (not "credentials not available")
- [ ] Images are loading from `bokun.s3.amazonaws.com`
- [ ] Console shows no errors about `BokunWidgetsLoader`
- [ ] Widget displays correct product (check `productId` in HTML)

### E2E Checkout Flow Verification (Full Browser Test)

When testing as a human user in a browser, verify the complete flow:

1. **Widget Loads** — Navigate to `/ar/tours/[slug]`, confirm widget iframe shows product card with "Book now" button
2. **Date Selection** — Click "Book now", verify calendar appears with available dates showing prices (e.g., "17 3,000")
3. **Time Selection** — After selecting date, verify time slots appear (e.g., "06:00 Morning", "18:00 Afternoon")
4. **Booking Summary** — Confirm summary updates: Adults count × price, time, date, total
5. **Contact Details** — Click "Checkout" (or "Go to cart"), verify contact form appears (First name, Last name, Email)
6. **Payment Options** — After submitting contact, verify review page shows:
   - Experience details (name, rate, travellers, departure, duration)
   - **Two payment options**: "Pay now" (full amount) and "Pay on arrival" (pay on day of experience)
   - Promo Code field
   - "I accept the cancellation policy" checkbox (required before checkout)
7. **Secure Checkout** — After accepting policy, click "Go to secure checkout", verify redirect to Bokun's secure payment page

**Important**: After completing a full checkout flow, wait 30-60 seconds before retesting to avoid Bokun rate limiting (blank pages with empty `bookingChannelUUID`).

## Known Tour IDs (updated 2026-07-22)

- **وايت أوركا** (White Orca): `1251403` - Price: 3000 SAR - slug: `tour-1251403`
- **بوت الطيار** (Altayyar Boat): `1258054` - Price: 1500 SAR - slug: `tour-1258054`
- **لؤلؤة البحر** (Lolo of the sea): `1251353` - Price: 1 SAR - slug: `tour-1251353`

## Files Reference

- `/components/booking/BokunWidget.tsx` - Widget component (see `templates/BokunWidget.tsx` for hydration-safe pattern)
- `/lib/bokun/config.ts` - Configuration and URL builders
- `/lib/bokun-auto-sync.ts` - Auto-sync logic
- `/app/api/tours/route.ts` - Tours API (must include `bokun_activity_id`)
- `/app/api/bokun/sync/route.ts` - Manual sync endpoint
- `/app/api/bokun/search/route.ts` - Search API with auto-load pattern
- `/components/bokun/SearchWidget.tsx` - Search widget with auto-load on mount
- `/scripts/sync-bokun-to-local.ts` - CLI sync script

## References

- **`references/bokun-field-mapping.md`** - Complete field mapping from Bokun raw API response to clean SearchResult shape. Use this when mapping Bokun data to frontend components.
- **`references/product-detail-page-layout.md`** - Layout pattern for product detail pages (tours/[slug], boats/[slug]). Hero image, quick info cards, gallery, sticky BookingFlow sidebar. Arabic RTL support details.

## Templates

- **`templates/BokunWidget.tsx`** - Hydration-safe Bokun widget component. Uses JSX `<iframe>` with `useRef` instead of `document.createElement`. Copy this pattern when creating similar third-party widget integrations in Next.js.

## Debugging Commands

```bash
# List all Bokun activity IDs (SIMPLEST - uses app's own API, no HMAC needed)
curl -s "https://boatingksa.com/api/bokun/search" \
  -H "Content-Type: application/json" \
  -d '{"destination":"","dates":"","guests":1,"category":"all"}' | python3 -c "
import sys, json
d = json.load(sys.stdin)
for item in d.get('results', []):
    print(f'ID: {item.get(\"id\")} | Title: {item.get(\"title\")} | Price: {item.get(\"price\", {}).get(\"amount\")} {item.get(\"price\", {}).get(\"currency\")}')
"

# Test Bokun API directly (requires HMAC-SHA1 signature)
DATE=$(date -u '+%Y-%m-%d %H:%M:%S')
ACCESS_KEY="your_access_key"
SECRET_KEY="your_secret_key"
SIGNATURE=$(echo -n "${DATE}${ACCESS_KEY}POST/activity.json/search" | openssl dgst -sha1 -hmac "$SECRET_KEY" -binary | base64)

curl -X POST "https://api.bokun.io/activity.json/search" \
  -H "X-Bokun-Date: $DATE" \
  -H "X-Bokun-AccessKey: $ACCESS_KEY" \
  -H "X-Bokun-Signature: $SIGNATURE" \
  -H "Content-Type: application/json;charset=UTF-8" \
  -H "Accept: application/json" \
  -d '{"fields":["ID","TITLE","IMAGES"],"pagination":{"page":1,"perPage":10}}'

# Check if widget URL is accessible
curl -I "https://widgets.bokun.io/online-sales/{CHANNEL_UUID}/experience-calendar/{PRODUCT_ID}?lang=en"

# Verify environment variable in Cloud Run
gcloud run services describe boating-app --region=us-central1 --project=boating-499409 --format="value(spec.template.spec.containers[0].env)" | grep BOKUN

# Validate a Bokun activity ID exists (replace {ID} with actual activity ID)
DATE=$(date -u '+%Y-%m-%d %H:%M:%S')
SIGNATURE=$(echo -n "${DATE}${ACCESS_KEY}GET/activity.json/{ID}" | openssl dgst -sha1 -hmac "$SECRET_KEY" -binary | base64)
curl -s "https://api.bokun.io/activity.json/{ID}" \
  -H "X-Bokun-Date: $DATE" \
  -H "X-Bokun-AccessKey: $ACCESS_KEY" \
  -H "X-Bokun-Signature: $SIGNATURE" | jq '{id, title, photos: (.photos | length)}'
```

### 10. Webhook HMAC Validation & Credential Security
**Webhook endpoint**: `POST /api/webhooks/bokun` (live at `https://boatingksa.com/api/webhooks/bokun`)

Bokun sends webhooks with an `x-bokun-hmac` header containing a SHA-256 HMAC hex digest of the raw request body. The shared secret is stored in GCP Secret Manager as `bokun-webhook-secret` (falls back to `BOKUN_WEBHOOK_SECRET` env var).

**Implementation pattern** (in `app/api/webhooks/bokun/route.ts`):
```typescript
import * as crypto from 'crypto';
import { getSecret } from '../../../../lib/secret-manager';

function validateWebhookSignature(body: string, hmacHeader: string, webhookSecret: string): boolean {
  if (!hmacHeader || !webhookSecret) return false;
  const hmac = crypto.createHmac('sha256', webhookSecret);
  hmac.update(body, 'utf-8');
  const computedSignature = hmac.digest('hex');
  try {
    const hmacBuffer = Buffer.from(hmacHeader, 'hex');
    const computedBuffer = Buffer.from(computedSignature, 'hex');
    if (hmacBuffer.length !== computedBuffer.length) return false;
    return crypto.timingSafeEqual(hmacBuffer, computedBuffer);  // Prevents timing attacks
  } catch { return false; }
}

// In POST handler:
const rawBody = await request.text();           // Read raw FIRST
const hmacHeader = request.headers.get('x-bokun-hmac') || '';
let webhookSecret = process.env.BOKUN_WEBHOOK_SECRET || '';
if (!webhookSecret) {
  try { webhookSecret = await getSecret('bokun-webhook-secret'); } catch {}
}

if (webhookSecret) {
  if (!validateWebhookSignature(rawBody, hmacHeader, webhookSecret)) {
    return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
  }
}
const body = JSON.parse(rawBody);               // Parse AFTER validation
```

**Critical ordering**: Read raw body → validate HMAC → parse JSON. You cannot use `request.json()` first because you need the exact raw bytes for HMAC computation.

**Credential security rule**: All Bokun credentials (access key, secret key, webhook secret) must come from `getBokunCredentials()` or `getSecret()` in `lib/secret-manager.ts`. NEVER hardcode credentials in source files. The secret-manager falls back to environment variables when GCP Secret Manager is unavailable.

**Registering in Bokun dashboard**: Use URL `https://boatingksa.com/api/webhooks/bokun` and configure the shared secret as `bokun-webhook-secret` in GCP Secret Manager.

**CRITICAL: Bokun does NOT provide a programmatic API to register webhooks.** Webhook registration must be done manually through the Bokun Partner Dashboard (Settings → Webhooks → Add endpoint). There is no REST/GraphQL endpoint to create/manage webhooks via API. The Bokun developer docs (bokun.dev) only cover how to BUILD a webhook receiver, not how to register one programmatically.

**Bokun webhook headers** (sent with every webhook POST):
- `x-bokun-hmac` — SHA-256 HMAC hex digest of raw body (for signature validation)
- `x-bokun-apikey` — API key that identifies the Bokun account
- `x-bokun-experience-id` — Base64-encoded experience/activity ID (e.g., `RXhwZXJpZW5jZToyNjA5`)
- `x-bokun-topic` — Event topic (e.g., `experiences/availability_update`, `experiences/product_update`)
- `x-bokun-vendor-id` — Base64-encoded vendor ID

**Supported webhook event topics:**
- `experiences/availability_update` — availability changed for an experience
- `experiences/product_update` — product details changed (title, description, images, pricing)

### 11b. sync_status Table Schema — Webhook vs Migration Mismatch
**Problem**: The webhook endpoint (`app/api/webhooks/bokun/route.ts`) and manual sync endpoint (`app/api/bokun/sync/manual/route.ts`) INSERT into `sync_status` using columns (`sync_type`, `direction`, `status`, `started_at`, `completed_at`, `records_processed`, `records_synced`, `records_failed`, `details`) that were NOT in the original migration 016 (`entity_type`, `entity_id`, `last_synced_at`, `sync_status`, `error_message`, `retry_count`).

**Fix applied**: 
1. Added migration `017_sync_status_webhook_columns.sql` with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` for all webhook columns
2. Added `CREATE TABLE IF NOT EXISTS sync_status` with ALL columns (both original and webhook) to `initDatabase()` in `lib/database.ts` (PostgreSQL)

**Lesson**: When adding new DB consumers (webhooks, sync endpoints), always check that the table schema matches what the code expects. The `sync_status` table serves TWO purposes:
- Original: tracking entity-level sync (boats/tours ↔ Bokun) — uses `entity_type`, `entity_id`, `sync_status`
- Webhook: tracking webhook event processing — uses `sync_type`, `direction`, `status`, `started_at`, `completed_at`, `records_*`

Both sets of columns must exist. The original columns are nullable now (webhook rows don't use them).

### 11c. Dual Database Architecture
**IMPORTANT**: The Boating project uses TWO database systems:
- **SQLite** (`lib/db.ts` with `better-sqlite3`) — used by auth, some API routes. File at `/tmp/data/boating.db`. Migrations in `db/migrations/`.
- **PostgreSQL** (`lib/database.ts` with `pg` Pool) — used by webhook, sync, and booking endpoints. Cloud SQL instance `boating-499409:us-central1:boating-db`.

When adding new tables or columns, check WHICH database the code uses:
- `import { getDatabase } from 'lib/db'` → SQLite
- `import { getPool } from 'lib/database'` → PostgreSQL

The `initDatabase()` function in `lib/database.ts` creates tables in PostgreSQL. The SQLite migrations are run by `initializeDatabase()` in `lib/db.ts`. Both must be kept in sync for shared tables like `sync_status`.

### 11. Widget Renders Empty Despite Correct CSP + Correct Activity IDs
**Symptom**: The Bokun widget iframe loads (src is set correctly, CSP allows `widgets.bokun.io`), but the widget body is completely blank — no booking form, no calendar, no content.

**Root cause**: The activity is not properly configured in the **Bokun dashboard** (not a code issue). Check:
1. **Availability** — The activity must have available dates/times configured. Activities with no availability show empty widgets.
2. **Pricing** — Must have at least one price category with valid prices.
3. **Channel linking** — The online sales channel (`NEXT_PUBLIC_BOKUN_CHANNEL_UUID`) must be linked to the activity in Bokun → Settings → Channels.
4. **Activity status** — Must be "Published" (not "Draft" or "Archived").

**Diagnosis**: Open the widget URL directly in a new tab:
```
https://widgets.bokun.io/online-sales/{CHANNEL_UUID}/product-page/{ACTIVITY_ID}?lang=en
```
If the page loads but is blank → Bokun dashboard config issue. If it 404s → wrong channel UUID or activity ID.

**Critical diagnostic — check `bookingChannelUUID` in widget HTML**:
```bash
curl -s "https://widgets.bokun.io/online-sales/{CHANNEL_UUID}/product-page/{ACTIVITY_ID}?lang=en" | grep "bookingChannelUUID"
```
- If output shows `window.bookingChannelUUID = '' ;` (EMPTY) → The channel UUID in the URL is NOT recognized by Bokun's backend. The widget renders empty because Bokun doesn't know which channel to serve.
- If output shows `window.bookingChannelUUID = 'some-uuid' ;` → UUID is valid, problem is elsewhere (availability/pricing).

**When UUID is empty in HTML**: The `NEXT_PUBLIC_BOKUN_CHANNEL_UUID` value is wrong or expired. Get the correct one from:
1. Bokun Dashboard → **Sales Tools** → **Booking Widgets** → **Generate Embed Code**
2. Look for `data-booking-channel-uuid` attribute or `bookingChannelUUID` in the embed snippet
3. Update `.env.production.local`, Dockerfile `ARG`, and Cloud Run `--set-env-vars`

**Fix**: Log into Bokun dashboard (`app.bokun.io`) → Activities → select the activity → check Availability tab, Pricing tab, and ensure the channel is selected in the "Online Sales" section.

### 19. Bokun Widget URL → Local Slug Mismatch (404 on Tour Detail)
**Problem**: When a user clicks on an experience inside the Bokun widget (e.g., on the homepage or a tour listing), the widget navigates to a URL like `/ar/tours/white-orca-` (with a trailing hyphen). This URL is generated by Bokun from the experience title — it does NOT use the slug stored in the local database. If the local DB has a different slug (e.g., `jeddah-lion` for White Orca), the page returns 404.

**Root cause**: Bokun slugifies experience titles to generate detail-page URLs internally. The slugification sometimes adds trailing hyphens and uses the Bokun experience name, not the local tour name or slug.

**Why it recurs after every deployment**: Any change to Bokun experience titles, or any DB reset/re-seed, can break the slug mapping. The widget always generates URLs from Bokun's side — the local DB must match.

**Fix (Code-Level - PREFERRED)**: Clean the slug in the tour detail page to handle trailing hyphens automatically:
```typescript
// In app/[locale]/tours/[slug]/page.tsx - getTourBySlug function
const cleanSlug = slug.replace(/-+$/, "").replace(/^-+/, "");  // Remove leading AND trailing hyphens

// If slug is empty after cleaning, return null
if (!cleanSlug) return null;

const tour = data.tours?.find((t: Tour) => t.slug === cleanSlug);
```
This approach handles trailing hyphens automatically without requiring DB updates.

**Fix (DB-Level)**: Ensure the `slug` column in the `tours` table matches what Bokun generates:
```sql
-- Check current slugs vs Bokun activity IDs
SELECT id, name_en, slug, bokun_activity_id FROM tours WHERE bokun_activity_id IS NOT NULL;

-- Fix: update slug to match Bokun's generated URL (lowercase, hyphenated, no trailing hyphen)
UPDATE tours SET slug = 'white-orca' WHERE bokun_activity_id = '1251403';
```

**Known slug mappings** (as of 2026-07-19):
| Bokun Activity ID | Bokun Experience Name | Correct Local Slug |
|---|---|---|
| 1251353 | لولو البحر | `lolo-al-bahr` |
| 1251403 | White Orca | `white-orca` |

**Diagnostic**: If a user reports 404 from a Bokun widget click:
1. Check the URL in the browser address bar — note the slug (strip trailing hyphens)
2. Query the DB: `SELECT slug FROM tours WHERE slug = 'the-slug-from-url'`
3. If no match, update the slug to match

**Prevention**: After any Bokun experience rename or DB re-seed, always verify slug alignment:
```bash
# Quick check — compare Bokun titles (via API) to local slugs
PGPASSWORD='***' psql -h <boating-db-host> -U boating_user -d boating \
  -c "SELECT name_en, slug, bokun_activity_id FROM tours WHERE bokun_activity_id IS NOT NULL;"
```

### 20. SearchWidget Slug Generation Creates Trailing Hyphens
**Problem**: The `SearchWidget.tsx` component generates slugs from Bokun experience titles using regex, but the regex adds a trailing hyphen when the title ends with a non-alphanumeric character (like a space or special char).

**Root cause** (found 2026-07-19):
```typescript
// WRONG ❌ - "White Orca" → "white-orca-" (trailing hyphen)
slug: (item.title as string)?.toLowerCase().replace(/[^a-z0-9]+/g, "-")
```

**Fix**: Add a second regex to strip leading/trailing hyphens:
```typescript
// CORRECT ✅ - "White Orca" → "white-orca" (no trailing hyphen)
slug: ((item.title as string)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")) || `tour-${idx}`
```

**Where this appears**: `components/bokun/SearchWidget.tsx` in TWO places:
1. `loadAllProducts()` function (line ~71)
2. `handleSearch()` function (line ~141)

**Why this matters**: The SearchWidget generates links on the homepage. If the slug has a trailing hyphen, clicking "View Details" navigates to `/ar/tours/white-orca-` which returns 404. This is the ROOT CAUSE of the recurring 404 issue — not just a DB mismatch.

**Verification**: After fixing, test by clicking on any tour card on the homepage and verify the URL is `/ar/tours/white-orca` (no trailing hyphen).

### 21. Non-ASCII Titles (Arabic) Produce Empty Slugs
**Problem**: When Bokun experience titles are in Arabic (e.g., "لولو البحر"), the slug generation regex `/[^a-z0-9]+/g` strips ALL characters because Arabic is outside the ASCII range. This results in an empty slug `""`, which then falls back to `tour-{idx}` — causing 404s when users click the tour card.

**Root cause** (found 2026-07-19):
```typescript
// WRONG ❌ - "لولو البحر" → "" (empty! all Arabic chars stripped)
slug: (item.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
```

**Fix (CURRENT — Bokun-Only Architecture)**: For non-ASCII titles, use the Bokun activity ID as the slug:
```typescript
// In app/api/bokun/search/route.ts — pure Bokun, no DB lookup
const activityId = item.id ? String(item.id) : '';
const title = item.title || '';
let slug = '';
if (title && /^[\x00-\x7F]+$/.test(title)) {
  // English title - safe to slugify
  slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
} else {
  // Arabic or mixed title - use activity ID as fallback
  slug = activityId ? `tour-${activityId}` : `tour-${idx}`;
}
```

**Detail pages resolve `tour-{id}` slugs** via `findBokunActivity()` which strips the `tour-` prefix and calls `getActivity(id)` directly on the Bokun API. No DB needed. See Section 27.

**⚠️ SUPERSEDED**: The previous fix (DB lookup by `bokun_activity_id` to get human-readable slugs like `lolo-al-bahr`) was removed per user directive — ALL products from Bokun only, zero DB queries. Arabic-titled products now use `tour-{activityId}` as their slug, which the detail page resolves via Bokun API.

### 22. ⚠️ SUPERSEDED — Tour Detail = Redirect to Bokun Widget (REMOVED 2026-07-22)

**STATUS: REMOVED BY USER DIRECTIVE.** The Bokun widget redirect was rejected for TWO reasons:
1. **Blank page**: The widget URL (`widgets.bokun.io/.../experience/{id}?language=ar`) renders a blank white page with only language/currency selectors — no product content, no booking form.
2. **Wrong payment gateway**: Even when the widget works, it uses Bokun's own payment gateway, NOT Moyasar. The user's payment gateway is Moyasar exclusively.

**User directive (2026-07-22)**: "سلة المشتريات تفتح صفحة فارغة، مع العلم ان بوابة الدفع لدينا هي ميسر وليس بوكن كيف نعالج هذة المشكلة ، حجز من بوكن ودفع من ميسر"
Translation: "The shopping cart opens a blank page. Our payment gateway is Moyasar, not Bokun. How do we fix this? Book from Bokun, pay with Moyasar."

**Replacement**: Own product detail page + own BookingFlow + Moyasar payment. See Section 30.

**Do NOT**:
- ❌ `redirect()` to Bokun widget URLs for detail pages
- ❌ Open Bokun widget URLs from ShoppingCart checkout
- ❌ Use Bokun's payment/checkout flow
- ❌ Embed Bokun widget as the primary booking interface

### 23. Shopping Cart Architecture (Site-Wide)
**Problem**: The shopping cart was only visible on the tours listing page (as a floating button), and the checkout link went to an empty page.

**Architecture** (implemented 2026-07-19):

1. **LayoutWrapper** (`components/layout/LayoutWrapper.tsx`) — renders `<ShoppingCart>` on ALL non-admin pages:
```tsx
import { ShoppingCart } from "../booking/ShoppingCart";
import { useLocale } from "next-intl";

// Inside LayoutWrapper:
const locale = useLocale();
// ...
{!isAdminPage && <ShoppingCart locale={locale} onCheckout={() => {}} />}
```

2. **CartIconButton** (`components/booking/ShoppingCart.tsx`) — exported separately for use in headers:
```tsx
export function CartIconButton({ locale = "ar" }: { locale?: string }) {
  // Reads localStorage "bokun_cart" for item count badge
  // Dispatches "toggle-cart" event on click
  return (
    <button onClick={() => window.dispatchEvent(new Event("toggle-cart"))}>
      <ShoppingBag className="h-5 w-5" />
      {totalItems > 0 && <span className="badge">{totalItems}</span>}
    </button>
  );
}
```

**Cart button styling — MUST match the gold "Book Now" button** (user requirement 2026-07-19):
The user complained the default dark/black cart icon was "difficult to see" and asked for it to be gold like the booking button. Use the SAME gradient as the "احجز الآن" / "Book Now" button:
```tsx
<button
  onClick={() => window.dispatchEvent(new Event("toggle-cart"))}
  className="relative inline-flex items-center justify-center rounded-full bg-gradient-to-b from-nautical-gold to-amber-600 p-2.5 text-white shadow-[0_3px_0_#92400e,0_4px_8px_rgba(0,0,0,0.3)] transition-all duration-150 hover:shadow-[0_2px_0_#92400e,0_3px_6px_rgba(0,0,0,0.3)] hover:translate-y-[1px] active:shadow-[0_1px_0_#92400e] active:translate-y-[2px]"
  aria-label={locale === "ar" ? "سلة التسوق" : "Shopping Cart"}
>
  <ShoppingBag className="h-5 w-5" />
  {totalItems > 0 && (
    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full h-4.5 w-4.5 min-w-[18px] flex items-center justify-center px-0.5">
      {totalItems}
    </span>
  )}
</button>
```
The `from-nautical-gold to-amber-600` gradient + `#92400e` shadow is the exact "Book Now" button treatment from `Home1Header.tsx`. Keep header CTAs visually consistent.

3. **Event-based communication** between header icon and cart sidebar:
   - `toggle-cart` — opens/closes the cart sidebar (dispatched by CartIconButton)
   - `add-to-cart` — adds item and opens cart (dispatched by TourCard or other components)
   - CartIconButton polls localStorage every 1s for badge count updates

4. **Headers** — Both `Home1Header.tsx` and `Home2Header.tsx` include `<CartIconButton locale={locale} />` next to the language switcher and auth button.

5. **Checkout URL fix** — The old checkout used `?experienceIds=id1,id2` which showed an empty page. Fixed to use the general Bokun booking page:
```typescript
// WRONG ❌ - Shows empty page
const bookingUrl = `https://widgets.bokun.io/online-sales/${UUID}?experienceIds=${productIds}`;

// CORRECT ✅ - Shows all experiences with booking flow
const bookingUrl = `https://widgets.bokun.io/online-sales/${UUID}?language=${locale}`;
```

6. **Cart page** (`app/[locale]/cart/page.tsx`) — Uses BokunWidget (general booking) instead of the old static CartSection:
```tsx
import { BokunWidget } from "@/lib/dynamicImports";
// ...
<BokunWidget locale={locale} />
```

**Key files**:
- `components/booking/ShoppingCart.tsx` — Cart sidebar + CartIconButton export
- `components/layout/LayoutWrapper.tsx` — Site-wide cart rendering
- `components/layout/Home1Header.tsx` — CartIconButton in header
- `components/layout/Home2Header.tsx` — CartIconButton in header
- `app/[locale]/cart/page.tsx` — Cart page with BokunWidget

**Pitfall**: Do NOT render `<ShoppingCart>` in individual page components (like TourListingClient) AND in LayoutWrapper — this creates duplicate cart instances. Remove page-level ShoppingCart when adding it to LayoutWrapper.

### 25. ⚠️ SUPERSEDED — Auto-Sync + DB Fallback (REMOVED 2026-07-22)

**STATUS: REMOVED BY USER DIRECTIVE.** The user explicitly ordered: "ALL products from Bokun ONLY — zero local DB queries for products. The local database must NOT be searched at all for products."

The three-layer fix (multi-fallback slug resolution + auto-sync into local DB) was **replaced** by the Bokun-Only Architecture (Section 27). Do NOT re-implement DB fallbacks, auto-sync, or local product lookups.

**What was removed**:
- `getPool()` / DB queries in `app/api/bokun/products/route.ts` (DB fallback when Bokun returns 0)
- `getPool()` / `activityIdToSlug` map / auto-sync block in `app/api/bokun/search/route.ts`
- `getTours()` / `TourListingClient` in `app/[locale]/tours/page.tsx` (replaced with `ProductList` from Bokun)
- `getBoats()` / `BoatFilters` in `app/[locale]/boats/page.tsx` (replaced with `ProductList` from Bokun)
- DB-based `getTourBySlug()` in `app/[locale]/tours/[slug]/page.tsx` (replaced with `findBokunActivity()`)
- DB-based `getBoatBySlug()` in `app/[locale]/boats/[slug]/page.tsx` (replaced with Bokun redirect)

**If you see code that queries PostgreSQL for product/tour/boat listings or details, it is WRONG.** Products come from Bokun API only. The local DB is still used for users, auth, bookings, and reviews — but NOT for product data.

### 27. Bokun-Only Product Architecture (CURRENT — 2026-07-22)
**User directive**: "ALL products from Bokun ONLY. Zero local DB queries for products. The local database must NOT be searched at all for products."

**Architecture**: Bokun API is the **single source of truth** for all product data (tours, boats, experiences). The local PostgreSQL database is used ONLY for users, auth, bookings, and reviews — NEVER for product listings or details.

#### How each page works now:

**Listing pages** (`/tours`, `/boats`):
- Use `<ProductList category="tours" />` or `<ProductList category="boats" />` component
- ProductList fetches from `/api/bokun/products` which calls `searchProducts()` from Bokun API
- NO `getTours()`, NO `getBoats()`, NO `TourListingClient`, NO `BoatFilters`
- If Bokun returns 0 products → show empty state (NOT DB fallback)

**Detail pages** (`/tours/[slug]`, `/boats/[slug]`):
- Use `findBokunActivity(slug)` which queries Bokun API via `searchActivities()`:
  1. Match by activity ID (for `tour-{id}` / `boat-{id}` slugs)
  2. Match by slugified title (for English title slugs)
  3. **Do NOT use `getActivity()`** — it returns 404 for all IDs (Section 32)
- On match → fetch full data via `searchActivities(lang, "SAR", 1, 50)` and find the matching item (with EN fallback if AR search fails)
- Render **own product detail page** with BookingFlow + Moyasar payment (NOT Bokun widget redirect)
- On no match → `notFound()` (404)
- NO local DB lookup, NO `/api/tours` fetch, NO `getBoatBySlug()`
- NO `redirect()` to Bokun widget — see Section 30

**Search** (`/api/bokun/search`):
- Pure Bokun: `searchProducts()` → map results → return
- Slug generation: ASCII titles → slugify; non-ASCII → `tour-{activityId}`
- NO DB slug mapping, NO auto-sync, NO `getPool()`

**Products API** (`/api/bokun/products`):
- Pure Bokun: `searchProducts()` → filter by category → return
- NO DB fallback when Bokun returns 0 or errors
- If Bokun fails → return empty array with error message

#### Key pattern — `findBokunActivity()` (UPDATED 2026-07-22 — NO getActivity):
```typescript
import { searchActivities } from "@/lib/bokun-api";

async function findBokunActivity(slug: string): Promise<{ id: number; title: string } | null> {
  const cleanSlug = slug.replace(/-+$/, "").replace(/^-+/, "");
  if (!cleanSlug) return null;

  const numericId = cleanSlug.replace(/^tour-/, "").replace(/^boat-/, "");

  // Search Bokun and match by ID or slugified title
  // NOTE: getActivity() is BROKEN (returns 404 for all IDs) — do NOT use it. See Section 32.
  try {
    const response = await searchActivities("EN", "SAR", 1, 50);
    const items = (response.items || response.results || []) as Array<{ id?: number; title?: string }>;
    for (const item of items) {
      if (!item.id || !item.title) continue;
      // Match by activity ID (slug like "tour-1251403" or "boat-1251403")
      // CRITICAL: Arabic titles produce empty slugs, so ID matching is the ONLY
      // way to resolve tour-{id} slugs
      if (String(item.id) === numericId) return { id: item.id, title: item.title };
      // Match by slugified title (for English titles only)
      const itemSlug = item.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (itemSlug && itemSlug === cleanSlug.toLowerCase()) return { id: item.id, title: item.title };
    }
  } catch (error) { console.error("Bokun search failed:", error); }

  return null;
}
```

**⚠️ Do NOT use `getActivity()`** — it returns 404 for all IDs (confirmed 2026-07-22). The `searchActivities()` endpoint returns the same data and works reliably.

#### What NOT to do:
- ❌ Do NOT add `getPool()` or any DB query to product/tour/boat listing or detail pages
- ❌ Do NOT add DB fallback in `/api/bokun/products` or `/api/bokun/search`
- ❌ Do NOT auto-sync Bokun products into the local `tours` or `boats` tables
- ❌ Do NOT use `getTours()`, `getBoats()`, `getBoatBySlug()`, or `getTourBySlug()` for public-facing product pages
- ❌ Do NOT `redirect()` to Bokun widget URLs — widget shows blank page + uses Bokun payment, not Moyasar
- ❌ Do NOT open Bokun widget URLs from ShoppingCart checkout
- ✅ DO use Bokun API (`searchActivities`, `searchProducts`) for all product data — do NOT use `getActivity()` (broken, Section 32)
- ✅ DO render own product detail pages with BookingFlow + Moyasar payment (Section 30)
- ✅ The local DB is STILL used for: users, auth, bookings (bokun_bookings table), reviews, admin dashboard

#### Files in Bokun-Only architecture:
- `app/api/bokun/products/route.ts` — pure Bokun, no DB
- `app/api/bokun/search/route.ts` — pure Bokun, no DB
- `app/[locale]/tours/page.tsx` — ProductList from Bokun
- `app/[locale]/tours/[slug]/page.tsx` — findBokunActivity → product detail page with BookingFlow + Moyasar
- `app/[locale]/boats/page.tsx` — ProductList from Bokun
- `app/[locale]/boats/[slug]/page.tsx` — findBokunActivity → product detail page with BookingFlow + Moyasar
- `lib/boats.ts` and `lib/tours.ts` — STILL EXIST but only used by admin/booking flows, NOT public product pages

### 26. Widget Language Parameter Ignored — Arabic Shows as English
**Problem**: User selects Arabic on the site, the tour page redirects to the Bokun widget with `?language=ar` in the URL, but the widget UI (buttons, labels, "Cancellation policy", "More Info", etc.) still renders in **English**. It looks like a code bug, but it is NOT.

**Root cause**: The Bokun widget only honors the `language=` URL parameter if that language is **enabled on the Bokun activity/channel**. If the activity's `languages` array doesn't include Arabic, Bokun silently falls back to the base language (`EN_GB`). The parameter is sent correctly — Bokun just ignores it.

**Diagnosis** (do this BEFORE touching any code):
1. Confirm the URL actually carries the param: the tour redirect builds `.../experience/{id}?language={locale}` — verify `{locale}` is `ar`.
2. Test the widget URL directly with a different language, e.g. `?language=de`. If it ALSO shows English, the parameter is being ignored entirely → Bokun-side config, not code.
3. Check the activity's enabled languages via the v1 API:
```bash
# GET /activity.json/{id} → look at "languages" and "baseLanguage"
# Result for an English-only activity:
#   "languages": ["EN_GB"],  "baseLanguage": "en_GB"
```
   If `languages` is `["EN_GB"]` only, Arabic is not enabled → this is the cause.

**Fix — NOT possible via API.** Channel/activity language settings are dashboard-only:
- `PUT /activity.json/{id}` → **404** (cannot update languages via API)
- `GET /channel.json/{uuid}`, `/salesChannel.json/{uuid}` → **404 / timeout** (channel language config not exposed)

The user must enable Arabic in the Bokun Extranet:
1. Log into [Bokun Extranet](https://extranet.bokun.io)
2. **Settings → Languages** (or Channel Settings)
3. Add **Arabic (العربية)** as a supported language
4. Save — the widget then honors `?language=ar` automatically, no code change needed

**Key takeaway**: When a third-party widget "ignores" a language/locale param, first prove whether the param is being sent (it usually is), then check the provider's enabled-language config via API before assuming a frontend bug. Don't burn cycles on code that's already correct.

### 28. Products API Must Map Bokun Raw Fields to ProductList Shape
**Problem**: The `/api/bokun/products` endpoint was returning raw Bokun objects (with `keyPhoto`, `summary`, `excerpt`, etc.) but the `ProductList` component expects a flat shape with `image`, `description`, `price`, `slug`, `duration`, `capacity`, `rating`, `reviews`. Without mapping, the component shows "No image" and missing data.

**Also**: Bokun doesn't provide a `slug` field — the API route must generate one from the title (ASCII → slugify; non-ASCII → `tour-{id}`).

**Fix** — map raw Bokun items to ProductList shape in `/api/bokun/products/route.ts`:
```typescript
const products = rawProducts.map((p, idx) => {
  const title = p.title || '';
  const id = p.id ? String(p.id) : '';
  let slug = '';
  if (title && /^[\x00-\x7F]+$/.test(title)) {
    slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  } else {
    slug = id ? `tour-${id}` : `tour-${idx}`;
  }

  // Extract image: keyPhoto.originalUrl > first image > empty
  const image = p.keyPhoto?.originalUrl
    || (p.images && p.images.length > 0 ? p.images[0]?.originalUrl || '' : '');

  return {
    id: p.id,
    title,
    description: p.excerpt || p.summary || '',
    price: p.price || 0,
    currency: 'SAR',
    image,
    capacity: p.maxCapacity || 0,
    duration: p.durationText || '',
    category: 'boat',
    slug,
    location: p.location || p.city || '',
    rating: p.reviewRating || 0,
    reviews: p.reviewCount || 0,
  };
});
```

**Key field mappings**:
| Bokun raw field | ProductList field | Notes |
|---|---|---|
| `keyPhoto.originalUrl` | `image` | Primary image; fallback to `images[0].originalUrl` |
| `excerpt` or `summary` | `description` | Prefer excerpt (shorter) |
| `price` (number) | `price` | Direct number, NOT `{amount, currency}` |
| `durationText` | `duration` | Pre-formatted string like "1 hour" |
| `maxCapacity` | `capacity` | Number |
| `reviewRating` / `reviewCount` | `rating` / `reviews` | Numbers |
| *(generated)* | `slug` | ASCII title → slugify; Arabic → `tour-{id}` |

### 29. `getActivity()` is BROKEN — Use `searchActivities()` Instead (CONFIRMED 2026-07-22)
**Problem**: The `getActivity(id)` endpoint (`GET /activity/{id}.json`) returns `Bókun API Error 404` for ALL activity IDs — including known-valid ones (1251403, 1258054, 1251353). This was initially thought to be a silent/intermittent failure, but testing confirmed it is a **complete, permanent breakage** of the endpoint.

**Root cause**: The endpoint is broken/deprecated on Bokun's side. It is NOT a credential issue, rate limit, or language parameter problem. Both `lang=AR` and `lang=EN` return 404.

**Evidence** (from Cloud Run logs, 2026-07-22):
```
Failed to fetch activity details: Error: Bókun API Error 404: {"status":404,"message":""}
```
This error appeared for EVERY request, regardless of activity ID or language.

**Fix**: Remove ALL `getActivity()` calls. Use `searchActivities()` to find activities by ID:
```typescript
// WRONG ❌ - getActivity returns 404 for ALL IDs
const activity = await getActivity(activityId, lang, "SAR");

// CORRECT ✅ - searchActivities works reliably
const response = await searchActivities(lang, "SAR", 1, 50);
const items = (response.items || response.results || []) as Array<Record<string, unknown>>;
const activity = items.find((item) => item.id === targetId) || null;
// Fallback to EN if AR search doesn't return the activity
if (!activity) {
  const enResponse = await searchActivities("EN", "SAR", 1, 50);
  const enItems = (enResponse.items || enResponse.results || []) as Array<Record<string, unknown>>;
  activity = enItems.find((item) => item.id === targetId) || null;
}
```

**Detail page data fetching pattern** (tours/[slug] and boats/[slug]):
1. `findBokunActivity(slug)` → uses `searchActivities("EN")` to match by ID or slugified title
2. Full data fetch → uses `searchActivities(lang, "SAR", 1, 50)` and finds matching item
3. Fallback → if AR search doesn't find it, try EN search
4. If still not found → `notFound()`

**Import**: Only import `searchActivities` from `@/lib/bokun-api`. Do NOT import `getActivity`.

**Also note**: The `itemSlug &&` guard prevents empty-string matches (Arabic titles produce `""` after slugification, which would match any empty slug).

## Lessons Learned

1. **BokunWidgetsLoader vs Direct iframe** - Both approaches can work. When the user provides the official Bokun embed code from their dashboard, use the `BokunWidgetsLoader.js` approach (Option A). If that fails or you don't have the official code, fall back to direct `<iframe>` (Option B). The loader requires `script-src` to include both `widgets.bokun.io` and `static.bokun.io` in CSP. The direct iframe only needs `frame-src` with `widgets.bokun.io`. Update: 2026-07-15.
2. **Always check API response structure** - Bokun uses `items`, not `results`
3. **Frontend env vars need `NEXT_PUBLIC_` prefix** - Otherwise they're server-only
4. **Use `afterInteractive` for third-party scripts** - `lazyOnload` may not load in time
5. **Include all required fields in SELECT queries** - Missing `bokun_activity_id` breaks widget
6. **Sync should be on-demand** - Not cron-based, trigger when page loads
7. **Test widget in browser console** - Check iframe src is set correctly
8. **CRITICAL: React Hydration Mismatch** - Never use `document.createElement` to add iframe dynamically. This causes hydration mismatch error: "The node to be removed is not a child of this node". 
   - **WRONG ❌**: Create iframe in useEffect with `document.createElement`
   - **CORRECT ✅**: Use JSX `<iframe>` directly with `ref`, set `src` in useEffect
   ```tsx
   // CORRECT ✅
   const iframeRef = useRef<HTMLIFrameElement>(null);
   useEffect(() => {
     if (iframeRef.current) {
       iframeRef.current.src = widgetUrl;
     }
   }, [widgetUrl]);
   
   return <iframe ref={iframeRef} src={widgetUrl} ... />;
   ```
9. **Cloud Run Deployment Region** - Boating project uses `us-central1`, NOT `me-central1`
   ```bash
   gcloud run deploy boating-app --region=us-central1 --project=boating-499409
   ```
10. **Cloud SQL Connection** - Must add `--add-cloudsql-instances` when deploying:
   ```bash
   --add-cloudsql-instances=boating-499409:us-central1:boating-db
   --set-env-vars=CLOUDSQL_CONNECTION_NAME=boating-499409:us-central1:boating-db
   ```
11. **Login API Rate Limiting** - `/api/auth/login` returns 429 after ~5 rapid attempts. When doing E2E testing:
    - Cache the token from the first login and reuse it
    - If rate-limited, wait 60+ seconds before retrying
    - Use admin token as fallback for operations that don't require owner-specific auth
12. **Route Structure** - Boats use `/en/boats/[slug]` (PLURAL), Tours use `/en/tours/[slug]` (PLURAL). The homepage lists both. Boat detail pages show the booking widget. File paths: `app/[locale]/boats/[slug]/page.tsx` and `app/[locale]/tours/[slug]/page.tsx`.
13. **Users Table Schema** - `users` table does NOT have a `status` column. Columns: `id, email, name, role, password, created_at, updated_at`.
14. **Bokun Widget "This content is blocked"** - Appears when `BOKUN_ACCESS_KEY`/`BOKUN_SECRET_KEY` are not configured in Cloud Run env vars. The iframe loads but Bokun rejects the request. Fix by setting Bokun credentials via `--set-secrets` or `--set-env-vars` on deploy.
15. **CSP for direct iframe is simpler** - When using direct `<iframe>`, you only need `frame-src 'self' https://widgets.bokun.io`. You do NOT need `static.bokun.io` in `script-src` because the iframe handles its own script loading internally. The complex CSP with both `widgets.bokun.io` and `static.bokun.io` was only needed for the unreliable BokunWidgetsLoader approach.
16. **Widget Still Broken After All Fixes** - If you've used direct iframe (the correct approach) and it STILL doesn't work:
    - **Verify the iframe src URL is correct**: Open the widget URL directly in a new tab. If it loads, the iframe should work.
    - **Check CSP headers**: Ensure `frame-src` includes `https://widgets.bokun.io`.
    - **Test the widget URL directly**: `https://widgets.bokun.io/online-sales/{CHANNEL_UUID}/experience-calendar/{PRODUCT_ID}?lang=en`. If it 404s, wrong UUID or activity ID. If it's blank, check Bokun dashboard (availability, pricing, channel linking).
    - **Verify deployment actually updated**: After deploying, check the live page's iframe src with browser dev tools. If the old code is still there, the deployment didn't apply correctly.
17. **Gallery Images Broken** - When tour detail page gallery images show as broken (gray placeholders):
    - **Use regular `<img>` tags for Bokun S3 URLs** — Next.js `<Image>` optimization adds overhead that causes slow loading or broken images for external URLs. See Section 6 above.
    - **Check image URLs in database**: Query the tours table to see what image URLs are stored.
    - **Test URLs directly**: Open Bokun S3 URLs in a browser to verify they're still accessible.
    - **Re-sync from Bokun**: Run `curl -X POST https://boatingksa.com/api/bokun/sync` to refresh image URLs.
    - **Fallback images**: Add `onError` handler: `<img src={url} onError={(e) => { e.currentTarget.src = '/fallback.jpg' }} />`
19. **Page Timeout on Specific Tours** - When a specific tour page times out:
    - **Check slug in database**: Verify the slug exists and matches the URL.
    - **Test Bokun API for that activity**: If `bokun_activity_id` exists, test it via the search API.
    - **Set API timeout**: Ensure Bokun API calls have a timeout: `fetch(url, { signal: AbortSignal.timeout(10000) })`
    - **Check server logs**: `gcloud logging read "resource.type=cloud_run_revision" --project=boating-499409 --limit=50`
20. **Next.js Redirect Patterns for Dynamic Routes** - When trying to redirect URLs with trailing characters (like `/tours/white-orca-` → `/tours/white-orca`), Next.js redirect patterns with wildcards can cause 500 errors:
    - **WRONG ❌**: `source: "/:locale(en|ar)/tours/:slug*-"` (wildcard + trailing char causes 500)
    - **CORRECT ✅**: Handle it in code with `slug.replace(/-+$/, "")` in the data fetching function
    - **Lesson**: For dynamic route cleanup, code-level handling is more reliable than Next.js redirect patterns. Redirects work best for static path changes, not for cleaning dynamic segments.
21. **Arabic/Non-ASCII Titles Break Slug Generation** - When Bokun experience titles are in Arabic (e.g., "لولو البحر"), the regex `/[^a-z0-9]+/g` strips ALL characters because Arabic is outside ASCII range, resulting in empty slugs. **FIX**: Look up slugs from the database by `bokun_activity_id` instead of generating them from titles. The DB already has the correct human-readable slug (e.g., `lolo-al-bahr`). See Section 21 for implementation.
22. **⚠️ Bokun Widget Redirect REMOVED** - The Bokun widget redirect was removed (2026-07-22) for two reasons: (1) widget URL renders a blank white page with only language/currency selectors, (2) widget uses Bokun's payment gateway, not Moyasar. Detail pages now render own product page + BookingFlow + Moyasar. Do NOT re-add `redirect()` to Bokun widget URLs. See Section 30.
23. **Bokun Checkout URL** - The `?experienceIds=id1,id2` parameter on the general booking URL shows an empty/blank page. Use the plain general booking URL `https://widgets.bokun.io/online-sales/{UUID}?language={locale}` for checkout instead. This shows all experiences with the full booking flow.
24. **Site-Wide Components via LayoutWrapper** - When adding a component that should appear on ALL pages (like a shopping cart), add it to `LayoutWrapper.tsx` instead of individual page components. Remove any page-level duplicates to avoid double-rendering. Use event-based communication (`window.dispatchEvent(new Event("toggle-cart"))`) for cross-component interaction between header icons and the sidebar.
25. **Header CTA Visual Consistency** - The user expects header action buttons to be visually consistent. The shopping cart icon must use the SAME gold gradient as the "احجز الآن"/"Book Now" button (`bg-gradient-to-b from-nautical-gold to-amber-600` with `#92400e` drop shadow). A plain dark/black icon was rejected as "difficult to see". When adding new header CTAs, match the existing gold treatment. See Section 23.
26. **Widget Language Param Ignored = Bokun-Side Config, Not Code** - If the Bokun widget shows English despite `?language=ar` in the URL, the cause is almost always that Arabic isn't enabled on the Bokun activity/channel (`languages: ["EN_GB"]` only). Prove it by testing `?language=de` (also English → param ignored) and reading `languages`/`baseLanguage` from `GET /activity.json/{id}`. Language enablement is dashboard-only (Extranet → Settings → Languages) — `PUT /activity.json` and channel endpoints return 404/timeout. Don't rewrite frontend code that's already sending the param correctly. See Section 26.
27. **⚠️ Bokun-Only Architecture (CURRENT)** - User directive (2026-07-22): ALL products from Bokun ONLY, zero local DB queries for products. Listing pages use `<ProductList>` (fetches from `/api/bokun/products`). Detail pages use `findBokunActivity()` → render own product detail page with BookingFlow + Moyasar payment (NOT redirect to Bokun widget). Search API is pure Bokun with no DB mapping or auto-sync. The local DB is ONLY for users/auth/bookings/reviews. Do NOT re-add DB fallbacks, auto-sync, or local product lookups. See Section 27 and Section 30.
28. **gcloud Account Switching** - When deploying, verify the active gcloud account is `tareqmonaffal@gmail.com` (Boating project owner). If you see `PERMISSION_DENIED` on `artifactregistry` or `run.services.get`, the account may have switched to `allam-claude-code-agent@allam-492605.iam.gserviceaccount.com`. Fix: `gcloud config set account tareqmonaffal@gmail.com && gcloud config set project boating-499409`.
29. **Products API Must Map Raw Bokun Fields** - The `/api/bokun/products` route must transform raw Bokun items (`keyPhoto.originalUrl`, `excerpt`, `durationText`, `maxCapacity`, etc.) into the flat shape `ProductList` expects (`image`, `description`, `duration`, `capacity`, `slug`). Without this mapping, cards show "No image" and missing data. Also generate slugs: ASCII titles → slugify; Arabic → `tour-{id}`. See Section 28.
30. **⚠️ `getActivity()` is BROKEN (returns 404 for ALL IDs)** - The `GET /activity/{id}.json` endpoint returns `Bókun API Error 404` for every activity ID, including known-valid ones. This is NOT intermittent — it's a complete, permanent breakage (confirmed 2026-07-22). **Do NOT import or call `getActivity()` anywhere.** Use `searchActivities()` and find the matching item from results. The search fallback in `findBokunActivity()` MUST match by activity ID (`String(item.id) === numericId`), not just by slugified title. Without ID matching, ALL Arabic-titled products 404 on detail pages because their `tour-{id}` slugs can't be resolved via title slugification. See Section 29.
31. **ShoppingCart Checkout → Own Checkout Page** - ShoppingCart `handleCheckout()` must navigate to `/${locale}/checkout` (our own checkout page), NOT open Bokun widget URLs. Removed `BOOKING_CHANNEL_UUID` constant and `window.open(bookingUrl, "_blank")` from ShoppingCart. The cart data persists in localStorage; the checkout page reads from it. Do NOT re-add Bokun widget URLs to ShoppingCart checkout. See Section 30.
32. **BookingFlow Bokun-Mode UX** - When `bokunProductId` is provided, BookingFlow hides the duration selector (shows static `productDuration`), uses `productPrice` as total (NOT multiplied by guests), and shows product title + total in the summary step. Capacity defaults to 10 when Bokun returns 0. See Section 31.

### 30. "Book from Bokun, Pay with Moyasar" Architecture (CURRENT — 2026-07-22)

**User directive**: Bokun widget redirect is REMOVED (blank page + wrong payment gateway). All booking and payment happens on our own site. Bokun is ONLY the product data source.

**Architecture**:
```
Bokun API (product data) → Our product detail page → Our BookingFlow → Moyasar payment
```

#### Components:

**1. `bokun_bookings` table** (in `lib/database.ts`):
```sql
CREATE TABLE IF NOT EXISTS bokun_bookings (
  id SERIAL PRIMARY KEY,
  bokun_product_id VARCHAR(50) NOT NULL,
  product_title VARCHAR(255),
  user_id INTEGER REFERENCES users(id),
  booking_date DATE NOT NULL,
  booking_time VARCHAR(10),
  guests INTEGER NOT NULL DEFAULT 1,
  duration_text VARCHAR(100),
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50),
  total_amount DECIMAL(10,2),
  currency VARCHAR(10) DEFAULT 'SAR',
  status VARCHAR(50) DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

**2. `POST /api/bookings/bokun`** — creates a Bokun product booking:
- Auth required (same pattern as `/api/bookings`)
- Accepts: `bokun_product_id`, `product_title`, `booking_date`, `booking_time`, `guests`, `duration_text`, `total_amount`, `currency`, `notes`, `customer_name`, `customer_email`, `customer_phone`
- Inserts into `bokun_bookings` table
- Returns `{ success: true, bookingId: id }`

**3. `POST /api/payment/create-moyasar`** — extended to support `bokun_booking_id`:
- If `bokun_booking_id` provided → query `bokun_bookings` table (not `bookings`)
- Verify booking exists and belongs to user
- Create Moyasar payment with `product_title` in description
- Store payment with prefixed booking reference
- Existing `booking_id` flow (boat bookings) unchanged

**4. `BookingFlow.tsx`** — extended interface:
```typescript
interface BookingFlowProps {
  boatId?: string;        // existing boat booking
  boatName?: string;
  locale: string;
  capacity: number;
  // New: Bokun product booking
  bokunProductId?: string;
  productTitle?: string;
  productPrice?: number;
  productDuration?: string;
}
```
- If `bokunProductId` → call `/api/bookings/bokun` then `/api/payment/create-moyasar` with `bokun_booking_id`
- If `boatId` → existing flow (call `/api/bookings` then `/api/payment/create-moyasar` with `booking_id`)

**5. Detail pages** (`tours/[slug]`, `boats/[slug]`):
- `findBokunActivity(slug)` → `searchActivities()` to find matching activity (do NOT use `getActivity()` — broken, Section 29)
- Fetch full data via `searchActivities(lang, "SAR", 1, 50)` and find matching item by ID (with EN fallback)
- Render product detail: hero image, title, description, price, duration, capacity
- Include `<BookingFlow bokunProductId={...} productTitle={...} productPrice={...} />`
- NO `redirect()` to Bokun widget

**6. ShoppingCart checkout**:
- Navigate to `/${locale}/tours/tour-{id}` (product detail page with BookingFlow)
- Or navigate to `/${locale}/checkout` (our checkout page)
- Do NOT open Bokun widget URLs

#### Key files:
- `app/api/bookings/bokun/route.ts` — Bokun product booking API
- `app/api/payment/create-moyasar/route.ts` — extended for `bokun_booking_id`
- `components/booking/BookingFlow.tsx` — dual-mode (boat + Bokun product)
- `app/[locale]/tours/[slug]/page.tsx` — product detail + BookingFlow
- `app/[locale]/boats/[slug]/page.tsx` — product detail + BookingFlow
- `components/booking/ShoppingCart.tsx` — checkout to our pages, not Bokun

#### What NOT to do:
- ❌ Do NOT `redirect()` to Bokun widget URLs
- ❌ Do NOT open Bokun widget URLs from any component
- ❌ Do NOT use Bokun's payment/checkout flow
- ❌ Do NOT query local DB for product data (Bokun API only)
- ✅ DO use Bokun API for product data (search, getActivity, searchProducts)
- ✅ DO use own BookingFlow + Moyasar for all bookings and payments
- ✅ DO store Bokun product bookings in `bokun_bookings` table

### 31. BookingFlow Bokun-Mode UX Decisions

When `bokunProductId` is provided (Bokun product booking mode), the BookingFlow component behaves differently from boat booking mode:

**Duration selector**: HIDDEN for Bokun products (the duration comes from the product itself, not user-selectable). Instead, show a static read-only display of `productDuration`:
```tsx
{!isBokunBooking && (
  <select>...</select>  // Duration dropdown — boat mode only
)}
{isBokunBooking && productDuration && (
  <div className="... bg-gray-50 text-gray-700">{productDuration}</div>
)}
```

**Total calculation**: For Bokun products, total = `productPrice` (per booking, NOT multiplied by guests). For boat bookings, total = `hourlyRate * duration`.

**Summary step**: Shows product title, static duration (not "X hours" from dropdown), and a total amount line (`productPrice.toFixed(2) SAR`) highlighted in `text-nautical-gold`.

**Capacity fallback**: When `maxCapacity` from Bokun is 0 or missing, default to 10 in the detail page. The BookingFlow uses `Math.max(1, capacity)` for the guests dropdown range.

**Display title**: `isBokunBooking ? (productTitle || boatName || '') : (boatName || '')` — handles both modes cleanly.
