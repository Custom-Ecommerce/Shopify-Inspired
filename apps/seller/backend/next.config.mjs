/** @type {import('next').NextConfig} */
const nextConfig = {
// Workspace packages ship TypeScript source (package.json main -> src/index.ts).
transpilePackages: [
'@markaz/auth',
'@markaz/contracts',
'@markaz/db-schemas',
'@markaz/notifications',
'@markaz/platform-kit',
'@markaz/sync-core',
],
};
export default nextConfig;
