import type {
  JourneyMediaSegment,
  JourneySegmentId,
} from '@/types/robot'

const EXPECTED_IDS: JourneySegmentId[] = [
  'dive-town',
  'connector-town-to-jiuka',
  'dive-jiuka',
  'connector-jiuka-to-little-devil',
  'dive-little-devil',
  'connector-little-devil-to-biker-rabbit',
  'dive-biker-rabbit',
  'connector-biker-rabbit-to-pipi',
  'dive-pipi',
  'connector-pipi-to-reunion',
  'dive-reunion',
]

export function validateJourneyMedia(segments: JourneyMediaSegment[]) {
  const issues: string[] = []
  const sourceOwners = new Map<string, string>()

  if (segments.length !== EXPECTED_IDS.length) {
    issues.push(`Expected ${EXPECTED_IDS.length} journey segments, received ${segments.length}.`)
  }

  EXPECTED_IDS.forEach((id, index) => {
    if (segments[index]?.id !== id) {
      issues.push(`Segment ${index + 1} must be ${id}, received ${segments[index]?.id ?? 'missing'}.`)
    }
  })

  segments.forEach((segment, index) => {
    const expectedKind = index % 2 === 0 ? 'dive-in' : 'connector'
    if (segment.kind !== expectedKind) {
      issues.push(`${segment.id} must be a ${expectedKind} segment.`)
    }
    if (segment.scrollWeight <= 0) {
      issues.push(`${segment.id} must have a positive scrollWeight.`)
    }
    for (const [asset, source] of [
      ['desktop video', segment.videoDesktop],
      ['mobile video', segment.videoMobile],
      ['desktop poster', segment.posterDesktop],
      ['mobile poster', segment.posterMobile],
    ] as const) {
      if (!source) {
        issues.push(`${segment.id} is missing its ${asset} source.`)
        continue
      }
      const owner = sourceOwners.get(source)
      if (owner) issues.push(`${source} is reused by ${owner} and ${segment.id}:${asset}.`)
      sourceOwners.set(source, `${segment.id}:${asset}`)
    }
  })

  return issues
}
