type AnalyticsValue = string | number | boolean | null | undefined

export type AnalyticsPayload = Record<string, AnalyticsValue>

declare global {
  interface Window {
    dataLayer?: Array<Record<string, AnalyticsValue>>
    gtag?: (
      command: 'event',
      eventName: string,
      eventParameters: AnalyticsPayload,
    ) => void
  }
}

const sentEvents = new Set<string>()
const BACKEND_EVENTS = new Set(['business_cta_click'])
const SESSION_STORAGE_KEY = 'maka_analytics_session_id'

function createSessionId() {
  if (typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID()
  }

  const randomBytes = new Uint8Array(16)
  window.crypto.getRandomValues(randomBytes)
  return Array.from(randomBytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function getSessionId() {
  try {
    const existingSessionId = window.sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (existingSessionId) return existingSessionId

    const sessionId = createSessionId()
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId)
    return sessionId
  } catch {
    return createSessionId()
  }
}

function recordBackendEvent(event: string, payload: AnalyticsPayload) {
  if (!BACKEND_EVENTS.has(event)) return

  const body = JSON.stringify({
    event,
    occurredAt: new Date().toISOString(),
    page: `${window.location.pathname}${window.location.search}`,
    referrer: document.referrer || undefined,
    sessionId: getSessionId(),
    payload,
  })

  if (navigator.sendBeacon?.('/api/analytics/events', body)) return

  void fetch('/api/analytics/events', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json' },
    keepalive: true,
  }).catch(() => undefined)
}

export function trackEvent(
  event: string,
  payload: AnalyticsPayload = {},
  onceKey?: string,
) {
  if (typeof window === 'undefined') return

  if (onceKey) {
    if (sentEvents.has(onceKey)) return
    sentEvents.add(onceKey)
  }

  const detail = { event, ...payload }
  window.dataLayer = window.dataLayer ?? []
  window.dataLayer.push(detail)
  window.gtag?.('event', event, payload)
  window.dispatchEvent(new CustomEvent('maka:analytics', { detail }))
  recordBackendEvent(event, payload)
}
