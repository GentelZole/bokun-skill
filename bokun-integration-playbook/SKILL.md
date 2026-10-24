---
name: bokun-integration-playbook
description: "Bokun combo create, facets, image perf recipes."
metadata:
  hermes:
    related_skills: [bokun, bokun-api-integration]
    trigger: "Bokun bundle/experience creation, city-filter design, or slow-image debugging"
---

# Bokun Integration Playbook (field-verified, Sep 2026)

Additive knowledge to the `bokun` umbrella skill. Every recipe below returned HTTP 200 / verified-live against the Boating KSA account.

## 1. Combo (bundle) creation — VERIFIED WORKING payload
A combo sells multiple child experiences as ONE product; availability = intersection of children. Linkage lives on the **parent's start times**, not the combo object:
```json
"combo": {"isCombo": true, "ticketPerComboComponent": false},
"startTimes": [                       // TOP-LEVEL array: full definitions HERE
  {"externalId": "slot-1", "externalLabel": "6AM BoatA", "hour": 6, "minute": 0, "durationHours": 6,
   "comboStartTimeMappings": [{
      "comboChildStartTimeId": 5542659,
      "inheritPickupFromParent": false,
      "rateMappings": [{"comboParentRate": {"externalId": "standard"}, "comboChildRateId": 2502659}],
      "pricingCategoryMappings": [{"comboParentPricingCategoryId": 1210916, "comboChildPricingCategoryId": 1210916}]}]}],
"availabilityRules": [{"recurrenceRule": {"byWeekday": ["MONDAY", "..."], "byMonth": []},
  "maxCapacity": 15, "minTotalPax": 1, "allStartTimes": false,
  "startTimes": [{"externalId": "slot-1"}]}]     // REFERENCES ONLY — plain {externalId}
```
Combo validation errors (all hit live, in this order):
- Omit `boxSettings` entirely → else `"BOX_SETTINGS not applicable for combo products"`
- rates entries must NOT include `tieredPricingEnabled` → "should not be sent"
- `pricing.experiencePriceRules` must be `[]` — pricing derives from child mappings → "pricingCategory should not be sent"
- Child refs are numeric-id only: read children's `startTimes[].id`, `rates.rates[].id`, `pricingCategories` from a v2 dump — account-specific, never hardcode across accounts
- `availabilityRules[].startTimes` items are `IdExternalIdDto` (`externalId`/`id` only — sending label/hour fields → `Unrecognized field "label" ... IdExternalIdDto`); full defs go in the top-level `startTimes` array

## 2. Created experiences are UNPUBLISHED — no publish endpoint exists
After POST /experience (200): product absent from v1 `/activity.json/search`, v1 GET /activity.json/{id} → 404, v2 availability GET → `"Experience#ID is not active or unpublished"`; present in `/restapi/v2.0/experiences/ids`. **Publish/activation = app.bokun.io dashboard only** (no endpoint in rest-v2.yaml). Always plan the human publish step after scripted creates and say so up front. Photos CAN be uploaded while unpublished: `POST /restapi/v2.0/experience/{id}/photo` multipart field `image` (jpeg/png/gif) → 200 + imgcdn.bokun.tools URL. Read-back of published products: v1 GET /activity.json/{id}?lang=EN&currency=SAR.

## 3. Photo shape → the slow-images root-cause pattern
`keyPhoto`/`photos[]` carry BOTH `originalUrl` (full-res 175KB–1.8MB) AND `derived` — an **ARRAY** of sized variants `{name,url}` on `imgcdn.bokun.tools` (~49KB at w=660). Code typed `derived?: {url?}` (object) always evaluates undefined → silently falls back to full-res originals. Debugging checklist: field preference order in the mapper; add `imgcdn.bokun.tools` to next/image remotePatterns + CSP img-src/connect-src; cache search responses server-side (~60s TTL) — un-cached per-request Bokun POSTs measured TTFB 0.7–0.8s; cold next/image re-encode of a 1.8MB original measured 2.2s.

**Sized variants are re-sizeable by URL — no API call (verified live 2026-09-06):** rewrite the imgcdn query params; `...jpeg?w=1600&h=600&mode=crop` returns 200 @146KB vs 280KB for the same photo's S3 original; the `large` 660 variant is too soft for a full-bleed hero, so re-target it rather than falling back to the original. Working helper shape (shipped in Boating `lib/bokun-api.ts`): one picker prefers `derived` name=="large", else nearest variant by parsing `?w=` from the url, else originalUrl/fallback; a second rewrites `w`/`h`/`mode` ONLY for imgcdn hostnames and returns undefined otherwise so callers keep their fallback. Measured after shipping: /ar/tours warm TTFB 0.13s (was 0.7–0.8s), largest listing image 46KB, hero via `/_next/image` 80KB@1080w. Note `searchProducts` and `searchActivities` hit the SAME endpoint (`POST /activity.json/search`) — route one through the other so a single cache covers both server-render and client-refetch paths.

## 4. City filtering: facets in the API, NOT in the widgets
- v1 search body accepts `facetFilters: [{name, values:[...]}]` — live-tested: `city` ("Jeddah"→3 hits), `country` ("SA"), `activityCategories` ("SEA_ANGLING"), `activityAttributes` ("BEACH"), `textFilter`. Unknown facet names fail PERMISSIVE (return all) — validate each filter against an unfiltered call.
- widgets.bokun.io online-sales SPA reads ONLY `language` (+analytics passthrough) — grep of live JS bundles found zero search/city/filter params; product-list widget has no search UI. Site-layer facet filter + per-product widget iframes is the ONLY viable architecture; "filter inside the widget" is never a real option to propose.
- Precondition: facets only surface products whose `location`/categories were SET (dashboard or at create) — legacy boats had `location: null` and appear under "All" only.
- **Map each filter chip to a term the ACCOUNT's own items actually carry — the
  enum union is not enough.** Bokun's category enum contains both `FISHING` and
  `SEA_ANGLING`, but this account's fishing experiences are tagged
  `SEA_ANGLING`; a `fishing→FISHING` chip mapping returns 0 hits while looking
  perfectly valid in unit tests (they assert body shape, not term match). Only
  a runtime check of the filtered URL against the live search (`grep
  activityCategories` in the raw payload, then `?type=fishing` on the prod
  build, expect ≥1 card) catches it. Cross-check worker-authored mapping tables
  against raw payload data before signing off.

## 5. Activity-type model
Bokun Experience = Activity; no boat sub-resource. Activity-specific offerings (birthday/scuba/fishing) = separate experiences differentiated by v2 `categories` (SAILING_OR_BOAT_TOUR, DIVING, FISHING, SEA_ANGLING), `themes` (PRIVATE_ACTIVITY, GROUP_FRIENDLY, LUXURY...), structured `location` {city, countryCode, lat/lng}. Boat↔event pairing = combo with boats as children; do NOT make every boat a combo — plain rentals must stay bookable solo.

## 5b. Admin "Sync Now" pushing rows to Bokun = v2 CREATE with startTimes
The admin panel's boat-sync POSTs `/restapi/v2.0/experience` per unsynced row; any row lacking a schedule fails with `400 {"error":"START_TIMES is mandatory for CREATE"}` — and when the failures are all identical for suspiciously generic rows (Unsplash-photo 'Desert Rose' etc.), the rows are leftover seeded/sample data, not a payload bug. Query the DB for rows with `bokun_activity_id IS NULL` and no live referencing tours before touching the sync code; purging the fake rows silences every error at once. v2 CREATE requires full `startTimes[]` + `availabilityRules[]` (see §1 shape) — admin-created boats cannot push without them even with correct code.

## 6. Reference scripts (Boating machine)
- `~/boating-experience-improvements/scripts/bokun_v2.py` — python HMAC-SHA1 client (keys from Secret Manager at runtime) + `upload_photo()` multipart helper.
- `~/boating-experience-improvements/scripts/create_birthday_combo.py` — the exact verified combo payload (experience 1282749, 4 slots × 2 boats).
- Field dumps: `~/boating-experience-improvements/findings/` (raw-v2-*-ALL.json, rest-v1.yaml, rest-v2.yaml).

## 7. API exploration method that worked
Downloaded the published OpenAPI spec (api-docs.bokun.dev `rest-v2.yaml` / `rest-v1.yaml`) and enumerated paths×methods with python-yaml BEFORE touching the account: one step revealed the no-PUT / no-publish reality. For any vendor-API capability question: get the spec, enumerate methods, test read-only live, only then write.

## 8. Listing-card traps with non-Latin titles & null prices (verified 2026-09-07, user-reported)
- **Slugify-to-empty self-link**: `title.toLowerCase().replace(/[^a-z0-9]+/g,'-')` returns `""` for Arabic titles (every char stripped), so a card built as `title ? slugify(title) : fallback` still gets `""` from a truthy title and links at the LISTING ITSELF — clicking "View details" reloads the same page. Only ASCII-titled items looked fine, so the bug reads as "some boats broken". Fix pattern: `slugify(title) || <prefix>-<id>` (detail pages that match `tour-<id>`/`boat-<id>` against the activity id make the fallback land). Audit rule: every `[^a-z0-9]` slugify call site in user-facing link builders needs the empty-string fallback, not just the missing-title branch.
- **Null price renders "from 0 SAR"**: Bokun search items can omit `price` entirely (activity 1251353 live: `price: None`, detail `pricing: []`) — a mapper's `price || 0` then advertises a zero price on a public card. 0 is never a real boat/tour price: hide the price block when `price <= 0`, and flag the missing price for ops to set in the Bokun dashboard. Verified with a direct HMAC call: `GET /activity.json/{id}?lang=EN&currency=SAR` → `pricing: []`. The null-price and dead-calendar symptoms on the SAME activity share one root cause: a dashboard edit wiped its schedule + pricing — check `lastModified`/`lastPublished` in the detail dump (see §9).

## 10. Search projection ≠ full product: the detail-page data gap (verified 2026-09-21, user-reported)
`POST /activity.json/search` rows are a LISTING projection: for live activity 1292366 the search row returned `description: ""` (only `excerpt` = the one-line summary) while `GET /activity.json/{id}` returns the FULL rich-editor HTML (~650 chars), `cancellationPolicy`, per-language bodies — BUT has NO `price` and NO `maxCapacity` (those live only on the search row). Neither payload can replace the other. Shipped fix (Boating main 0cf6c24): `lib/bokun-detail.ts` fetches BOTH in `Promise.all` and merges (detail wins where non-empty, search fills holes; empty string/[]/null count as "no answer", 0 is data), single-flight 60s cache in `getActivity` mirrors `searchActivities`. The old code comment "getActivity endpoint returns 404" was STALE — the endpoint works now on this account; treat endpoint-state comments as dated and re-probe before obeying them. Symptom to remember: "page shows only a short description" = payload gap, not a render bug.

## 13. Busy-day time picker = chip grid, not a wall of cards (verified 2026-09-21, owner-reported on Lolo)
Lolo (1284355) publishes 15 start times per day across two rates (Khor round trip / Bayadhah Island Trip). The old TimeSlotPicker rendered one rich card per rate-slot → ~1300px list. Shipped (main e73419a): >4 slots for the chosen date renders a 4-6-col chip grid (time + route dot; sold-out struck/disabled), and the chosen slot's full detail (rate title, from-price, seats, duration) shows ONCE in a summary strip below. ≤4 slots keeps the rich cards. Bokun availability probe shape: GET /activity.json/{id}/availabilities?start=&end= returns entries per startTime each with rates[] — rate slots per day = buttons rendered. Gotcha: the Chrome-headless CLI screenshot hung again on this box; puppeteer-core at ~/node_modules works. jsdom/bidi gotcha: a test-mock that invents its own price string looked like a bidi bug in the screenshot — check the REAL messages/ar.json string before chasing bidi.

## 12. Product hero design system (owner-approved 2026-09-21, main 238c5cf)
All Bokun detail pages share `components/product/ProductHero.tsx`: desktop ≥lg = full-bleed cover + scrim + glass fact rail (price/duration/capacity/rating) + gold CTA anchoring `#book`; mobile = mosaic (key photo + 2 deduped thumbs, `#gallery` pill) + navy title card overlapping its bottom edge. Owner chose "B desktop / C mobile" from `sketches/hero-redesign/` (gitignored). Invariants: hero is the SINGLE source of quick facts (the standalone info-card grid was deleted); exactly one h1 per page (sr-only; hero title is text); fact values `dir="auto"` — `dir="ltr"` flipped Arabic («ضيوف 10»); rating cell hides at 0 reviews (Bokun returns reviewRating=0 for this account's activities even where its widget shows 5.0★); `PageBreadcrumb compact` prop for pages with their own hero title (kills the duplicated circle title band). Future activities inherit the design automatically — data-driven.

## 11. Gallery tiles that do nothing (verified 2026-09-21, user-reported)
Boating detail pages rendered gallery as plain `<img>` with `hover:scale-105` — the hover zoom telegraphed interactivity but there was NO click handler; customer read it as broken. Shipped `components/ui/GalleryLightbox.tsx`: tiles are real `<button>`s, `<dialog>` via portal (not `showModal()` — attribute-open keeps jsdom testable; Escape handled manually then), arrows/backdrop/scroll-lock, RTL flips next/prev, enlarged source = `bokunFitVariant(tile, 1600, 1200)` so opening reuses the same CDN sizing rule. Also: gallery rendered only when `length > 1` — a single-photo product showed NOTHING; gate is `> 0` now. jsdom gotcha: `within(dialog).getByAltText` (not getByAlt); `jest.mock('next-intl')` must cover every hook the component uses (`useLocale`). (diagnostic recipe, verified 2026-09-07, user-reported)
Symptom: booking calendar on a detail page disables EVERY day in every month. The site widget is usually correct — it grays exactly what Bokun reports. Diagnose by calling Bokun directly instead of trusting the UI:
- `GET /activity.json/{id}/availabilities?start=YYYY-MM-DD&end=YYYY-MM-DD` (HMAC; keep the window ≤60 days — a 300d window returns HTTP 400): broken activity → `[]` (0 slots); healthy activities on the same account → ~120.
- Cross-check `GET /activity.json/{id}?lang=EN&currency=SAR` on healthy vs broken dumps: set-diff the keys and print differing values. `lastModified`/`lastPublished` often reveal a dashboard edit that wiped the schedule — and if search `price` is null too, the same edit killed pricing (corroborates the "from 0 SAR" card symptom in §8).
- NOT fixable via API with typical keys: v1 is read-only; v2 write endpoints (`/restapi/v2.0/experience/{id}...`) 404 for experiences created in the dashboard rather than via the v2 API — even with valid HMAC. Fix = app.bokun.io dashboard: re-add the price category + availability schedule/slots, save AND publish; the site listing self-refreshes within the 60s cache TTL, no deploy.
- Transient Bokun HTTP 400 "Bad Request" on signed GETs happens — a 1.2s-backoff retry loop of 4 passes; don't conclude auth breakage from one 400.
- Fast browser-side proof the widget is fine: render a healthy activity's page and count enabled day buttons vs the broken one (Meveda 23/30 enabled vs Lolo 0/30, identical component).
