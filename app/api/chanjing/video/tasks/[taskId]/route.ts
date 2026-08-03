import { NextResponse } from 'next/server'

export function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json(
    {
      error: 'tracking_contract_unavailable',
      message: '等待蝉镜实时文档确认任务状态、结果和下载字段后再启用跟踪。',
    },
    { status: 501 },
  )
}
