import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

/** Marketing pages are open. Demo, tenant and API routes are not for search engines. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/demo/", "/tenant/"],
      },
    ],
    sitemap: new URL("/sitemap.xml", SITE_URL).toString(),
  };
}
