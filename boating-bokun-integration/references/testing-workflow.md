# Boating KSA - Systematic Browser Testing Workflow

## Overview
This document captures the systematic testing workflow for Boating KSA (boatingksa.com) that can be reused for future test cycles.

## Test Sequence

### 1. Homepage (Arabic) - `/ar`
- [ ] Hero section loads with video background
- [ ] Search widget displays results (auto-loaded products)
- [ ] Tour listings show correct images, prices, locations
- [ ] Navigation menu works (all dropdowns expand)
- [ ] Language switcher works (Switch to English)
- [ ] Trust badges visible (SRSA, SATGA, Sharia, Mada, Zawil)
- [ ] Footer shows correct contact info

### 2. Tour Detail Pages (Arabic) - `/ar/tours/[slug]`
- [ ] Page loads without timeout
- [ ] Tour title and description display correctly
- [ ] Gallery images load (check for broken placeholders)
- [ ] **Bokun Widget loads completely** (critical):
  - [ ] Participants selector visible (Adults/Children with +/- buttons)
  - [ ] Calendar displays current month with navigation arrows
  - [ ] Available dates are clickable (not all greyed out)
  - [ ] Booking Summary section appears after date selection
  - [ ] Checkout button is present
- [ ] No console errors about BokunWidgetsLoader
- [ ] Console shows: `1 iframes, no BokunWidgetsLoader` (direct iframe working)

### 3. Tour Detail Pages (English) - `/en/tours/[slug]`
- [ ] All text properly translated
- [ ] Bokun widget works identically to Arabic version
- [ ] Language switcher returns to Arabic correctly

### 4. Login Page - `/ar/login`
- [ ] No Google/Facebook buttons (removed per requirements)
- [ ] Email and password fields present
- [ ] "Remember Me" checkbox works
- [ ] "Forgot Password" link present
- [ ] Form submission works (test with invalid credentials → error message)

### 5. Tours List Page - `/ar/tours`
- [ ] All tours display with images
- [ ] Filter buttons work (الكل, جدة, الدمام, ينبع, etc.)
- [ ] Tour cards show: title, duration, guests, location, boat name
- [ ] "التفاصيل" links navigate to correct detail pages

### 6. Console Error Check
After each page navigation:
```javascript
browser_console(clear=true)
// Navigate to page
browser_console()
// Check for:
// - BokunWidgetsLoader errors (should be NONE)
// - Image 404s (gallery images)
// - API failures
// - JavaScript exceptions
```

### 7. Bokun Widget Verification (Critical)
```javascript
// Check iframe exists and has correct src
document.querySelectorAll('iframe').length  // Should be 1
document.querySelector('iframe[title="Bokun Booking Widget"]').src
// Should contain: widgets.bokun.io/online-sales/{UUID}/experience-calendar/{ACTIVITY_ID}

// Check BokunWidgetsLoader is NOT loaded (good - means we're using direct iframe)
window.BokunWidgetsLoader  // Should be undefined
```

## Known Issues (as of 2026-07-15)

### Gallery Images Broken on Some Tours
- **Symptom**: Gray placeholder images in tour detail page gallery
- **Root Cause**: Next.js `<Image>` component adds optimization overhead for external Bokun S3 URLs
- **Fix**: Use regular `<img>` tags for Bokun S3 URLs (see bokun-bokun-integration skill Section 6)
- **Status**: Partially fixed - Jeddah Lion images work, some other tours may still have issues

### Page Load Timeout on Specific Tours
- **Symptom**: Some tour pages take too long to load or timeout
- **Root Cause**: Bokun API calls without timeout, or slow database queries
- **Fix**: Add `AbortSignal.timeout(10000)` to Bokun API calls
- **Status**: Intermittent - needs monitoring

## Test Results Template

```markdown
## Test Results - [DATE]

### Summary
- **Readiness**: [X]%
- **Total Tests**: [N]
- **Passed**: [N]
- **Failed**: [N]
- **Warnings**: [N]

### Critical Systems
- [✓/✗] Bokun Widget (booking system)
- [✓/✗] Authentication (login/register)
- [✓/✗] Tour Listings
- [✓/✗] Image Gallery
- [✓/✗] Multi-language Support

### Issues Found
1. [ISSUE_TITLE] - Severity: [Critical/High/Medium/Low]
   - URL: [URL]
   - Description: [DESC]
   - Impact: [IMPACT]

### Recommendations
1. [RECOMMENDATION]
```

## Deployment Verification
After deploying changes:
1. Wait 30 seconds for Cloud Run to stabilize
2. Test homepage loads: `curl -I https://boatingksa.com/ar`
3. Test Bokun widget on Jeddah Lion: navigate to `/ar/tours/jeddah-lion`
4. Check console for errors
5. Verify no regression on English version

## Useful Commands

```bash
# Quick health check
curl -s https://boatingksa.com/api/auth/login -X POST -H "Content-Type: application/json" -d '{"email":"test","password":"test"}' | jq .
# Should return: {"error":"UNAUTHORIZED","message":"Invalid email or password"}

# Check Bokun search API
curl -s https://boatingksa.com/api/bokun/search -H "Content-Type: application/json" -d '{"destination":"","dates":"","guests":1,"category":"all"}' | jq '.results | length'
# Should return: 2 (or number of active tours)

# Check Cloud Run deployment status
gcloud run services describe boating-app --region=us-central1 --project=boating-499409 --format="value(status.url)"
```
