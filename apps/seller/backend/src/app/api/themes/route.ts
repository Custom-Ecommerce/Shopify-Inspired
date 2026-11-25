import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as themesNs from '@markaz/platform-kit/themes';
import { authenticate } from '@/lib/auth';
import { unwrapCjs } from '@/lib/cjs';
import { handleRouteError } from '@/lib/http';
import { planAllowsPremiumThemes } from '@/lib/plan';
import { themeLockFlags } from '@/lib/theme-plan';
import { previewImageUrl } from '@/lib/theme-preview';

const themes: typeof themesNs = unwrapCjs(themesNs);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/themes (Sprint 4 EP-04.US04, Sprint 7 D-115): the themes a seller may choose, from the one platform manifest
 * (@markaz/platform-kit/themes, listSellerThemes: installed, available and not hidden), so today only Stiletto. Mustafa stays in the repository but is
 * not listed. premium and locked (S7-B7): locked is true for a premium theme on a plan without premium themes. previewImage (CO-81) is the theme's static preview image, or null when it has none.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const ctx = await authenticate(request);
    // S7-B7 (D-118): a premium theme is listed with locked: true on a plan without premium themes (none is premium today; Stiletto is free).
    const premiumAllowed = await planAllowsPremiumThemes(ctx.userId);
    const list = themes.listSellerThemes().map((entry) => ({
      slug: entry.slug,
      name: entry.label,
      tier: entry.tier,
      previewImage: previewImageUrl(entry.previewImage, process.env.STOREFRONT_URL),
      isDefaultForNewStores: entry.slug === themes.NEW_STORE_THEME_SLUG,
      supportsCardCheckout: themes.themeSupportsCardCheckout(entry.slug),
      ...themeLockFlags(entry.slug, premiumAllowed),
    }));
    return NextResponse.json({ themes: list }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
