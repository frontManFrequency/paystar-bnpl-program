/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@electric-sql/pglite'],
  // '.nosync' keeps iCloud Drive from creating conflict copies inside build output.
  distDir: '.next.nosync',
  poweredByHeader: false,
  devIndicators: false,
  images: { unoptimized: true },
  // DATA_DIR / MODEL_ID are read at runtime on the server only.
};
export default nextConfig;
