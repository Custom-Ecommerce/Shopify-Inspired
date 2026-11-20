/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["theme.mustafa.localhost", "*.localhost", "localhost"],
  // The shared workspace package ships TypeScript source (see its package.json `exports`).
  transpilePackages: [
    "@markaz/contracts",
    "@markaz/notifications",
    "@markaz/platform-kit",
    "@markaz/storefront-data",
    "@markaz/storefront-theme-kit",
    "@markaz/theme-mustafa",
    "@markaz/theme-stiletto",
  ],
  images: {
    // Tenant product and store media is served from Cloudinary (F15).
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      // The Stiletto demo catalogue and its static imagery.
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
};

export default nextConfig;
/* @theme-integration-patch:next-config */
