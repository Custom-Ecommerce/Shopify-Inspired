/** @type {import('next').NextConfig} */
const nextConfig = {
  // @markaz/notifications/whatsapp (wa.me links) and the phone rule it uses from @markaz/contracts/checkout ship TypeScript.
  transpilePackages: ["@markaz/core", "@markaz/notifications", "@markaz/contracts", "@markaz/platform-kit"],
};

export default nextConfig;
