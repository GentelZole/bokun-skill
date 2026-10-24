# Bokun search items: gallery is `photos[]`, not `images[]` (production bug, 2026-08-15)

## The bug

Boating KSA tour/boat detail pages showed **one image** (the hero) even though
the Bokun dashboard held 10–22 photos per tour. Customer complaint: "only one
boat photo downloads".

Root cause: `/activity.json/search` returns each item's gallery as **`photos[]`**
plus a top-level `keyPhoto` — there is **no `images` field** on search items.
Page code reading `activity.images` got `undefined`, so:

- hero fell back to `keyPhoto.originalUrl` (worked — one image),
- the gallery list stayed empty, and
- the gallery section, conditioned on `galleryImages.length > 1`, never rendered.

## Verified live payload shape (2026-08-15)

```
POST /activity.json/search?lang=EN&currency=SAR   body: {paging:{page:1,perPage:50}}
→ items[].keyPhoto : { id, originalUrl, fileName, height, width,
                       derived: [ {name:"thumbnail",url}, {name:"preview",url}, {name:"large",url} ] }
→ items[].photos   : [ same shape as keyPhoto, one per uploaded photo ]
→ items[].images   : ABSENT
```

Counts observed: White Orca 1251403 → 18, Meveda 1258760 → 22,
Oryx 1258758 → 18, Lolo 1251353 → 15, Altayyar 1258054 → 10.

## Fix (shipped in tours/[slug] + boats/[slug] pages)

```typescript
// Read both, photos first — survives either payload shape
const rawGallery = (activity.photos ?? activity.images) as
  Array<Record<string, unknown>> | undefined;

const galleryImages: string[] = [];
if (Array.isArray(rawGallery)) {
  for (const img of rawGallery) {
    const original = img.originalUrl as string | undefined;
    const derived = Array.isArray(img.derived) ? img.derived : [];
    const large = derived.find((d) => d.name === "large");
    // Prefer the 660px CDN variant over the 1600px S3 original (site speed)
    const url = (large?.url as string) || original;
    if (url) galleryImages.push(url);
  }
}
```

Render ALL of them (the old code capped at 6), with `loading="lazy"` below the
first 3. Result: White Orca page shows all 18 photos, zero failed loads.

## Related auth gotcha

The access-key header is **`X-Bokun-AccessKey`** (one word, capital K).
`X-Bokun-Access-Key` returns 401 — a standalone test script using the wrong
header name looked like a credentials problem but wasn't.

## Lesson for any third-party field mapping

Before writing a mapper, dump one raw item and enumerate which keys actually
exist (`Object.keys(item).filter(/photo|image|img/i)`) — don't assume the
field names from documentation or from a sibling endpoint's shape. A mapper
reading an absent field fails silently (empty gallery), which reads as a
content/config problem rather than a code bug and survives for months.
