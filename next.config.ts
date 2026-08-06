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
}

export default nextConfig
