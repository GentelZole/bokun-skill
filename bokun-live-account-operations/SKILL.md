---
name: bokun-live-account-operations
description: "Mutate a live Bókun account via API."
version: 1.0.0
author: Hermes Agent
tags: [bokun, api, saas, mutation, boating]
metadata:
  hermes:
    tags: [bokun, api, saas, mutation, boating]
    related_skills: [boating-bokun-integration, bokun-v2-api-integration]
---

# Bókun Live Account Operations

## When to Use
Any WRITE to a production Bókun account (rates, pricing, departures, extras, availability) — especially one holding bookings or combo links; also webhook registration and read-only ground-truth probes. Everything here is a 400/409-earned rule. Payload-building for new experiences lives in `bokun-v2-api-integration`; frontend/widget integration pitfalls live in `boating-bokun-integration`.

## Gate checklist (before any write dispatch)
- Operator repo first: `GentelZole/boating-bokun-operator` (private) carries the canonical signer (`scripts/bokun_client.py`), `snapshot.py`, `verify_live.py`, `site_parity.py`, the full price grid (`config/grid.json`), rate/extra title contracts, playbooks (add-new-boat, recipes, webhook-registration) and pre-restructure `snapshots/`. Clone and use its scripts instead of hand-rolling signers; keep it updated when the account shape changes.
- Owner "go" on the mutation recorded verbatim — live SaaS account changes are gated nodes, never auto-run.
- Snapshot committed BEFORE the first write (see Order of operations). No snapshot, no write.
- One writer: exactly one agent touches the account at a time; parallel lanes code against a frozen contract instead.
- Per-entity protection list in the brief: booked dates/departures, combo children, rate ids referenced by old bookings, exact price grid per activity (the worker never derives prices itself).

## Credentials + signer
- `gcloud secrets versions access latest --secret=BOKUN_ACCESS_KEY --secret=BOKUN_SECRET_KEY --project=boating-499409` — secret names are UPPERCASE on this account; lowercase variants 404. Never print values.
- HMAC-SHA1: string = `date+accessKey+METHOD+path` where path INCLUDES the query string (`?start=&end=`) — signing path-only returns "Invalid signature". Date `YYYY-MM-DD HH:MM:SS` UTC. Working stdlib signer probe pattern: `/home/moe/.hermes/cache/scratch/align/probe*.py`.
- Endpoint status (corrects stale notes elsewhere): v1 `GET /activity.json/{id}` WORKS and returns rates/startTimes/bookableExtras (an old "permanently broken" warning in boating-bokun-integration is outdated — search payload omits these fields, so prefer the per-id GET for detail). v2 `GET /experience/{id}` is 404 but `/experience/{id}/components?componentType=…` works. `GET /booking.json/search` is 404 — bookings cannot be listed; the protection guard is availability `bookedParticipants`.

## Order of operations (per activity, finish + verify before the next)
1. Snapshot both shapes to a dated dir OUTSIDE the repo: v1 `GET /activity.json/{id}` + v2 `GET /restapi/v2.0/experience/{id}/components?componentType=RATES&componentType=PRICING&componentType=START_TIMES&componentType=EXTRAS`. Verify files non-empty. Intermediate component PUTs silently clear sibling fields (a RATES PUT wiped rate `description`s — restored from snapshot), so the snapshot is the only rollback.
2. RATES + PRICING together in one `PUT /components`; then START_TIMES; then EXTRAS (DTO quirks in boating-bokun-integration §37 — tieredPricingEnabled conditional, price-rule ids not reusable, amount as STRING, omitted rules are DELETED).
3. Verify three ways: v1 GET (rate titles/ids, startTime duration grid); `GET /activity.json/{id}/availabilities?start=D&end=D` (pricesByRate carries the grid amount for EVERY rate — a rate in RATES but missing from PRICING renders priced-but-unreservable); site parity `/api/bokun/availability` (~2-min cache — wait before probing). Site parity gotcha: the availability envelope carries rate titles/pricing model in the `meta[]` array, NOT per-slot — a checker that reads `slots[].rateTitle` false-alarms on every contract rename. A shared browser session can also serve a stale bundle/service-worker cache after a deploy (old asset filename + old computed styles read as "deploy failed"); unregister service workers and navigate with a cache-buster query before concluding.

## Write rules that protect live state
- **Rename rates, never delete+recreate** — bookings reference `rateId`; recreated ids orphan them and break the findSlot legacy shim. Create new ids only for genuinely new durations.
- **Combo children can't be deleted**: a `startTime` that is a combo child (event combo onto a boat activity) refuses deletion ("used in a combo product"). Fix: REUSE that startTime id in the new grid (change its hour/duration) and delete only free departures; re-verify all combo mappings after.
- Combo product's components PUT rejects a body-level `id` ("ID not applicable for combo products") — omit it.
- Rate DTO rejects `maxPerBooking: 0` ("less than 1") — legacy activities carry 0; set ≥1 (fleet capacity, e.g. 15).
- **Availability auto-materialises**: with `availabilityRules[].allStartTimes: true`, rebuilding START_TIMES regenerates entries across the whole rule window (60 days appeared with zero manual POSTs). Don't hand-write thousands of entries; fix rule + startTimes, verify count = dates × departures.
- Never touch entries with `bookedParticipants > 0`; never delete a rate or departure with bookings without owner sign-off.
- Dates: business "today" = Asia/Riyadh; wire dates stay UTC-midnight ms-epoch — never +03 either place.

## Titles are an API surface
When a sibling code lane parses Bokun titles (trip/duration chips, event boat detection), the title convention — including codepoints — is a frozen contract shared verbatim in both briefs. Current Boating contract: rate `Khor · 4h` / `Bayadhah · 10h` (U+00B7), event boat extra `Boat — {exact boat title}` (U+2014); departure `startTimes[].duration` is the duration truth, title is identity — disagreement is a data bug. Fix the convention BEFORE creating extras/rates; renaming later breaks parsers silently.

## Webhook registration & topics
Registration is dashboard-only (Settings → Webhooks → endpoint URL + shared secret → `bokun-webhook-secret`); there is NO API to register, and the receiver logs nothing until a human configures it. Full topic set (bokun.dev): `bookings/create` (confirmed-state bookings; body/header carry only base64 `bookingId` — hydrate via booking-detail/GraphQL), `bookings/update`, `bookings/cancel` (optional `x-bokun-experiencebooking-id`), `bookings/payment`, `bookings/refund`, `experiences/create`, `experiences/update` (body `step`: PHOTOS, RATES, CALENDAR, PRICING_CATEGORIES, START_TIMES…), `experiences/availability_update` (`dateFrom/dateTo` + `updateReasons`), `apps/uninstall`. For notification fan-out subscribe the five booking topics + availability_update.

## Cross-skill corrections
- boating-bokun-integration §2/§29 claim `GET /activity.json/{id}` is permanently broken — false; re-confirmed working across all 7 account activities. Its webhook list ("2 topics") is incomplete — full set above.
- GCP secret names on this project are uppercase (`BOKUN_ACCESS_KEY`/`BOKUN_SECRET_KEY`); the `--secret=bokun-access-key` lowercase examples elsewhere fail.
