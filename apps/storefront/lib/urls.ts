import { DEFAULT_THEME_SLUG } from "@markaz/platform-kit/themes";

export function getSellerPortalUrl(path = ""): string {
  const baseUrl = process.env.SELLER_PORTAL_URL || "http://localhost:3002";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl.replace(/\/$/, "")}${normalizedPath}`;
}

/** Demo link for a theme. The default comes from the platform theme manifest (F8). */
export function getThemeDemoUrl(themeName: string = DEFAULT_THEME_SLUG): string {
  const rootDomain = process.env.ROOT_DOMAIN || "localhost:3000";
  const protocol = rootDomain.includes("localhost") ? "http://" : "https://";
  return `${protocol}theme.${themeName}.${rootDomain}`;
}
