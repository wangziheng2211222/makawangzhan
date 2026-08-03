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
  themeColor: '#f3f5ff',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const googleAnalyticsId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID

  return (
    <html lang="zh-CN">
      <body>
        {children}
        {googleAnalyticsId ? (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(googleAnalyticsId)}`}
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
