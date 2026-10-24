# Bokun API Field Mapping Reference

This document maps Bokun's raw API response fields to the clean SearchResult shape used by the frontend.

## Bokun Raw Item Structure

When you call `POST /activity.json/search`, Bokun returns items with this structure:

```typescript
interface BokunRawItem {
  // Identifiers
  id?: number | string;              // Activity ID (may be string or number)
  productGroupId?: number;           // Group ID (usually 0)
  
  // Content
  title?: string;                    // Activity title
  summary?: string;                  // Long description (HTML allowed)
  excerpt?: string;                  // Short description
  
  // Pricing
  price?: number;                    // Direct number (NOT {amount, currency})
  paymentCurrencies?: string[];      // Available currencies
  
  // Images
  keyPhoto?: {                       // Primary image
    id?: number;
    originalUrl?: string;            // Full-size URL
    description?: string;
    alternateText?: string;
    height?: string;
    width?: string;
  };
  images?: Array<{                   // Additional images
    url?: string;
    alt?: string;
  }>;
  
  // Capacity & Duration
  maxCapacity?: number;              // Maximum guests
  durationText?: string;             // Pre-formatted (e.g., "1 hour", "30 minutes")
  
  // Location
  location?: string;                 // May be empty
  city?: string;                     // City name
  country?: string;                  // Country code or name
  address?: string;                  // Full address
  coordinates?: {                    // GPS coordinates
    latitude?: number;
    longitude?: number;
  };
  
  // Categories & Tags
  activityCategories?: string[];     // e.g., ["tours", "boats"]
  tags?: Array<{ name?: string }>;   // Custom tags
  keywords?: string[];               // SEO keywords
  
  // Metadata
  vendor?: {                         // Supplier info
    id?: number;
    title?: string;
  };
  difficultyLevel?: string;          // "EASY", "MODERATE", "DIFFICULT"
  languages?: string[];              // Available languages
  reviewRating?: number;             // 0-5
  reviewCount?: number;              // Number of reviews
  
  // Flags
  box?: boolean;                     // Is this a package?
  inventoryLocal?: boolean;          // Local inventory management
  showInMarketplaceSearch?: boolean; // Visibility in Bokun marketplace
}
```

## Mapping to SearchResult

```typescript
interface SearchResult {
  id: number;                        // From item.id
  title: string;                     // From item.title
  description: string;               // From item.summary || item.excerpt
  price: {                           // Wrap item.price
    amount: number;
    currency: string;
  };
  images: Array<{ url: string }>;    // From keyPhoto + images
  maxCapacity: number;               // From item.maxCapacity
  location: string;                  // From item.location || city || country
  duration: string;                  // From item.durationText
  category: string;                  // From item.activityCategories[0]
  slug: string;                      // Generated from title
  available: boolean;                // Always true (filter unavailable separately)
}
```

## Mapping Function

```typescript
const mapBokunItem = (item: BokunRawItem, idx: number): SearchResult => {
  // Build images array - keyPhoto first, then additional images
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

## Key Differences to Remember

1. **Price is a number, not an object**: `item.price = 3000` (not `{amount: 3000, currency: 'SAR'}`)
2. **Description fields**: Use `summary` (long) or `excerpt` (short), not `description`
3. **Images**: `keyPhoto.originalUrl` is the primary image, `images[]` are additional
4. **Location fallback**: Check `location`, then `city`, then `country`, then default to 'Jeddah'
5. **Duration is pre-formatted**: `durationText = "1 hour"` (no need to calculate)
6. **ID type varies**: May be string or number, normalize to number
7. **Categories array**: Usually has one item, use `[0]` as the primary category

## Example: Raw vs Mapped

**Raw Bokun Item:**
```json
{
  "id": 1251403,
  "title": "Jeddah Lion",
  "summary": "Jeddah Lion is the epitome of refined elegance...",
  "price": 3000,
  "keyPhoto": {
    "originalUrl": "https://bokun.s3.amazonaws.com/f80b53b8-d3ab-41d6-b94f-64ec56b668c0.jpeg"
  },
  "durationText": "1 hour",
  "activityCategories": [],
  "city": "Jeddah"
}
```

**Mapped SearchResult:**
```json
{
  "id": 1251403,
  "title": "Jeddah Lion",
  "description": "Jeddah Lion is the epitome of refined elegance...",
  "price": { "amount": 3000, "currency": "SAR" },
  "images": [
    { "url": "https://bokun.s3.amazonaws.com/f80b53b8-d3ab-41d6-b94f-64ec56b668c0.jpeg" }
  ],
  "maxCapacity": 0,
  "location": "Jeddah",
  "duration": "1 hour",
  "category": "tours",
  "slug": "jeddah-lion",
  "available": true
}
```

## Common Pitfalls

1. **Don't assume `location` is populated**: Fall back to `city` or `country`
2. **Don't forget to normalize ID type**: Use `parseInt` if it's a string
3. **Don't skip `keyPhoto`**: It's the primary image, should be first in array
4. **Don't hardcode currency**: Default to 'SAR' but could be configurable
5. **Don't forget to handle missing fields**: Use `||` for fallbacks
