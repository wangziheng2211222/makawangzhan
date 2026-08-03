import type { Metadata } from 'next'

import { AnalyticsDashboard } from './AnalyticsDashboard'

export const metadata: Metadata = {
  title: '详情点击统计 | 玛卡小镇',
  robots: { index: false, follow: false },
}

export default function AnalyticsPage() {
  return <AnalyticsDashboard />
}
