import type { MetadataRoute } from "next";
import { THEME_SLUGS, getThemeEntry } from "@markaz/platform-kit/themes";
import { SITE_URL } from "@/lib/seo";

/** Marketing routes only. Demo, tenant, system and API routes are never listed. */
const STATIC_PATHS = [
  "/",
  "/features",
  "/themes",
  "/pricing",
  "/about",
  "/contact",
  "/legal/terms",
  "/legal/privacy",
  "/legal/cookies",
  "/legal/refunds",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const themePaths = THEME_SLUGS.filter((slug) => getThemeEntry(slug)?.status !== "archived").map(
    (slug) => `/themes/${slug}`,
  );

  return [...STATIC_PATHS, ...themePaths].map((path) => ({
    url: new URL(path, SITE_URL).toString(),
    changeFrequency: "weekly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
