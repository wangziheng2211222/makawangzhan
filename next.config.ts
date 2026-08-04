import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingRoot: path.join(__dirname, '../../'),
  allowedDevOrigins: ['*.dev.coze.site'],
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
}

export default nextConfig
