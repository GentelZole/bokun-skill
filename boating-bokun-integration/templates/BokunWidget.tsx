/**
 * BokunWidget - Official Bokun booking widget for Next.js
 * 
 * KEY PATTERN: Uses <div class="bokunWidget" data-src="..."> + BokunWidgetsLoader.js
 * The loader script finds .bokunWidget divs and replaces them with properly initialized iframes.
 * 
 * ✅ CORRECT: Load BokunWidgetsLoader.js dynamically in useEffect, use div.bokunWidget with data-src
 * ❌ WRONG: Using Next.js <Script> component — causes hydration issues
 * ❌ WRONG: Direct <iframe> — works but not the official Bokun method
 * 
 * CSP REQUIREMENT: Both widgets.bokun.io AND static.bokun.io must be in script-src.
 * The loader (widgets.bokun.io) loads a secondary engine script from static.bokun.io.
 * 
 * Usage:
 *   <BokunWidget productId={tour.bokun_activity_id} locale={locale} />
 * 
 * The widget URL is built from the BOOKING_CHANNEL_UUID constant.
 */

"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const BOOKING_CHANNEL_UUID = "9ce5dbac-a6d4-468a-ab56-5f261685f66a";
const BOKUN_WIDGETS_LOADER = `https://widgets.bokun.io/assets/javascripts/apps/build/BokunWidgetsLoader.js?bookingChannelUUID=${BOOKING_CHANNEL_UUID}`;

interface BokunWidgetProps {
  productId?: string;
  locale?: string;
  className?: string;
}

export function BokunWidget({ productId, locale = "ar", className }: BokunWidgetProps) {
  const [widgetLoaded, setWidgetLoaded] = useState(false);

  // Build widget URL
  const widgetUrl = productId
    ? `https://widgets.bokun.io/online-sales/${BOOKING_CHANNEL_UUID}/experience/${productId}`
    : `https://widgets.bokun.io/online-sales/${BOOKING_CHANNEL_UUID}`;

  useEffect(() => {
    // Check if script already exists
    const existingScript = document.querySelector(`script[src="${BOKUN_WIDGETS_LOADER}"]`);
    
    if (existingScript) {
      // Script already loaded, trigger widget refresh
      if (window.BokunWidgetsLoader) {
        window.BokunWidgetsLoader.refresh();
      }
      setWidgetLoaded(true);
      return;
    }

    // Load BokunWidgetsLoader script dynamically
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = BOKUN_WIDGETS_LOADER;
    script.async = true;
    script.onload = () => setWidgetLoaded(true);
    script.onerror = () => console.error("Failed to load BokunWidgetsLoader");

    document.body.appendChild(script);
  }, [productId]);

  return (
    <div className={cn("min-h-[500px] w-full rounded-lg overflow-hidden relative", !widgetLoaded && "animate-pulse bg-gray-100", className)}>
      {/* Official Bokun Widget div */}
      <div className="bokunWidget w-full min-h-[500px]" data-src={widgetUrl} />
      <noscript>Please enable javascript in your browser to book</noscript>
      
      {/* Loading overlay */}
      {!widgetLoaded && (
        <div className="flex items-center justify-center h-full min-h-[500px] absolute inset-0 bg-white/80 z-10">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-nautical-gold border-t-transparent"></div>
            <p className="mt-4 text-sm text-deep-sea/60">
              {locale === "ar" ? "جارٍ تحميل نظام الحجز..." : "Loading booking system..."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
