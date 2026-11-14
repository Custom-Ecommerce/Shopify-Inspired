import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as themesNs from '@markaz/platform-kit/themes';
import { authenticate } from '@/lib/auth';
import { unwrapCjs } from '@/lib/cjs';
import { handleRouteError } from '@/lib/http';

const themes: typeof themesNs = unwrapCjs(themesNs);

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/themes (Sprint 4 EP-04.US04): the themes a store may choose, from the one platform manifest
 * (@markaz/platform-kit/themes, installed entries only). previewImage is null until the manifest carries one.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    await authenticate(request);
    const list = themes.listInstalledThemes().map((entry) => ({
      slug: entry.slug,
      name: entry.label,
      tier: entry.tier,
      previewImage: entry.previewImage ?? null,
      isDefaultForNewStores: entry.slug === themes.NEW_STORE_THEME_SLUG,
    }));
    return NextResponse.json({ themes: list }, { headers: { 'Cache-Control': 'private, max-age=300' } });
  } catch (err) {
    return handleRouteError(err);
  }
}
