# Bókun API Client

## Overview

Complete TypeScript client for Bókun booking platform REST API with HMAC-SHA1 authentication.

## Authentication

Bókun uses HMAC-SHA1 signature authentication:

```typescript
function generateSignature(date: string, method: string, path: string): string {
  const stringToSign = `${date}${ACCESS_KEY}${method}${path}`;
  const hmac = crypto.createHmac("sha1", SECRET_KEY);
  hmac.update(stringToSign, "utf-8");
  return hmac.digest("base64");
}
```

**Required Headers:**
- `X-Bokun-Date`: UTC timestamp (format: `YYYY-MM-DD HH:mm:ss`)
- `X-Bokun-AccessKey`: Your access key
- `X-Bokun-Signature`: HMAC-SHA1 signature (base64 encoded)
- `Content-Type`: `application/json;charset=UTF-8`
- `Accept`: `application/json`

## API Endpoints (Verified Working)

### Search Endpoints (POST)

```typescript
// Search activities/tours
POST /activity.json/search?lang=EN&currency=SAR
Body: { paging: { page: 1, perPage: 20 } }

// Search products/boats
POST /product.json/search?lang=EN&currency=SAR
Body: { paging: { page: 1, perPage: 20 } }

// Search bookings
POST /booking.json/search
Body: { paging: { page: 1, perPage: 20 } }
```

### CRUD Endpoints

```typescript
// Get single item
GET /activity/{id}.json?lang=EN&currency=SAR
GET /product/{id}.json?lang=EN&currency=SAR
GET /booking/{id}.json

// Create
POST /booking.json
Body: { /* booking data */ }

// Cancel
POST /booking/{id}/cancel.json
Body: { reason: "string" }

// Check availability
POST /product/{id}/availability.json
Body: { dateStart: "YYYY-MM-DD", dateEnd: "YYYY-MM-DD", numPersons: 1 }
```

## Client Implementation

```typescript
import * as crypto from "crypto";

const BOKUN_BASE_URL = "https://api.bokun.io";
const BOKUN_ACCESS_KEY = process.env.BOKUN_ACCESS_KEY;
const BOKUN_SECRET_KEY = process.env.BOKUN_SECRET_KEY;

async function bokunRequest<T>(method: string, path: string, body?: any): Promise<T> {
  const date = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const signature = generateSignature(date, method, path);

  const headers = {
    "X-Bokun-Date": date,
    "X-Bokun-AccessKey": BOKUN_ACCESS_KEY,
    "X-Bokun-Signature": signature,
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json",
  };

  const url = `${BOKUN_BASE_URL}${path}`;
  const options: RequestInit = { method, headers };
  
  if (body && (method === "POST" || method === "PUT")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  
  if (!response.ok) {
    throw new Error(`Bókun API Error ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}
```

## Common Patterns

### Search with Pagination

```typescript
export async function searchActivities(
  lang: string = "EN",
  currency: string = "SAR",
  page: number = 1,
  perPage: number = 20
) {
  const path = `/activity.json/search?lang=${lang}&currency=${currency}`;
  return bokunRequest("POST", path, {
    paging: { page, perPage }
  });
}
```

### Get Single Resource

```typescript
export async function getProduct(productId: number, lang: string = "EN") {
  const path = `/product/${productId}.json?lang=${lang}&currency=SAR`;
  return bokunRequest("GET", path);
}
```

### Create Booking

```typescript
export async function createBooking(bookingData: {
  productId: number;
  date: string;
  numPersons: number;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
}) {
  return bokunRequest("POST", "/booking.json", bookingData);
}
```

## Error Handling

Common error codes:
- `401`: Invalid signature or expired credentials
- `404`: Resource not found
- `400`: Invalid request body
- `429`: Rate limit exceeded (400 requests/minute per vendor)

**Retry strategy:**
```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.message.includes('429') && i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

## Environment Variables

```bash
BOKUN_ACCESS_KEY=e40ddc96738b42f19c8d5ef13cc13117
BOKUN_SECRET_KEY=***
```

## Testing

```bash
# Test authentication
curl -X POST "https://api.bokun.io/activity.json/search?lang=EN&currency=SAR" \
  -H "X-Bokun-Date: $(date -u '+%Y-%m-%d %H:%M:%S')" \
  -H "X-Bokun-AccessKey: $BOKUN_ACCESS_KEY" \
  -H "X-Bokun-Signature: $(echo -n "$(date -u '+%Y-%m-%d %H:%M:%S')$BOKUN_ACCESS_KEY POST/activity.json/search?lang=EN&currency=SAR" | openssl dgst -sha1 -hmac "$BOKUN_SECRET_KEY" -binary | base64)" \
  -H "Content-Type: application/json;charset=UTF-8" \
  -d '{"paging":{"page":1,"perPage":5}}'
```

## Notes

- All timestamps must be UTC
- Signature includes the full path with query parameters
- Rate limit: 400 requests/minute per vendor (booking/confirmation calls excluded)
- Currency codes: SAR (Saudi Riyal), USD, EUR, etc.
- Language codes: EN, AR, etc.

## Reference

- Official docs: https://docs.bokun.io
- API docs: https://api-docs.bokun.dev/rest-v1
