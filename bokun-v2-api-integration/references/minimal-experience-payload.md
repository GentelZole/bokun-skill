# Minimal Working Experience Creation Payload

This is the minimal payload structure that passes Bokun v2 API validation for creating experiences.

## Required Fields (Discovered Through Trial & Error)

```typescript
const experienceData = {
  // Basic info
  title: 'Experience Title',
  shortDescription: 'Short description (max 200 chars)',
  description: 'Full description',
  type: 'DAY_TOUR_OR_ACTIVITY',
  
  // Duration - ALL fields required
  duration: {
    weeks: 0,
    days: 0,
    hours: 3,
    minutes: 0
  },
  
  // Location
  location: {
    name: 'Jeddah Marina',
    city: 'Jeddah',
    countryCode: 'SA'
  },
  
  // Booking settings - exact enum values required
  bookingType: 'DATE_AND_TIME',  // Valid: PASS, DATE, DATE_AND_TIME
  capacityType: 'LIMITED',       // Valid: LIMITED, ON_REQUEST, FREE_SALE
  timeZone: 'Asia/Riyadh',
  difficultyLevel: 'EASY',       // Valid: EASY, MODERATE, DIFFICULT
  
  // Box settings - ONLY isBox field, no minPaxPerBooking/maxPaxPerBooking
  boxSettings: {
    isBox: false
  },
  
  // Ticket - must include all three fields
  ticket: {
    ticketMsg: 'Present your ticket at the marina.',
    ticketPerPerson: true,
    barcodeFormat: 'QR_CODE'
  },
  
  // Private experience - boolean, NOT object
  privateExperience: true,
  
  // Customized bookings - boolean
  allowCustomizedBookings: true,
  
  // Cutoff - type field is MANDATORY
  cutoff: {
    type: 'RELATIVE_TO_START_TIME',
    days: 1,
    hours: 0,
    minutes: 0
  },
  
  // Meeting type - object with type field, NOT string
  meetingType: {
    type: 'MEET_AT_LOCATION',
    dropoffService: false,
    meetingPointAddresses: [
      {
        title: 'Main Meeting Point',
        address: {
          addressLine1: 'Jeddah Marina',
          city: 'Jeddah',
          countryCode: 'SA'
        }
      }
    ]
  },
  
  // Availability rules
  availabilityRules: {
    enabled: true,
    rules: []
  },
  
  // Pricing categories - object with defaultId and ids, NOT array
  pricingCategories: {
    defaultId: 1210916,  // Get from GET /restapi/v2.0/pricing/categories
    ids: [1210916, 1210917]
  },
  
  // Rates
  rates: {
    rates: [
      {
        externalId: 'standard',
        title: 'Standard Rate',
        pickupSelectionType: 'UNAVAILABLE',
        dropoffSelectionType: 'UNAVAILABLE',
        cancellationPolicyId: 265592,  // Get from GET /restapi/v2.0/cancellation/policies
        pricedPerPerson: true,
        allPricingCategories: true,
        allStartTimes: true,
        tieredPricingEnabled: false
      }
    ],
    defaultRate: {
      externalId: 'standard'
    }
  },
  
  // Pricing
  pricing: {
    experiencePriceRules: [
      {
        rate: { externalId: 'standard' },
        pricingCategoryId: 1210916,
        amount: 250,
        currency: 'SAR',
        priceCatalogId: 163910  // Get from GET /restapi/v2.0/price/catalogs
      }
    ],
    extraPriceRules: [],
    pickupPriceRules: [],
    dropoffPriceRules: [],
    priceCatalogCurrencies: [
      {
        priceCatalogId: 163910,
        currencies: ['SAR'],
        defaultCurrency: 'SAR'
      }
    ]
  },
  
  // Photos - empty array for initial creation
  photos: []
};
```

## Prerequisites (Fetch IDs Before Creating)

```typescript
// Fetch prerequisite IDs from Bokun API
const [cancellationPolicies, pricingCategories, priceCatalogs] = await Promise.all([
  makeRequest('GET', '/restapi/v2.0/cancellation/policies?pageNo=0&pageSize=10'),
  makeRequest('GET', '/restapi/v2.0/pricing/categories?pageNo=0&pageSize=10'),
  makeRequest('GET', '/restapi/v2.0/price/catalogs?pageNo=0&pageSize=10')
]);

const cancellationPolicyId = cancellationPolicies.items[0].id;
const pricingCategoryId = pricingCategories.items[0].id;
const priceCatalogId = priceCatalogs.items[0].id;
```

## Authentication (HMAC-SHA1)

```typescript
const crypto = require('crypto');

function getDateUtc() {
  const now = new Date();
  return now.getUTCFullYear() + '-' + 
    String(now.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(now.getUTCDate()).padStart(2, '0') + ' ' +
    String(now.getUTCHours()).padStart(2, '0') + ':' +
    String(now.getUTCMinutes()).padStart(2, '0') + ':' +
    String(now.getUTCSeconds()).padStart(2, '0');
}

const date = getDateUtc();
const path = '/restapi/v2.0/experience';
const method = 'POST';
const stringToSign = date + ACCESS_KEY + method + path;
const signature = crypto.createHmac('sha1', SECRET_KEY)
  .update(stringToSign, 'utf-8')
  .digest('base64');

fetch('https://api.bokun.io' + path, {
  method: 'POST',
  headers: {
    'X-Bokun-Date': date,
    'X-Bokun-AccessKey': ACCESS_KEY,
    'X-Bokun-Signature': signature,
    'Content-Type': 'application/json;charset=UTF-8',
    'Accept': 'application/json'
  },
  body: JSON.stringify(experienceData)
});
```

## Common Mistakes (From This Session)

1. **Wrong auth**: OpenAPI spec says simple headers, but actual API needs HMAC-SHA1
2. **boxSettings**: Don't include `minPaxPerBooking`/`maxPaxPerBooking` - they don't exist
3. **combo**: Must be object `{ isCombo: false }`, not boolean `false`
4. **ticket**: Must include `ticketMsg`, `ticketPerPerson`, `barcodeFormat` - no `ticketType` field
5. **privateExperience**: Must be boolean `true`, not object `{ isPrivate: true }`
6. **cutoff**: Must include `type` field - omitting it fails
7. **meetingType**: Must be object with `type` field, not string `'MEET_AT_LOCATION'`
8. **pricingCategories**: Must be object `{ defaultId, ids }`, not array
9. **bookingType enum**: Valid values are `PASS`, `DATE`, `DATE_AND_TIME` - not `ON_REQUEST`
10. **capacityType enum**: Valid values are `LIMITED`, `ON_REQUEST`, `FREE_SALE` - not `MAX_PERSONS`
11. **duration**: Must include all fields including `minutes: 0`

## Discovery Process

This payload was discovered through iterative API testing, fixing one validation error at a time:
1. Started with "Could not process this request" → Fixed auth to HMAC-SHA1
2. "BOX_SETTINGS is mandatory" → Added `boxSettings: { isBox: false }`
3. "Unrecognized field minPaxPerBooking" → Removed invalid fields
4. "TICKET is mandatory" → Added ticket object with correct fields
5. "PRIVATE_EXPERIENCE is mandatory" → Added as boolean
6. "ALLOW_CUSTOMIZED_BOOKINGS is mandatory" → Added as boolean
7. "CUTOFF is mandatory" → Added cutoff with type field
8. "duration::minutes absent" → Added minutes field
9. And so on...

Each error message guided the next iteration until all required fields were correctly structured.
