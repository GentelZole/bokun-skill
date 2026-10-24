# Product Detail Page Layout Pattern

Reference for the product detail page layout used in `tours/[slug]` and `boats/[slug]`.
Both pages share the same structure — only the `findBokunActivity()` slug-stripping differs slightly.

## Page Structure

```
PageBreadcrumb
├── Hero Section (conditional — only if heroImage exists)
│   ├── Full-width image with gradient overlay (bottom-to-top dark)
│   └── Title + location overlay at bottom-left
├── Content Area (container-luxury)
│   ├── Left column (lg:col-span-2) — Product Info
│   │   ├── H1 title (only if no hero image, to avoid duplication)
│   │   ├── Quick Info Cards (2x2 / 4-col grid)
│   │   │   ├── Price card (nautical-gold text)
│   │   │   ├── Duration card (deep-sea text)
│   │   │   ├── Capacity card (deep-sea text)
│   │   │   └── Rating card (deep-sea text, with star + review count)
│   │   ├── Description section (font-bodyAr for Arabic, text-right)
│   │   └── Gallery section (2-3 col grid of square thumbnails)
│   └── Right column (lg:col-span-1) — Booking Sidebar
│       └── Sticky BookingFlow card (top-8, shadow-sm, rounded-xl)
```

## Key Design Decisions

### Hero Image
- Use `keyPhoto.originalUrl` from Bokun API response, fallback to `images[0].originalUrl`
- Regular `<img>` tag (NOT next/image) — Bokun S3 images load faster without optimization
- Gradient overlay: `bg-gradient-to-t from-black/70 via-black/20 to-transparent`
- Title overlaid at bottom in white, with `font-displayAr` for Arabic

### Quick Info Cards
- 4-column responsive grid (`grid-cols-2 sm:grid-cols-4`)
- Each card: `rounded-lg border border-gray-200 bg-white p-4 text-center`
- Price in `text-nautical-gold`, other info in `text-deep-sea`
- Only render cards when data exists (conditional rendering)

### Arabic RTL Support
- `isAr = locale === "ar"` flag at top of component
- Headings: `className={... ${isAr ? "font-displayAr" : ""}`
- Body text: `className={... ${isAr ? "font-bodyAr text-right" : ""}`
- Breadcrumb home label: `isAr ? "الرئيسية" : "Home"`
- Section headings: `isAr ? "وصف التجربة" : "About this experience"`, etc.

### BookingFlow Sidebar
- Wrapped in `sticky top-8` div so it stays visible while scrolling
- Card: `rounded-xl border border-gray-200 bg-white p-4 sm:p-6 shadow-sm`
- BookingFlow receives: `locale`, `capacity`, `bokunProductId`, `productTitle`, `productPrice`, `productDuration`

### Gallery
- Only shown if `galleryImages.length > 1` (hero image already shown at top)
- Square thumbnails: `aspect-square rounded-lg overflow-hidden`
- Hover effect: `hover:scale-105 transition-transform duration-300`
- Max 6 images: `galleryImages.slice(0, 6)`

## Data Extraction from Bokun Activity Response

```typescript
const title = (activity.title as string) || activityMatch.title;
const description = (activity.excerpt as string) || (activity.description as string) || (activity.summary as string) || "";
const price = typeof activity.price === "number" ? activity.price : 0;
const durationText = (activity.durationText as string) || "";
const maxCapacity = typeof activity.maxCapacity === "number" ? activity.maxCapacity : 10;

const keyPhoto = activity.keyPhoto as { originalUrl?: string } | undefined;
const images = activity.images as Array<{ originalUrl?: string }> | undefined;
const heroImage = keyPhoto?.originalUrl || (images?.length ? images[0]?.originalUrl : "") || "";

const location = (activity.location as string) || (activity.city as string) || "";
const reviewRating = typeof activity.reviewRating === "number" ? activity.reviewRating : 0;
const reviewCount = typeof activity.reviewCount === "number" ? activity.reviewCount : 0;
```

## Activity Data Fetch

```typescript
const lang = locale === "ar" ? "AR" : "EN";
let activity: Record<string, unknown> | null = null;
try {
  activity = await getActivity(activityMatch.id, lang, "SAR");
} catch (error) {
  console.error("Failed to fetch activity details:", error);
  notFound();
}
```

Note: `getActivity()` can fail silently — see SKILL.md Section 29. The `findBokunActivity()` function handles this via search fallback with ID matching.

## GenerateMetadata

```typescript
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  const activity = await findBokunActivity(slug);
  if (!activity) return { title: "Tour Not Found" };
  return {
    title: activity.title,
    description: `Book ${activity.title} — boat tour in Jeddah`,
    openGraph: {
      title: activity.title,
      url: `${SITE_URL}/${locale}/tours/${slug}`,
      siteName: "Boating KSA",
      locale: locale === "ar" ? "ar_SA" : "en_US",
      type: "website",
    },
  };
}
```

## Tours vs Boats Page Differences

The only difference between `tours/[slug]/page.tsx` and `boats/[slug]/page.tsx`:

1. **Slug stripping**: Boats page also strips `boat-` prefix (`cleanSlug.replace(/^boat-/, "")`)
2. **Metadata description**: "boat tour in Jeddah" vs "boat rental in Jeddah"
3. **Boats page** has `export const dynamic = "force-dynamic"` and `revalidate = 0`
4. **Boats page** uses `metadataBase: new URL(SITE_URL)` in generateMetadata

Everything else (hero, info cards, gallery, BookingFlow) is identical.
