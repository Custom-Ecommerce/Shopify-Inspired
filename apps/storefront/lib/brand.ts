const rawRootDomain = process.env.ROOT_DOMAIN || "markazify.com";
const publicDomain = rawRootDomain.includes("localhost")
  ? "markazify.com"
  : rawRootDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "");

export const BRAND = {
  name: "Markazify",
  domain: publicDomain,
  adminPreviewUrl: `seller.${publicDomain}/admin`,
} as const;
