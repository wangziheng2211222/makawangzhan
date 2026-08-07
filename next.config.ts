import path from 'node:path'

import type { NextConfig } from 'next'

const devDomain = process.env.COZE_PROJECT_DOMAIN_DEFAULT
  ?.replace(/^https?:\/\//, '')

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  allowedDevOrigins: [
    ...(devDomain ? [devDomain] : []),
    '*.dev.coze.site',
    '*.coze.site',
  ],
  async headers() {
    return [
      {
        // Journey videos are fetched once by the JS preloader and then
        // requested again by the <video> element itself (mobile uses direct
        // URLs). A fresh cache entry lets the player reuse the preloaded
        // response instead of downloading every segment twice.
        source: '/media/journey/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400',
          },
        ],
      },
    ]
  },
}

export default nextConfig
