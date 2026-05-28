/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Don't fail build on ESLint warnings (we still see them, just don't fail)
  eslint: { ignoreDuringBuilds: true },
  // Don't fail build on TypeScript warnings
  typescript: { ignoreBuildErrors: true },
  images: {
    formats: ["image/avif", "image/webp"],
    unoptimized: false,
  },
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options",            value: "nosniff" },
        { key: "X-Frame-Options",                   value: "SAMEORIGIN" },
        { key: "X-XSS-Protection",                  value: "1; mode=block" },
        { key: "Referrer-Policy",                   value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy",                value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

module.exports = nextConfig;
