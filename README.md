# Bokun Agent Skill Pack

Bókun API knowledge packaged as agent skills — ready to hand to a coding agent.

**Contents (6 skills, 15 files):**

| Folder | What it covers |
|---|---|
| `bokun/` | Bókun platform overview and integration entry point |
| `bokun-api-integration/` | Core REST API integration: auth, search, photos |
| `bokun-v2-api-integration/` | v2 experience creation: every required field, DTO pitfalls, validated payloads |
| `bokun-integration-playbook/` | Proved integration recipes: combo creation, facets, image performance |
| `bokun-live-account-operations/` | Mutating a live Bókun account via the API safely |
| `boating-bokun-integration/` | End-to-end build notes from a production integration (field mapping, widget, testing) |
| `bokun-api-client-reference.md` | Reference client implementation |

## How an agent should use this

Each folder is a standard agent skill: a `SKILL.md` with YAML frontmatter, plus `references/` and `templates/` where relevant. Drop the folders into your agent's skills directory (for example `~/.hermes/skills/third-party-integrations/`), or point the agent at the repo and let it read `SKILL.md` before touching Bókun.

## First: get your API keys

**[GET-BOKUN-KEYS.md](GET-BOKUN-KEYS.md)** — step-by-step: create a booking channel, then
`Settings → Connections → API Keys` (https://extranet.bokun.io/app/settings/connections/api) → **Add**,
and copy the **Access Key** + **Secret Key** (shown once). A ready-to-paste Arabic message for the agent
to send its owner is included there.

Keys go into the environment, never into Git:

```bash
BOKUN_ACCESS_KEY=...
BOKUN_SECRET_KEY=...
```

## Verified facts you can trust

- Both v1 and v2 APIs use **HMAC-SHA1**. The string to sign is `date + accessKey + method + requestPath` (path only — the body is not included), base64-encoded into `X-Bokun-Signature`.
- Production host: `https://api.bokun.io`. The OpenAPI spec's "simple access-key/secret-key headers" note is wrong.
- `POST /booking.json/booking-search` returns rows under **`items`** — code that reads only `results` gets `totalHits` with an empty list.
- Booking money lives in `customerInvoice.totalAsMoney` / `totalDueAsMoney`; booking detail lives at `GET /booking.json/booking/{id}` (the v2 path 404s).
- `GET /restapi/v2.0/booking/{id}/audit-records` returns Bókun's own audit trail; `GET /restapi/v2.0/booking/{id}/payments` and `/invoices?invoiceType=SELLER` carry payments and commission line items.
- There are **no** commission/payout/settlement endpoints, and no extranet user-management API. Those must be built on your side.

## Note

`boating-bokun-integration/` contains operational notes from a live production deployment. Infrastructure hosts are redacted; no credentials are present anywhere in this repo.