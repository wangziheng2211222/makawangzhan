import { timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'

import { getAnalyticsStats } from '@/lib/server/analytics-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function tokensMatch(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer)
}

export async function GET(request: Request) {
  const configuredToken = process.env.ANALYTICS_ADMIN_TOKEN?.trim()
  if (!configuredToken && process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'analytics_admin_token_not_configured' },
      { status: 503 },
    )
  }

  if (configuredToken) {
    const authorization = request.headers.get('authorization') ?? ''
    const providedToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : ''
    if (!tokensMatch(providedToken, configuredToken)) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  try {
    const stats = await getAnalyticsStats()
    return NextResponse.json(stats, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    console.error('Failed to read analytics stats', error)
    return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 })
  }
}
