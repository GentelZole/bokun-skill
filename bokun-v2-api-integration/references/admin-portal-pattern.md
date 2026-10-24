# Admin Portal Bokun Management Pattern

This document shows how to integrate Bokun management into an admin portal.

## Page Structure

### Server Component (`page.tsx`)

```typescript
import { getAdminSession } from "@/lib/admin/session";
import { redirect } from "@/lib/i18n/navigation";
import { BokunManagementClient } from "./BokunManagementClient";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function BokunManagementPage({ params }: Props) {
  const { locale } = await params;
  const session = await getAdminSession();

  if (!session) {
    redirect({
      href: "/admin/login",
      locale: locale as "en" | "ar",
    });
    return null;
  }

  if (session.role !== "boat_owner" && session.role !== "super_admin") {
    redirect({
      href: "/admin",
      locale: locale as "en" | "ar",
    });
    return null;
  }

  return <BokunManagementClient locale={locale} userId={session.id} />;
}
```

### Client Component (`BokunManagementClient.tsx`)

```typescript
"use client";

import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle, XCircle, Ship, AlertCircle } from "lucide-react";

interface BokunStats {
  totalBoats: number;
  syncedBoats: number;
  unsyncedBoats: number;
  totalTours: number;
  syncedTours: number;
  unsyncedTours: number;
}

interface SyncResult {
  success: boolean;
  message: string;
  stats?: {
    boats: { synced: number; failed: number };
    tours: { synced: number; failed: number };
    totalSynced: number;
    totalFailed: number;
  };
  errors?: string[];
}

export function BokunManagementClient({ locale, userId }: { locale: string; userId: string }) {
  const isArabic = locale === "ar";
  const [stats, setStats] = useState<BokunStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchStats();
  }, [userId]);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError("");
      
      // Fetch boats and tours from local database
      const [boatsResponse, toursResponse] = await Promise.all([
        fetch("/api/admin/boats"),
        fetch("/api/admin/tours"),
      ]);

      if (!boatsResponse.ok || !toursResponse.ok) {
        throw new Error("Failed to fetch statistics");
      }

      const boatsData = await boatsResponse.json();
      const toursData = await toursResponse.json();

      const boats = boatsData.boats || [];
      const tours = toursData.tours || [];

      const syncedBoats = boats.filter((b: any) => b.bokun_activity_id).length;
      const syncedTours = tours.filter((t: any) => t.bokun_activity_id).length;

      setStats({
        totalBoats: boats.length,
        syncedBoats,
        unsyncedBoats: boats.length - syncedBoats,
        totalTours: tours.length,
        syncedTours,
        unsyncedTours: tours.length - syncedTours,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load statistics");
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      setSyncResult(null);
      setError("");

      const response = await fetch("/api/admin/bokun/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Sync failed");
      }

      setSyncResult(data);
      await fetchStats(); // Refresh stats after sync
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  // Render UI with:
  // - Statistics cards (total, synced, unsynced, sync rate)
  // - Sync button with loading state
  // - Sync result display (success/failure with details)
  // - Error messages
  // ...
}
```

## API Route (`/api/admin/bokun/sync/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken, findUserById } from '@/lib/auth';
import { syncAllBoatsWithBokun, syncAllToursWithBokun } from '@/lib/bokun-sync';

async function getAdminUser(request: NextRequest) {
  // Authentication logic...
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAdminUser(request);

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'boat_owner' && user.role !== 'super_admin') {
      return NextResponse.json(
        { error: 'Forbidden - Only boat owners can sync with Bokun' },
        { status: 403 }
      );
    }

    console.log(`[Admin Bokun Sync] User ${user.email} initiated manual sync`);

    const [boatsResult, toursResult] = await Promise.all([
      syncAllBoatsWithBokun(),
      syncAllToursWithBokun(),
    ]);

    const allErrors = [...boatsResult.errors, ...toursResult.errors];
    const totalSynced = boatsResult.synced + toursResult.synced;
    const totalFailed = boatsResult.failed + toursResult.failed;
    const success = boatsResult.success && toursResult.success;

    return NextResponse.json({
      success,
      message: success
        ? `Synced ${boatsResult.synced} boats and ${toursResult.synced} tours with Bokun`
        : 'Sync partially failed',
      stats: {
        boats: {
          synced: boatsResult.synced,
          failed: boatsResult.failed,
        },
        tours: {
          synced: toursResult.synced,
          failed: toursResult.failed,
        },
        totalSynced,
        totalFailed,
      },
      errors: allErrors.length > 0 ? allErrors : undefined,
    });
  } catch (error) {
    console.error('POST /api/admin/bokun/sync error:', error);
    return NextResponse.json(
      { error: `Failed to sync with Bokun: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
```

## UI Components

### Statistics Cards

```typescript
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  {/* Total Boats */}
  <div className="rounded-xl bg-white p-6 shadow-sm border border-deep-sea/5">
    <div className="flex items-center justify-between mb-2">
      <Ship className="h-8 w-8 text-nautical-gold" />
      <span className="text-3xl font-bold text-deep-sea">{stats.totalBoats}</span>
    </div>
    <p className="text-sm text-deep-sea/60">
      {isArabic ? "إجمالي القوارب" : "Total Boats"}
    </p>
  </div>

  {/* Synced Boats */}
  <div className="rounded-xl bg-white p-6 shadow-sm border border-deep-sea/5">
    <div className="flex items-center justify-between mb-2">
      <CheckCircle className="h-8 w-8 text-green-500" />
      <span className="text-3xl font-bold text-green-600">{stats.syncedBoats}</span>
    </div>
    <p className="text-sm text-deep-sea/60">
      {isArabic ? "قوارب مزامنة" : "Synced Boats"}
    </p>
  </div>

  {/* Unsynced Boats */}
  <div className="rounded-xl bg-white p-6 shadow-sm border border-deep-sea/5">
    <div className="flex items-center justify-between mb-2">
      <AlertCircle className="h-8 w-8 text-orange-500" />
      <span className="text-3xl font-bold text-orange-600">{stats.unsyncedBoats}</span>
    </div>
    <p className="text-sm text-deep-sea/60">
      {isArabic ? "قوارب غير مزامنة" : "Unsynced Boats"}
    </p>
  </div>

  {/* Sync Rate */}
  <div className="rounded-xl bg-white p-6 shadow-sm border border-deep-sea/5">
    <div className="flex items-center justify-between mb-2">
      <RefreshCw className="h-8 w-8 text-blue-500" />
      <span className="text-3xl font-bold text-blue-600">
        {stats.totalBoats > 0
          ? Math.round((stats.syncedBoats / stats.totalBoats) * 100)
          : 0}%
      </span>
    </div>
    <p className="text-sm text-deep-sea/60">
      {isArabic ? "نسبة المزامنة" : "Sync Rate"}
    </p>
  </div>
</div>
```

### Sync Result Display

```typescript
{syncResult && (
  <div
    className={`rounded-lg p-4 border ${
      syncResult.success
        ? "bg-green-50 border-green-100"
        : "bg-red-50 border-red-100"
    }`}
  >
    <div className="flex items-start gap-3">
      {syncResult.success ? (
        <CheckCircle className="h-5 w-5 text-green-600 mt-0.5" />
      ) : (
        <XCircle className="h-5 w-5 text-red-600 mt-0.5" />
      )}
      <div className="flex-1">
        <p className={`font-semibold ${syncResult.success ? "text-green-900" : "text-red-900"}`}>
          {syncResult.message}
        </p>
        {syncResult.stats && (
          <div className="mt-2 text-sm space-y-1">
            <p className={syncResult.success ? "text-green-700" : "text-red-700"}>
              {isArabic ? "القوارب:" : "Boats:"} {syncResult.stats.boats.synced}{" "}
              {isArabic ? "تمت مزامنتها" : "synced"},{" "}
              {syncResult.stats.boats.failed}{" "}
              {isArabic ? "فشلت" : "failed"}
            </p>
            <p className={syncResult.success ? "text-green-700" : "text-red-700"}>
              {isArabic ? "الجولات:" : "Tours:"} {syncResult.stats.tours.synced}{" "}
              {isArabic ? "تمت مزامنتها" : "synced"},{" "}
              {syncResult.stats.tours.failed}{" "}
              {isArabic ? "فشلت" : "failed"}
            </p>
          </div>
        )}
        {syncResult.errors && syncResult.errors.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium text-red-800 mb-1">
              {isArabic ? "الأخطاء:" : "Errors:"}
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm text-red-700">
              {syncResult.errors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  </div>
)}
```

## Key Features

1. **Real-time statistics** - Fetches from local database
2. **Manual sync button** - Triggers Bokun API sync
3. **Loading states** - Shows spinner during sync
4. **Error handling** - Displays errors with details
5. **Success feedback** - Shows sync results with counts
6. **Bilingual support** - Arabic/English toggle
7. **Responsive design** - Grid layout adapts to screen size

## Integration Points

- **Database**: Store `bokun_activity_id` in boats/tours tables
- **API routes**: `/api/admin/boats`, `/api/admin/tours`, `/api/admin/bokun/sync`
- **Auth**: Check user role before allowing sync
- **UI**: Use existing design system (colors, spacing, components)
