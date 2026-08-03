import { createReadStream } from 'node:fs'
import { access, appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'

import type {
  AnalyticsBreakdownItem,
  AnalyticsRecentClick,
  AnalyticsStats,
} from '@/types/analytics'

const ANALYTICS_TIME_ZONE = 'Asia/Shanghai'
const ANALYTICS_FILE_NAME = 'analytics-events.jsonl'
const DAY_IN_MS = 24 * 60 * 60 * 1000

const robotLabels: Record<string, string> = {
  jiuka: '啾咔',
  'little-devil': '小恶魔',
  'biker-rabbit': '机车兔',
  pipi: '屁屁',
  'maka-town': '玛卡小镇',
}

const sourceLabels: Record<string, string> = {
  chapter: '旅程章节',
  chooser: '产品选择区',
  reunion: '重聚章节',
}

export type StoredAnalyticsEvent = {
  id: string
  event: 'business_cta_click'
  occurredAt: string
  receivedAt: string
  sessionId: string
  path: string
  referrer?: string
  userAgent?: string
  payload: {
    cta_id?: string
    cta_label?: string
    robot_id?: string
    source: string
    destination: string
  }
}

let writeQueue = Promise.resolve()

function analyticsFilePath() {
  const configuredDirectory = process.env.ANALYTICS_DATA_DIR?.trim()
  const dataDirectory = configuredDirectory
    ? path.resolve(process.cwd(), configuredDirectory)
    : path.join(process.cwd(), '.data')

  return path.join(dataDirectory, ANALYTICS_FILE_NAME)
}

export function appendAnalyticsEvent(event: StoredAnalyticsEvent) {
  const filePath = analyticsFilePath()
  const write = async () => {
    await mkdir(path.dirname(filePath), { recursive: true })
    await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8')
  }

  writeQueue = writeQueue.then(write, write)
  return writeQueue
}

function dayKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ANALYTICS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((item) => item.type === type)?.value ?? ''
  )

  return `${part('year')}-${part('month')}-${part('day')}`
}

function sortBreakdown(
  counts: Map<string, number>,
  labels: Record<string, string>,
): AnalyticsBreakdownItem[] {
  return Array.from(counts, ([key, count]) => ({
    key,
    label: labels[key] ?? key,
    count,
  })).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'zh-CN'))
}

function toRecentClick(event: StoredAnalyticsEvent): AnalyticsRecentClick {
  const robotId = event.payload.robot_id
  const robotKey = robotId ?? 'maka-town'

  return {
    id: event.id,
    occurredAt: event.occurredAt,
    sessionId: event.sessionId,
    path: event.path,
    source: event.payload.source,
    sourceLabel: sourceLabels[event.payload.source] ?? event.payload.source,
    robotId,
    robotLabel: robotLabels[robotKey] ?? robotKey,
    ctaId: event.payload.cta_id,
    destination: event.payload.destination,
  }
}

function isStoredAnalyticsEvent(value: unknown): value is StoredAnalyticsEvent {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<StoredAnalyticsEvent>
  return candidate.event === 'business_cta_click'
    && typeof candidate.id === 'string'
    && typeof candidate.occurredAt === 'string'
    && typeof candidate.sessionId === 'string'
    && Boolean(candidate.payload)
    && typeof candidate.payload?.source === 'string'
    && typeof candidate.payload?.destination === 'string'
}

export async function getAnalyticsStats(now = new Date()): Promise<AnalyticsStats> {
  const daily = Array.from({ length: 7 }, (_, index) => ({
    date: dayKey(new Date(now.getTime() - (6 - index) * DAY_IN_MS)),
    count: 0,
  }))
  const dailyCounts = new Map(daily.map((item) => [item.date, item]))
  const robotCounts = new Map<string, number>()
  const sourceCounts = new Map<string, number>()
  const sessions = new Set<string>()
  const recent: AnalyticsRecentClick[] = []
  let totalClicks = 0
  let todayClicks = 0

  const filePath = analyticsFilePath()
  try {
    await access(filePath)
    const lines = createInterface({
      input: createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    })

    for await (const line of lines) {
      if (!line.trim()) continue

      let event: unknown
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (!isStoredAnalyticsEvent(event)) continue

      totalClicks += 1
      sessions.add(event.sessionId)

      const eventDate = new Date(event.occurredAt)
      if (!Number.isNaN(eventDate.getTime())) {
        const eventDay = dayKey(eventDate)
        if (eventDay === dayKey(now)) todayClicks += 1
        const dailyItem = dailyCounts.get(eventDay)
        if (dailyItem) dailyItem.count += 1
      }

      const robotKey = event.payload.robot_id ?? 'maka-town'
      robotCounts.set(robotKey, (robotCounts.get(robotKey) ?? 0) + 1)
      sourceCounts.set(
        event.payload.source,
        (sourceCounts.get(event.payload.source) ?? 0) + 1,
      )

      recent.push(toRecentClick(event))
      recent.sort((left, right) => (
        new Date(right.occurredAt).getTime() - new Date(left.occurredAt).getTime()
      ))
      if (recent.length > 50) recent.pop()
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') throw error
  }

  return {
    generatedAt: now.toISOString(),
    timeZone: ANALYTICS_TIME_ZONE,
    summary: {
      totalClicks,
      todayClicks,
      last7DaysClicks: daily.reduce((total, item) => total + item.count, 0),
      uniqueSessions: sessions.size,
    },
    daily,
    byRobot: sortBreakdown(robotCounts, robotLabels),
    bySource: sortBreakdown(sourceCounts, sourceLabels),
    recent,
  }
}
