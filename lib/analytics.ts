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
}
