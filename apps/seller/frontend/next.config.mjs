/** @type {import('next').NextConfig} */
const nextConfig = {
  // @markaz/notifications/whatsapp (wa.me links) and the phone rule it uses from @markaz/contracts/checkout ship TypeScript.
  transpilePackages: ["@markaz/core", "@markaz/notifications", "@markaz/contracts", "@markaz/platform-kit"],
  // S8-B4: lib/role-access.ts reads the seller capability matrix from packages/auth/src (one pure file, no imports; the package itself is server code and is not a
  // dependency of the portal), so a source file outside the app folder must be compiled.
  experimental: { externalDir: true },
};

export default nextConfig;
