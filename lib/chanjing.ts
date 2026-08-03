const DEFAULT_LOCAL_PROXY_URL = 'http://localhost:8787/api/chanjing/video'

export type ChanjingSubmissionResult = {
  accepted: boolean
  proxyStatus: number
  trackingAvailable: false
}

export class ChanjingProxyError extends Error {
  status: number
  retryable: boolean

  constructor(message: string, status = 503, retryable = true) {
    super(message)
    this.name = 'ChanjingProxyError'
    this.status = status
    this.retryable = retryable
  }
}

export async function submitToLocalChanjingProxy(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ChanjingSubmissionResult> {
  const proxyUrl = process.env.CHANJING_LOCAL_PROXY_URL ?? DEFAULT_LOCAL_PROXY_URL
  let response: Response

  try {
    response = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
      signal,
    })
  } catch {
    throw new ChanjingProxyError(
      '无法连接本地蝉镜代理，请确认 http://localhost:8787/api/chanjing/video 已启动。',
    )
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500
    throw new ChanjingProxyError(
      `本地蝉镜代理返回 HTTP ${response.status}。`,
      response.status,
      retryable,
    )
  }

  return {
    accepted: true,
    proxyStatus: response.status,
    trackingAvailable: false,
  }
}
