# Bokun v2 API - Working Experience Creation Pattern

This document contains the complete, tested pattern for creating Bokun experiences using the v2 API.

## Complete Experience Payload

```typescript
{
  // Basic fields (required)
  title: string,
  shortDescription: string, // max 200 chars
  description: string,
  type: 'DAY_TOUR_OR_ACTIVITY',
  
  // Duration (required)
  duration: {
    weeks: 0,
    days: 0,
    hours: 4,
    minutes: 0,
  },
  
  // Location (required)
  location: {
    name: string,
    city: string,
    countryCode: 'SA', // ISO 3166-1 alpha-2
  },
  
  // Booking settings (required)
  bookingType: 'DATE_AND_TIME',
  capacityType: 'FREE_SALE',
  timeZone: 'Asia/Riyadh',
  difficultyLevel: 'EASY', // or 'MODERATE', 'DIFFICULT'
  
  // Box & Combo settings (required)
  boxSettings: {
    isBox: false,
  },
  combo: {
    isCombo: false,
  },
  
  // Ticket settings (required)
  ticket: {
    ticketPerPerson: true,
  },
  
  // Privacy settings (required)
  privateExperience: false,
  allowCustomizedBookings: false,
  
  // Cutoff settings (required)
  cutoff: {
    type: 'RELATIVE_TO_START_TIME',
    weeks: 0,
    days: 0,
    hours: 2,
    minutes: 0,
  },
  
  // Meeting type (required)
  meetingType: {
    type: 'MEET_ON_LOCATION',
    dropoffService: false,
    meetingPointAddresses: [
      {
        title: string,
        address: {
          addressLine1: string,
          city: string,
          countryCode: 'SA',
        },
      },
    ],
  },
  
  // Availability rules (required)
  availabilityRules: [
    {
      recurrenceRule: {
        startDate: 'YYYY-MM-DD',
        endDate: 'YYYY-MM-DD',
      },
      maxCapacity: number,
      allStartTimes: true,
    },
  ],
  
  // Pricing categories (required)
  pricingCategories: {
    defaultId: number, // from getPricingCategories()
    ids: [number],
  },
  
  // Rates (required)
  rates: {
    rates: [
      {
        externalId: 'standard',
        title: 'Standard Rate',
        pickupSelectionType: 'UNAVAILABLE', // NOT 'DISABLED'
        dropoffSelectionType: 'UNAVAILABLE', // NOT 'DISABLED'
        cancellationPolicyId: number, // from getCancellationPolicies()
        pricedPerPerson: true,
        allPricingCategories: true,
        allStartTimes: true,
        tieredPricingEnabled: false,
      },
    ],
    defaultRate: {
      externalId: 'standard',
    },
  },
  
  // Pricing (required)
  pricing: {
    experiencePriceRules: [
      {
        rate: { externalId: 'standard' },
        pricingCategoryId: number, // from getPricingCategories()
        amount: number,
        currency: 'SAR',
        priceCatalogId: number, // from getPriceCatalogs()
      },
    ],
    extraPriceRules: [],
    pickupPriceRules: [],
    dropoffPriceRules: [],
    priceCatalogCurrencies: [
      {
        priceCatalogId: number,
        currencies: ['SAR'],
        defaultCurrency: 'SAR',
      },
    ],
  },
  
  // Photos (required - empty for creation)
  photos: [],
}
```

## Working Implementation

```typescript
import { 
  createExperience, 
  getCancellationPolicies, 
  getPricingCategories, 
  getPriceCatalogs 
} from './bokun-api';

export async function mapBoatToBokunExperience(boat: {
  name_en: string;
  description_en?: string;
  price_amount: number;
  price_currency: string;
  capacity: number;
  marina?: string;
}): Promise<Record<string, unknown>> {
  // Step 1: Fetch prerequisites
  const [cancellationPolicies, pricingCategories, priceCatalogs] = await Promise.all([
    getCancellationPolicies(0, 10),
    getPricingCategories(0, 10),
    getPriceCatalogs(0, 10),
  ]);

  const cancellationPolicyId = (cancellationPolicies as any).data?.[0]?.id;
  const pricingCategoryId = (pricingCategories as any).data?.[0]?.id;
  const priceCatalogId = (priceCatalogs as any).data?.[0]?.id;

  if (!cancellationPolicyId || !pricingCategoryId || !priceCatalogId) {
    throw new Error('Failed to fetch Bokun prerequisites');
  }

  // Step 2: Build experience payload
  return {
    title: boat.name_en,
    shortDescription: (boat.description_en || '').substring(0, 200),
    description: boat.description_en || '',
    type: 'DAY_TOUR_OR_ACTIVITY',
    
    duration: {
      weeks: 0,
      days: 0,
      hours: 4,
      minutes: 0,
    },
    
    location: {
      name: boat.marina || 'Jeddah Marina',
      city: 'Jeddah',
      countryCode: 'SA',
    },
    
    bookingType: 'DATE_AND_TIME',
    capacityType: 'FREE_SALE',
    timeZone: 'Asia/Riyadh',
    difficultyLevel: 'EASY',
    
    boxSettings: { isBox: false },
    combo: { isCombo: false },
    ticket: { ticketPerPerson: true },
    
    privateExperience: false,
    allowCustomizedBookings: false,
    
    cutoff: {
      type: 'RELATIVE_TO_START_TIME',
      weeks: 0,
      days: 0,
      hours: 2,
      minutes: 0,
    },
    
    meetingType: {
      type: 'MEET_ON_LOCATION',
      dropoffService: false,
      meetingPointAddresses: [
        {
          title: boat.marina || 'Jeddah Marina',
          address: {
            addressLine1: boat.marina || 'Jeddah Marina',
            city: 'Jeddah',
            countryCode: 'SA',
          },
        },
      ],
    },
    
    availabilityRules: [
      {
        recurrenceRule: {
          startDate: new Date().toISOString().split('T')[0],
          endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        },
        maxCapacity: boat.capacity,
        allStartTimes: true,
      },
    ],
    
    pricingCategories: {
      defaultId: pricingCategoryId,
      ids: [pricingCategoryId],
    },
    
    rates: {
      rates: [
        {
          externalId: 'standard',
          title: 'Standard Rate',
          pickupSelectionType: 'UNAVAILABLE',
          dropoffSelectionType: 'UNAVAILABLE',
          cancellationPolicyId,
          pricedPerPerson: true,
          allPricingCategories: true,
          allStartTimes: true,
          tieredPricingEnabled: false,
        },
      ],
      defaultRate: {
        externalId: 'standard',
      },
    },
    
    pricing: {
      experiencePriceRules: [
        {
          rate: { externalId: 'standard' },
          pricingCategoryId,
          amount: boat.price_amount,
          currency: boat.price_currency || 'SAR',
          priceCatalogId,
        },
      ],
      extraPriceRules: [],
      pickupPriceRules: [],
      dropoffPriceRules: [],
      priceCatalogCurrencies: [
        {
          priceCatalogId,
          currencies: [boat.price_currency || 'SAR'],
          defaultCurrency: boat.price_currency || 'SAR',
        },
      ],
    },
    
    photos: [],
  };
}

export async function createBokunExperienceForBoat(
  boatId: number,
  boatData: Parameters<typeof mapBoatToBokunExperience>[0]
): Promise<{ success: boolean; bokunActivityId?: string; error?: string }> {
  try {
    const experienceData = await mapBoatToBokunExperience(boatData);
    
    console.log(`[Bokun Sync] Creating experience for boat ${boatId}`);
    
    const result = await createExperience(experienceData);
    const bokunActivityId = result.id ? String(result.id) : null;
    
    if (bokunActivityId) {
      // Store Bokun activity ID in database
      // await pool.query('UPDATE boats SET bokun_activity_id = $1 WHERE id = $2', [bokunActivityId, boatId]);
      
      console.log(`[Bokun Sync] Successfully created experience ${bokunActivityId} for boat ${boatId}`);
      
      return { success: true, bokunActivityId };
    } else {
      return { success: false, error: 'No experience ID returned from Bokun' };
    }
  } catch (error) {
    console.error(`[Bokun Sync] Failed to create experience for boat ${boatId}:`, error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
```

## Key Points

1. **Always fetch prerequisites first** - Never hardcode IDs
2. **Use `UNAVAILABLE` not `DISABLED`** for pickup/dropoff selection types
3. **Empty photos array** for initial creation
4. **All nested objects are required** - don't skip any
5. **External ID must match** - `rates.rates[0].externalId` must equal `rates.defaultRate.externalId`
6. **Date format** - Use ISO date strings for `startDate` and `endDate`
