/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow ngrok/Vercel previews
  experimental: {
    // Restrict server action origins. Add your ngrok URL or Vercel preview URL here when needed.
    serverActions: { allowedOrigins: ["localhost:3000"] },
  },
};

module.exports = nextConfig;
