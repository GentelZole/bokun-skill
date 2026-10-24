---
name: bokun
description: "Bokun.io tourism booking platform integration — covers both v1 and v2 APIs. Routes to authentication, activity/experience creation, booking sync, availability, data extraction, and widget embedding."
triggers:
  - bokun
  - bokun api
  - bokun integration
  - tourism booking api
  - activity sync
  - experience creation
  - hmac-sha1 authentication
  - tour operator api
  - boat rental sync
  - bokun v2
  - bokun widget
allowed_tools:
  - terminal
  - write_file
  - patch
  - read_file
  - web_search
metadata:
  sub_skills:
    - bokun-api-integration
    - bokun-v2-api-integration
  trigger: "Any Bokun.io API work — authentication, creating activities/experiences, syncing bookings, checking availability, embedding widgets, or troubleshooting Bokun errors."
---

# Bokun Integration (Umbrella)

## Decision Tree — Which API Version?

```
Is the task about...
├── Reading/searching existing activities, syncing bookings, checking availability,
│   extracting images/Arabic from existing Bokun data, or payment provider questions?
│   └── → USE v1 API (bokun-api-integration knowledge)
│
├── Creating NEW experiences/products from scratch with full field requirements?
│   └── → USE v2 API (bokun-v2-api-integration knowledge)
│
├── Embedding Bokun booking widgets in frontend?
│   └── → USE v1 patterns (widget uses productId from either API)
│
└── Admin dashboard / sync orchestration?
    └── → Both: v2 for creation, v1 for ongoing sync/updates
```

### Quick Routing Rules

| Task | API Version | Endpoint Base |
|------|------------|---------------|
| Search/list activities | v1 | `POST /activity.json/search` |
| Create activity (legacy) | v1 | `POST /activity.json` |
| Create booking | v1 | `POST /booking.json` |
| Check availability | v1 | `POST /product/{id}/availability.json` |
| Create experience (new) | v2 | `POST /restapi/v2.0/experience` |
| Get pricing categories | v2 | `GET /restapi/v2.0/pricing/categories` |
| Get cancellation policies | v2 | `GET /restapi/v2.0/cancellation/policies` |
| Get price catalogs | v2 | `GET /restapi/v2.0/price/catalogs` |

---

## Shared: Authentication (BOTH v1 and v2)

**CRITICAL: Both APIs use HMAC-SHA1 authentication.** The v2 OpenAPI spec showing simple `access-key`/`secret-key` headers is WRONG.

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
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")} ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}:${String(now.getUTCSeconds()).padStart(2, "0")}`;
}

export async function bokunRequest<T>(
  method: string, path: string, body?: Record<string, unknown>, retries: number = 2
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

**Pitfall:** v2 API servers are `https://api.bokun.io` (prod) and `https://api.bokuntest.com` (test). Both return HTML error pages (not JSON) for auth failures.

---

## v1 API — Activities, Bookings, Availability, Sync

### Key Endpoints
- `POST /activity.json` — Create activity
- `POST /activity.json/search?lang=EN&currency=SAR` — Search activities
- `POST /booking.json` — Create booking
- `POST /product/{productId}/availability.json` — Check availability

### Boat → Bokun Activity Sync
When a boat is created locally, create a corresponding Bokun activity:
```typescript
const activityData = {
  title: boatData.name_en,
  description: boatData.description_en || '',
  maxParticipants: boatData.capacity,
  price: { amount: boatData.price_amount, currency: boatData.price_currency || 'SAR' },
  location: boatData.marina || '',
  tags: boatData.features_en || [],
  images: (boatData.images || []).map((url: string) => ({ url, alt: boatData.name_en })),
};
const result = await bokunRequest("POST", "/activity.json", activityData);
// Store result.id as bokun_activity_id in local DB
```

### Booking Sync
```typescript
const bokunBookingData = {
  productId: parseInt(boat.bokun_activity_id),
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
```

### Fallback Pattern
When Bokun is unavailable, fall back to local database availability check:
```typescript
try {
  const availability = await bokunRequest("POST", `/product/${productId}/availability.json`, { dateStart, dateEnd, numPersons: 1 });
  return { available: true, source: 'bokun', data: availability };
} catch {
  // Check local bookings table for conflicts
  const result = await pool.query(`SELECT COUNT(*) as count FROM bookings WHERE boat_id = $1 AND status = 'confirmed' AND (start_date <= $2 AND end_date >= $3)`, [productId, dateEnd, dateStart]);
  return { available: parseInt(result.rows[0].count) === 0, source: 'database' };
}
```

### Data Extraction (Bokun → Local Sync)
Use shared extractor for images + Arabic translations:
- **Images:** Check `activity.photos[]`, `activity.images[]`, `activity.keyPhoto` — extract `originalUrl` or `url`
- **Arabic name:** Check `activity.titleAr`, `activity.translations.AR.title`, `activity.translations.ar.title`
- **Arabic description:** Check `activity.descriptionAr`, `activity.translations.AR.description`
- **Use `COALESCE($param, existing_column)`** in UPDATE queries to preserve existing Arabic content if Bokun doesn't have it

### Payment Providers
- **Supported:** Stripe, Braintree, PayPal, Rapyd (best for Saudi/MENA — supports Mada), Teya, Repaid, Plug'n Pay, Central Pay, Paytrail, Nets Easy, GMO
- **NOT supported:** Hyperpay, Tap Payments, Tabby, Tamara, Moyasar — must integrate separately outside Bokun widget

---

## v2 API — Experience Creation

### Prerequisites (MUST fetch before creating)
```typescript
const [cancellationPolicies, pricingCategories, priceCatalogs] = await Promise.all([
  bokunRequest("GET", "/restapi/v2.0/cancellation/policies?pageNo=0&pageSize=10"),
  bokunRequest("GET", "/restapi/v2.0/pricing/categories?pageNo=0&pageSize=10"),
  bokunRequest("GET", "/restapi/v2.0/price/catalogs?pageNo=0&pageSize=10"),
]);
const cancellationPolicyId = (cancellationPolicies as any).data?.[0]?.id;
const pricingCategoryId = (pricingCategories as any).data?.[0]?.id;
const priceCatalogId = (priceCatalogs as any).data?.[0]?.id;
```
**Never hardcode IDs** — they vary between Bokun accounts.

### Required Fields for POST /restapi/v2.0/experience

| Field | Type | Value/Notes |
|-------|------|-------------|
| `title` | string | Required |
| `shortDescription` | string | Required |
| `description` | string | Required |
| `type` | string | `DAY_TOUR_OR_ACTIVITY` |
| `duration` | object | `{ weeks: 0, days: 0, hours: N, minutes: 0 }` — ALL fields required |
| `location` | object | `{ name, city, countryCode: 'SA' }` |
| `bookingType` | string | `DATE_AND_TIME` (NOT `ON_REQUEST`) |
| `capacityType` | string | `FREE_SALE` (NOT `MAX_PERSONS`) |
| `timeZone` | string | `Asia/Riyadh` |
| `difficultyLevel` | string | `EASY`, `MODERATE`, or `DIFFICULT` |
| `boxSettings` | object | `{ isBox: false }` — NO minPaxPerBooking/maxPaxPerBooking |
| `combo` | object | `{ isCombo: false }` — MUST be object, NOT boolean |
| `ticket` | object | `{ ticketMsg: "...", ticketPerPerson: true, barcodeFormat: "QR_CODE" }` — NO ticketType field |
| `privateExperience` | boolean | `true` or `false` — NOT an object |
| `allowCustomizedBookings` | boolean | `false` |
| `cutoff` | object | `{ type: 'RELATIVE_TO_START_TIME', weeks: 0, days: 0, hours: 2, minutes: 0 }` — type is MANDATORY |
| `availabilityRules` | array | `[{ recurrenceRule: { startDate, endDate }, maxCapacity, allStartTimes: true }]` |
| `pricingCategories` | object | `{ defaultId: N, ids: [N] }` — MUST be object, NOT array |
| `rates` | object | `{ rates: [{ externalId: 'standard', title, pickupSelectionType: 'UNAVAILABLE', dropoffSelectionType: 'UNAVAILABLE', cancellationPolicyId, pricedPerPerson: true, allPricingCategories: true, allStartTimes: true, tieredPricingEnabled: false }], defaultRate: { externalId: 'standard' } }` |
| `pricing` | object | `{ experiencePriceRules: [{ rate: { externalId: 'standard' }, pricingCategoryId, amount, currency: 'SAR', priceCatalogId }], extraPriceRules: [], pickupPriceRules: [], dropoffPriceRules: [], priceCatalogCurrencies: [{ priceCatalogId, currencies: ['SAR'], defaultCurrency: 'SAR' }] }` |
| `photos` | array | `[]` — empty for creation; upload separately after |

### startTimes Format (CRITICAL)
Wrong: `{ "startTime": "08:00", "endTime": "12:00" }`
Correct: `{ "hour": 8, "minute": 0, "durationHours": 4 }`

### Workflow
1. Fetch prerequisites (cancellation policies, pricing categories, price catalogs)
2. Build experience payload with ALL required fields
3. POST to `/restapi/v2.0/experience` with `photos: []`
4. Save returned experience ID to local DB
5. Upload photos separately if needed

---

## Frontend Widget Integration

```typescript
import dynamic from "next/dynamic";

const BokunWidget = dynamic(
  () => import("@/components/booking/BokunWidget").then(mod => mod.BokunWidget),
  { ssr: false, loading: () => <div className="h-12 bg-gray-100 animate-pulse rounded" /> }
);

// Usage — check for bokun_activity_id before rendering
{boat.bokun_activity_id && (
  <BokunWidget productId={boat.bokun_activity_id} widgetType="booking" locale={locale} />
)}
```

---

## NO EXPERIENCE UPDATE ENDPOINT (verified vs rest-v2.yaml, Sep 2026)
`/restapi/v2.0/experience/{experienceId}` supports **DELETE only** — there is NO PUT/PATCH to edit title/description/location/categories/duration of an existing experience. v1 `/activity.json/*` is all read-only (no create either in current spec). So: to *modify* an experience profile → app.bokun.io dashboard, or delete+recreate (destructive: loses bookings links/IDs — avoid). What IS writable via v2 API: POST /experience (create), POST /experience/{id}/photo (add photos), /components GET+PUT (combo parts), /dailyPricing POST/GET/DELETE, /allocations PUT, POST /allocation, availability closeouts, booking notes, /experience/{id}/availability/changed.

## Common Errors & Solutions

| Error | Fix |
|-------|-----|
| `Could not process this request` | Wrong auth — need HMAC-SHA1 (not simple headers) |
| `BOX_SETTINGS is mandatory` | Add `boxSettings: { isBox: false }` — no minPax/maxPax |
| `Cannot construct instance...from boolean` (combo) | Must be object `{ isCombo: false }` not `false` |
| `TICKET is mandatory` | Add `ticket: { ticketMsg, ticketPerPerson, barcodeFormat }` |
| `PRIVATE_EXPERIENCE is mandatory` | Boolean `true`/`false`, NOT object |
| `cutoff::type absent` | `type: 'RELATIVE_TO_START_TIME'` is MANDATORY in cutoff |
| `Cannot deserialize...from Array` (pricingCategories) | Must be object `{ defaultId, ids }` not array |
| `photos[0]:id absent` | Use `photos: []` for creation; upload separately |
| `bookingType` enum error | Valid: `PASS`, `DATE`, `DATE_AND_TIME` |
| `capacityType` enum error | Valid: `LIMITED`, `ON_REQUEST`, `FREE_SALE` |
| `Unrecognized field "startTime"` | Use `{ hour, minute, durationHours }` format |
| `Unrecognized field "minPaxPerBooking"` | Not valid in boxSettings |

---

## Database Schema Notes

- Use `max_guests` (not `capacity`) for tour capacity columns
- Include `bokun_activity_id VARCHAR(255)` on both `boats` and `tours` tables
- Use `price_currency` (not just `currency`) to avoid ambiguity
- Map `max_guests` → `maxCapacity` in Bokun payloads
