import path from 'node:path'

import type { NextConfig } from 'next'

const devDomain = process.env.COZE_PROJECT_DOMAIN_DEFAULT
  ?.replace(/^https?:\/\//, '')

const nextConfig: NextConfig = {
  devIndicators: false,
  outputFileTracingRoot: path.join(__dirname),
  // Coze 部署的 runtime_pkg 阶段基于 Next.js 文件追踪(nft)结果打包运行时文件。
  // public/ 下的静态资源（视频、海报图）默认不被 nft 追踪，导致生产环境缺失 → 404。
  // 显式将所有 public 资源纳入 '/' 路由的文件追踪，确保部署时一并打包。
  outputFileTracingIncludes: {
    '/': [
      './public/media/**/*',
      './public/images/**/*',
    ],
  },
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
        // Statically prerendered pages default to `s-maxage=31536000`, which
        // lets CDN edges and WebView caches (especially WeChat) keep serving
        // the HTML — and its hashed JS bundle — from a previous deployment
        // long after a redeploy. The HTML is the version entry point, so it
        // must revalidate on every load; only content-hashed assets deserve
        // long caching.
        source: '/',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, must-revalidate',
          },
        ],
      },
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
