import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  appendAnalyticsEvent,
  type StoredAnalyticsEvent,
} from '@/lib/server/analytics-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_BODY_BYTES = 8_192
const robotIds = new Set(['jiuka', 'little-devil', 'biker-rabbit', 'pipi'])
const detailSources = new Set(['chapter', 'chooser', 'reunion'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  if (!normalized) return undefined
  return normalized.slice(0, maxLength)
}

function cleanDestination(value: unknown) {
  const destination = cleanString(value, 1_000)
  if (!destination) return undefined

  try {
    const url = new URL(destination)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? destination
      : undefined
  } catch {
    return undefined
  }
}

function cleanOccurredAt(value: unknown, receivedAt: Date) {
  const occurredAt = cleanString(value, 40)
  if (!occurredAt) return receivedAt.toISOString()

  const parsed = new Date(occurredAt)
  const clockDifference = Math.abs(receivedAt.getTime() - parsed.getTime())
  if (Number.isNaN(parsed.getTime()) || clockDifference > 24 * 60 * 60 * 1000) {
    return receivedAt.toISOString()
  }

  return parsed.toISOString()
}

function isAllowedOrigin(origin: string | null, requestHost: string | null | undefined) {
  if (!origin) return true
  if (!requestHost) return false

  try {
    return new URL(origin).host === requestHost
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin')
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const requestHost = forwardedHost || request.headers.get('host')
  if (!isAllowedOrigin(origin, requestHost)) {
    return NextResponse.json({ error: 'cross_origin_request' }, { status: 403 })
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
  }

  let body: unknown
  try {
    const rawBody = await request.text()
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'payload_too_large' }, { status: 413 })
    }
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!isRecord(body) || body.event !== 'business_cta_click' || !isRecord(body.payload)) {
    return NextResponse.json({ error: 'invalid_event' }, { status: 400 })
  }

  const source = cleanString(body.payload.source, 40)
  const destination = cleanDestination(body.payload.destination)
  const sessionId = cleanString(body.sessionId, 100)
  if (!source || !detailSources.has(source) || !destination || !sessionId) {
    return NextResponse.json({ error: 'invalid_event_fields' }, { status: 400 })
  }

  const robotId = cleanString(body.payload.robot_id, 40)
  if (robotId && !robotIds.has(robotId)) {
    return NextResponse.json({ error: 'invalid_robot_id' }, { status: 400 })
  }

  const receivedAt = new Date()
  const event: StoredAnalyticsEvent = {
    id: randomUUID(),
    event: 'business_cta_click',
    occurredAt: cleanOccurredAt(body.occurredAt, receivedAt),
    receivedAt: receivedAt.toISOString(),
    sessionId,
    path: cleanString(body.page, 500) ?? '/',
    referrer: cleanString(body.referrer, 1_000),
    userAgent: cleanString(request.headers.get('user-agent'), 500),
    payload: {
      cta_id: cleanString(body.payload.cta_id, 100),
      cta_label: cleanString(body.payload.cta_label, 100),
      robot_id: robotId,
      source,
      destination,
    },
  }

  try {
    await appendAnalyticsEvent(event)
    return NextResponse.json({ accepted: true }, { status: 202 })
  } catch (error) {
    console.error('Failed to persist analytics event', error)
    return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 })
  }
}
