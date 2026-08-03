export type AnalyticsSummary = {
  totalClicks: number
  todayClicks: number
  last7DaysClicks: number
  uniqueSessions: number
}

export type AnalyticsBreakdownItem = {
  key: string
  label: string
  count: number
}

export type AnalyticsDailyItem = {
  date: string
  count: number
}

export type AnalyticsRecentClick = {
  id: string
  occurredAt: string
  sessionId: string
  path: string
  source: string
  sourceLabel: string
  robotId?: string
  robotLabel: string
  ctaId?: string
  destination: string
}

export type AnalyticsStats = {
  generatedAt: string
  timeZone: string
  summary: AnalyticsSummary
  daily: AnalyticsDailyItem[]
  byRobot: AnalyticsBreakdownItem[]
  bySource: AnalyticsBreakdownItem[]
  recent: AnalyticsRecentClick[]
}
