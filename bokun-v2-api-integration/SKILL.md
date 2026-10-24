---
name: bokun-v2-api-integration
description: Bokun v2 API integration for creating experiences. Complete required fields, authentication, and workflow.
version: 1.0.0
tags: [bokun, api, integration, boating]
---

# Bokun v2 API Integration

## Overview
Bokun v2 API requires specific fields to create experiences. This skill documents all requirements discovered during integration.

## Authentication

**CRITICAL: Both v1 and v2 APIs use HMAC-SHA1 authentication.**

Despite the OpenAPI spec suggesting simple header auth, the v2 API endpoints (`/restapi/v2.0/*`) actually require HMAC-SHA1 authentication, same as v1.

Headers for BOTH v1 and v2:
```
X-Bokun-Date: YYYY-MM-DD HH:MM:SS (UTC)
X-Bokun-AccessKey: YOUR_ACCESS_KEY
X-Bokun-Signature: HMAC-SHA1(date + accessKey + method + path)
Content-Type: application/json;charset=UTF-8
Accept: application/json
```

**Pitfall:** The OpenAPI spec at `api-docs.bokun.dev/rest-v2.yaml` shows simple `access-key` and `secret-key` headers, but this is INCORRECT. The actual API requires HMAC-SHA1. If you use simple headers, you get "Could not process this request" or auth failures.

**Pitfall:** The v2 API servers are `https://api.bokun.io` (production) and `https://api.bokuntest.com` (test). Both are behind CloudFront and will return HTML error pages (not JSON) for auth failures.

**Pitfall — a 404 does not mean the endpoint is missing.** The signature is computed over exactly `date + accessKey + method + path` (no body, no newlines, no separators). Get that string wrong and EVERY path answers `{"status":404,"message":""}` — including paths that certainly exist. Before concluding any endpoint is absent, re-test a known-good call (`POST /activity.json/search`); if that also 404s, the scheme is wrong, not the route. Requests that include the body or use `method\ntimestamp\npath\nbody` (a scheme some older scripts use) fail exactly this way.

## Reading bookings, money and audit data (verified against a live account)

Read paths that work with the legacy/v1 keys:

- `POST /booking.json/booking-search` — body `{page, pageSize, sorting:{field:"DATE_CREATED",order:"DESC"}, statusFilters:[...]}`. Rows arrive in **`items`**, not `results`. A route that maps only `result.results` returns `totalHits` with zero rows — the classic "total: 9, bookings: []" bug. Row fields: `id`, `confirmationCode`, `paymentStatus`, `paidAmountAsMoney{amount,currency}`, `paidPercentage`, `salesSegment`, `channel{title}`, `seller{title}`, `customer{...}`, `customerInvoice{totalAsMoney,totalDueAsMoney,totalTaxAsMoney,payments[],productInvoices[]}`, `productBookings[]`.
- `GET /booking.json/booking/{bookingId}` — detail: `status`, `totalPrice`, `totalPaid`, `totalDue`, `paymentType`, `customerPayments[]`, `activityBookings[]` (each with `date`, `startTime`, `rateTitle`, `pricingCategoryBookings[].quantity`, `pricingCategory.title`).
- `GET /restapi/v2.0/booking/{bookingId}/payments` — payments applied to the booking (empty until it is actually paid).
- `GET /restapi/v2.0/booking/{bookingId}/invoices?invoiceType=SELLER` — seller/agent/affiliate invoices; line items carry `commissionPercentage` and `commissionAmount` (null when no commercial contract applies).
- `GET /restapi/v2.0/booking/{bookingId}/audit-records` — real audit trail (`date`, `status`, `action`, `bookingChannelId`). This is the only free source of "who did what" on a booking; use it instead of building an audit table from scratch.

## What Bokun does NOT expose — build it in the host app

No API exists for commission accounting, payouts/settlements, or extranet user management: `{payment,commission,settlement,user,vendor,report}` under `/restapi/v1.0` and `/restapi/v2.0` all 404 even with a valid signature. Therefore:

- Owner net / platform commission / payout statements must be computed and stored by the host app, reading sales from Bokun and applying the contract rate.
- Staff accounts and roles cannot be provisioned through the API — they are created in the Bokun extranet (predefined roles: Admin, Sales, Sales Manager, Product Manager, Technical, Driver/Guide; custom roles supported). Never promise a customer API-driven Bokun user provisioning.
- Booking state changes that involve money are posted explicitly: `POST /booking.json/edit` with `AddBookingPaymentAction` (record a payment) or `RefundBookingPaymentAction` (refund), documented at `bokun.dev/booking-api-rest`.

## Bookings paid by an external gateway look unpaid in Bokun

When the host app charges through its own PSP and only reserves in Bokun, Bokun keeps `paymentStatus=NOT_PAID`, `totalPaid=0`, `totalDue` = full price, and `customerInvoice.payments` empty. Do not file this as a defect or reconcile from it — reconcile against the PSP's records, and if Bokun must show the booking paid, post the payment with `AddBookingPaymentAction`.

## Required Fields for Experience Creation

### Basic Fields
- `title`: string (required)
- `shortDescription`: string (required)
- `description`: string (required)
- `type`: string (required) - `DAY_TOUR_OR_ACTIVITY`
- `duration`: object (required)
  ```typescript
  {
    weeks: 0,
    days: 0,
    hours: 4,
    minutes: 0
  }
  ```
- `location`: object (required)
  ```typescript
  {
    name: string,
    city: string,
    countryCode: 'SA'  // ISO 3166-1 alpha-2
  }
  ```

### Booking & Capacity
- `bookingType`: string (required) - `DATE_AND_TIME`
- `capacityType`: string (required) - `FREE_SALE`
- `timeZone`: string (required) - `Asia/Riyadh`
- `difficultyLevel`: string (required) - `EASY`, `MODERATE`, `DIFFICULT`

### Box & Combo Settings
- `boxSettings`: object (required)
  ```typescript
  {
    isBox: false
  }
  ```
  **Pitfall:** Do NOT include `minPaxPerBooking` or `maxPaxPerBooking` - these fields don't exist in `ExperienceBoxSettingsDto`. Only valid fields: `boxedProductId`, `isBox`, `overridePhotosVideos`, `overrideCustomInputFieldValues`, `overrideItinerary`.

- `combo`: object (required)
  ```typescript
  {
    isCombo: false
  }
  ```
  **Pitfall:** Must be an object, NOT a boolean. Sending `combo: false` will fail with "Cannot construct instance of ExperienceComboSettingsDto from boolean value".

### Ticket & Private Settings
- `ticket`: object (required)
  ```typescript
  {
    ticketMsg: string,  // e.g., "Present your ticket at the marina"
    ticketPerPerson: boolean,
    barcodeFormat: string  // e.g., "QR_CODE"
  }
  ```
  **Pitfall:** Do NOT use `ticketType` field - it doesn't exist. Valid fields: `ticketMsg`, `ticketPerPerson`, `barcodeFormat`.

- `privateExperience`: boolean (required) - `true` or `false`
  **Pitfall:** Must be a boolean, NOT an object. Sending `privateExperience: { isPrivate: true }` will fail with "Cannot deserialize value of type Boolean from Object value".

- `allowCustomizedBookings`: boolean (required) - `false`

### Cutoff Settings
- `cutoff`: object (required)
  ```typescript
  {
    type: 'RELATIVE_TO_START_TIME',  // REQUIRED - must include type field
    weeks: 0,
    days: 0,
    hours: 2,
    minutes: 0
  }
  ```
  **Pitfall:** The `type` field is MANDATORY. Omitting it will fail with "cutoff::type absent".

### Availability Rules
- `availabilityRules`: array (required)
  ```typescript
  [
    {
      recurrenceRule: {
        startDate: 'YYYY-MM-DD',
        endDate: 'YYYY-MM-DD'
      },
      maxCapacity: number,
      allStartTimes: true
    }
  ]
  ```

### Pricing Categories
- `pricingCategories`: object (required)
  ```typescript
  {
    defaultId: number,  // Get from API: GET /restapi/v2.0/pricing/categories
    ids: [number]
  }
  ```
  **Pitfall:** Must be an object with `defaultId` and `ids` fields, NOT an array. Sending an array will fail with "Cannot deserialize value of type ExperiencePricingCategoriesDto from Array value".

### Rates
- `rates`: object (required)
  ```typescript
  {
    rates: [
      {
        externalId: 'standard',
        title: 'Standard Rate',
        pickupSelectionType: 'UNAVAILABLE',
        dropoffSelectionType: 'UNAVAILABLE',
        cancellationPolicyId: number,  // Get from API: GET /restapi/v2.0/cancellation/policies
        pricedPerPerson: true,
        allPricingCategories: true,
        allStartTimes: true,
        tieredPricingEnabled: false
      }
    ],
    defaultRate: {
      externalId: 'standard'
    }
  }
  ```

### Pricing
- `pricing`: object (required)
  ```typescript
  {
    experiencePriceRules: [
      {
        rate: { externalId: 'standard' },
        pricingCategoryId: number,
        amount: number,
        currency: 'SAR',
        priceCatalogId: number  // Get from API: GET /restapi/v2.0/price/catalogs
      }
    ],
    extraPriceRules: [],
    pickupPriceRules: [],
    dropoffPriceRules: [],
    priceCatalogCurrencies: [
      {
        priceCatalogId: number,
        currencies: ['SAR'],
        defaultCurrency: 'SAR'
      }
    ]
  }
  ```

### Photos
- `photos`: array (optional for CREATE, but required for UPDATE)
  - Empty array `[]` for initial creation
  - Upload photos separately after experience is created

## API Endpoints

### Get Cancellation Policies
```
GET /restapi/v2.0/cancellation/policies?pageNo=0&pageSize=10
```

### Get Pricing Categories
```
GET /restapi/v2.0/pricing/categories?pageNo=0&pageSize=10
```

### Get Price Catalogs
```
GET /restapi/v2.0/price/catalogs?pageNo=0&pageSize=10
```

### Create Experience
```
POST /restapi/v2.0/experience
Body: ExperienceComponentsDto
```

## Workflow

1. **Fetch Prerequisites**
   - Get cancellation policy ID
   - Get pricing category ID
   - Get price catalog ID

2. **Build Experience Payload**
   - Include all required fields above
   - Set `photos: []` for initial creation

3. **Create Experience**
   - POST to `/restapi/v2.0/experience`
   - Save returned experience ID

4. **Upload Photos** (Optional)
   - Use separate photo upload endpoint
   - Update experience with photo IDs

## Prerequisites Pattern (Critical)

**You MUST fetch IDs from Bokun before creating experiences.** Do not hardcode IDs.

```typescript
// Fetch prerequisites FIRST
const [cancellationPolicies, pricingCategories, priceCatalogs] = await Promise.all([
  getCancellationPolicies(0, 10),
  getPricingCategories(0, 10),
  getPriceCatalogs(0, 10),
]);

const cancellationPolicyId = (cancellationPolicies as any).data?.[0]?.id;
const pricingCategoryId = (pricingCategories as any).data?.[0]?.id;
const priceCatalogId = (priceCatalogs as any).data?.[0]?.id;
```

**Why this matters:**
- IDs vary between Bokun accounts
- Hardcoding IDs will fail in production
- API returns these in `.data[0].id` structure

## Photos Upload Pattern

**Photos must be uploaded SEPARATELY after experience creation.**

```typescript
// Step 1: Create experience with empty photos array
const experienceData = {
  // ... all required fields
  photos: [], // MUST be empty array for initial creation
};

const result = await createExperience(experienceData);
const experienceId = result.id;

// Step 2: Upload photos separately (if needed)
// Use Bokun photo upload endpoint
```

**Why:** Bokun API rejects experience creation if photos have `url` but no `id`. Photos must be uploaded first to get IDs, then linked to the experience.

## Admin Portal Integration

For admin dashboards that manage Bokun experiences:

1. **Create management page** at `/[locale]/admin/bokun`
2. **Fetch statistics** from local database (count synced vs unsynced)
3. **Provide sync button** that calls `/api/admin/bokun/sync`
4. **Display results** with success/failure counts and error details

See `references/admin-portal-pattern.md` for complete implementation pattern.

## Common Errors & Solutions

| Error | Solution |
|-------|----------|
| `BOX_SETTINGS is mandatory for CREATE` | Add `boxSettings: { isBox: false }` — do NOT include minPaxPerBooking/maxPaxPerBooking |
| `combo absent` / `Cannot construct instance...from boolean` | Must be object: `combo: { isCombo: false }` NOT `combo: false` |
| `TICKET is mandatory for CREATE` | Add `ticket: { ticketMsg: "...", ticketPerPerson: true, barcodeFormat: "QR_CODE" }` — no `ticketType` field |
| `PRIVATE_EXPERIENCE is mandatory` | Add `privateExperience: true` (boolean, NOT object) |
| `ALLOW_CUSTOMIZED_BOOKINGS is mandatory` | Add `allowCustomizedBookings: true` (boolean) |
| `cutoff absent` / `cutoff::type absent` | Add `cutoff: { type: 'RELATIVE_TO_START_TIME', days: 1, hours: 0, minutes: 0 }` — type field is MANDATORY |
| `meetingType absent` / `Cannot deserialize...from String` | Must be object: `meetingType: { type: 'MEET_ON_LOCATION', ... }` NOT string `'MEET_AT_LOCATION'` |
| `availabilityRules absent` | Add `availabilityRules: [...]` |
| `pricingCategories absent` / `Cannot deserialize from Array` | Must be object: `pricingCategories: { defaultId, ids }` NOT an array |
| `rates absent` | Add `rates: { rates: [...], defaultRate: {...} }` |
| `PRICING is mandatory` | Add `pricing: { experiencePriceRules: [...] }` |
| `photos[0]:id absent` | Set `photos: []` for initial creation |
| `bookingType` enum error | Valid values: `PASS`, `DATE`, `DATE_AND_TIME` — NOT `ON_REQUEST` |
| `capacityType` enum error | Valid values: `LIMITED`, `ON_REQUEST`, `FREE_SALE` — NOT `MAX_PERSONS` |
| `duration::minutes absent` | Must include all: `{ weeks: 0, days: 0, hours: 3, minutes: 0 }` |
| `Unrecognized field "minPaxPerBooking"` | boxSettings only accepts: `isBox`, `boxedProductId`, `overridePhotosVideos`, `overrideCustomInputFieldValues`, `overrideItinerary` |
| `Could not process this request` | Wrong auth scheme — v2 API needs HMAC-SHA1 (same as v1), not simple access-key/secret-key headers |

## Example Implementation

See `/home/moe/boating-project-monitor/scripts/bokun-onboarding.ts` for complete working implementation.
See `references/minimal-experience-payload.md` for the minimal working payload structure (discovered through iterative API validation).

## Admin Dashboard Integration

For the admin dashboard to create Bokun experiences:

1. **Form Fields**
   - Title (Arabic + English)
   - Description (Arabic + English)
   - Duration (hours/minutes)
   - Capacity
   - Price (amount + currency)
   - Location (marina, city)
   - Difficulty level
   - Meeting point address

2. **Auto-populate**
   - Fetch cancellation policies, pricing categories, price catalogs on form load
   - Use defaults for most settings

3. **Validation**
   - Ensure all required fields are filled
   - Validate Arabic/English content

4. **Submission**
   - Call Bokun API with all required fields
   - Save returned experience ID to database
   - Handle photo upload separately

## Frontend Widget Integration

For embedding Bokun booking widgets in client components:

```typescript
import dynamic from "next/dynamic";

// Dynamic import with SSR disabled (widgets use browser APIs)
const BokunWidget = dynamic(
  () => import("@/components/booking/BokunWidget").then(mod => mod.BokunWidget),
  { 
    ssr: false, 
    loading: () => <div className="h-12 bg-gray-100 animate-pulse rounded" /> 
  }
);

// Usage in card/list components
{boat.bokun_activity_id && (
  <div className="mt-3">
    <BokunWidget
      productId={boat.bokun_activity_id}
      widgetType="booking"
      locale={locale}
    />
  </div>
)}
```

**Key points:**
- Use `dynamic()` with `ssr: false` - widgets rely on browser APIs
- Provide loading state with matching height to prevent layout shift
- Check for `bokun_activity_id` before rendering
- Pass `productId` (the Bokun experience ID) and `widgetType` ("booking" or "search")
- Works in loops (e.g. boat cards, tour listings)

**Image variants come free — use them.** Every Bokun photo object carries `derived[]` with three ready-made sizes: `thumbnail` (w=80), `preview` (w=300), `large` (w=660). `keyPhoto.originalUrl` is the full-resolution file (often 175 KB–1.8 MB). Reading `derived?.url` as if it were an object instead of an array makes the lookup undefined and silently falls back to the original, which is the usual cause of a slow listing page.

## Notes

- Updating an EXISTING experience's rates/pricing: use `PUT /restapi/v2.0/experience/{id}/components` (component-based partial update; omit components you don't touch). See boating-bokun-integration §37 for validated DTO quirks (tieredPricingEnabled conditional, price-rule id not reusable, amount string, no publish step).

- Bokun API is strict about required fields
- Use `UNAVAILABLE` not `DISABLED` for pickup/dropoff selection types
- Photos must be uploaded separately after experience creation
- All pricing must reference valid IDs from prerequisite endpoints
- Timezone should be `Asia/Riyadh` for Saudi Arabia

## Pitfalls: startTimes Format (CRITICAL)

**The v2 API `startTimes` field uses a specific DTO format — NOT string times.**

Wrong (will get 400 error):
```json
{
  "startTimes": [
    { "startTime": "08:00", "endTime": "12:00" }
  ]
}
```

Correct:
```json
{
  "startTimes": [
    { "hour": 8, "minute": 0, "durationHours": 4 },
    { "hour": 13, "minute": 0, "durationHours": 4 }
  ]
}
```

**Error message if wrong:**
```
Unrecognized field "startTime" (class io.bokun.rest.v2_0.ExperienceStartTimeDto), 
not marked as ignorable (15 known properties: "pickupHour", "hour", "externalId", 
"externalLabel", "durationMinutes", "overrideTimeWhenPickup", "pickupMinute", 
"label", "voucherPickupMsg", "id", "comboStartTimeMappings", "durationDays", 
"minute", "durationHours", "durationWeeks"])
```

**Valid fields for ExperienceStartTimeDto:**
- `hour` (int) — start hour
- `minute` (int) — start minute
- `durationHours` (int) — duration in hours
- `durationMinutes` (int) — additional duration minutes
- `durationDays` / `durationWeeks` — for multi-day experiences
- `pickupHour` / `pickupMinute` — if pickup is involved
- `externalId` / `externalLabel` — your own reference
- `overrideTimeWhenPickup` (bool)

## Pitfalls: Database Schema for Sync

When syncing Bokun experiences to a local database, ensure schema alignment:
- Use `max_guests` (not `capacity`) for tour capacity columns
- Include `bokun_activity_id VARCHAR(255)` column on both `boats` and `tours` tables
- Use `price_currency` (not just `currency`) to avoid ambiguity with other currency fields
- The sync query should select `max_guests` and map it to `maxCapacity` in the Bokun payload
