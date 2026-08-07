import type { Metadata, Viewport } from 'next'
import Script from 'next/script'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: '玛卡小镇',
  description: '认识来自玛卡星球的四位精灵伙伴。',
  openGraph: {
    title: '玛卡小镇',
    description: '认识来自玛卡星球的四位精灵伙伴。',
    images: ['/images/scenes/maka-town-social.webp'],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#090b13',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const googleAnalyticsId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

  return (
    <html lang="zh-CN">
      <head>
        {/* 禁用电话号码/邮箱自动识别（微信/钉钉内置浏览器会高亮这些内容） */}
        <meta name="format-detection" content="telephone=no, email=no" />
        {/* X5 内核：禁用长按弹出菜单 */}
        <meta name="x5-orientation" content="portrait" />
        {/* 钉钉：禁止手势缩放（部分版本默认允许） */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>
        {children}
        {googleAnalyticsId ? (
          <>
            <Script
              src={`https://www.googletagmanager.cn/gtag/js?id=${encodeURIComponent(googleAnalyticsId)}`}
              strategy="afterInteractive"
            />
            <Script id="google-analytics" strategy="afterInteractive">
              {`
                window.dataLayer = window.dataLayer || [];
                function gtag(){window.dataLayer.push(arguments);}
                window.gtag = gtag;
                gtag('js', new Date());
                gtag('config', ${JSON.stringify(googleAnalyticsId)});
              `}
            </Script>
          </>
        ) : null}
      </body>
    </html>
  )
}
