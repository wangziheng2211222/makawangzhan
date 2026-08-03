import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
}

export default nextConfig
