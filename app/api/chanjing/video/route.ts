import { NextResponse } from 'next/server'

import {
  ChanjingProxyError,
  submitToLocalChanjingProxy,
} from '@/lib/chanjing'

function unavailableInProduction() {
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production') return unavailableInProduction()

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
  }

  try {
    const result = await submitToLocalChanjingProxy(
      payload as Record<string, unknown>,
      request.signal,
    )
    return NextResponse.json(result, { status: 202 })
  } catch (error) {
    if (error instanceof ChanjingProxyError) {
      return NextResponse.json(
        {
          error: 'local_proxy_error',
          message: error.message,
          retryable: error.retryable,
        },
        { status: error.status },
      )
    }
    return NextResponse.json({ error: 'submission_failed' }, { status: 500 })
  }
}

export function GET() {
  return unavailableInProduction()
}
