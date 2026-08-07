import { chapters } from '@/data/robots'
import { validateJourneyMedia } from '@/lib/validate-journey-media'
import type { JourneyMediaSegment } from '@/types/robot'

const mediaSource = (name: string) => process.env[`NEXT_PUBLIC_MEDIA_${name}`] || undefined
const MOBILE_COMPATIBILITY_CACHE_VERSION = '20260807-main40'
const VERSIONED_MOBILE_VIDEO_IDS = new Set([
  'dive-town',
  'connector-little-devil-to-biker-rabbit',
  'dive-biker-rabbit',
  'connector-biker-rabbit-to-pipi',
  'dive-pipi',
])
const productionVideo = (format: 'desktop' | 'mobile', id: string) => {
  const source = `/media/journey/${format}/${id}.mp4`
  return format === 'mobile' && VERSIONED_MOBILE_VIDEO_IDS.has(id)
    ? `${source}?v=${MOBILE_COMPATIBILITY_CACHE_VERSION}`
    : source
}
const productionPoster = (format: 'desktop' | 'mobile', id: string) =>
  `/images/scenes/journey-posters/${format}/${id}.jpg`
const productionMedia = (id: string) => ({
  videoDesktop: mediaSource(`${id.replaceAll('-', '_').toUpperCase()}_DESKTOP`)
    || productionVideo('desktop', id),
  videoMobile: mediaSource(`${id.replaceAll('-', '_').toUpperCase()}_MOBILE`)
    || productionVideo('mobile', id),
  posterDesktop: productionPoster('desktop', id),
  posterMobile: productionPoster('mobile', id),
})

export const journeySegments: JourneyMediaSegment[] = [
  {
    id: 'dive-town',
    kind: 'dive-in',
    chapterIndex: 0,
    ...productionMedia('dive-town'),
    scrollWeight: chapters[0].scrollWeight,
    linger: chapters[0].linger,
  },
  {
    id: 'connector-town-to-jiuka',
    kind: 'connector',
    chapterIndex: 0,
    nextChapterIndex: 1,
    ...productionMedia('connector-town-to-jiuka'),
    scrollWeight: 0.75,
  },
  {
    id: 'dive-jiuka',
    kind: 'dive-in',
    chapterIndex: 1,
    ...productionMedia('dive-jiuka'),
    scrollWeight: chapters[1].scrollWeight,
    linger: chapters[1].linger,
  },
  {
    id: 'connector-jiuka-to-little-devil',
    kind: 'connector',
    chapterIndex: 1,
    nextChapterIndex: 2,
    ...productionMedia('connector-jiuka-to-little-devil'),
    scrollWeight: 0.75,
  },
  {
    id: 'dive-little-devil',
    kind: 'dive-in',
    chapterIndex: 2,
    ...productionMedia('dive-little-devil'),
    scrollWeight: chapters[2].scrollWeight,
    linger: chapters[2].linger,
  },
  {
    id: 'connector-little-devil-to-biker-rabbit',
    kind: 'connector',
    chapterIndex: 2,
    nextChapterIndex: 3,
    ...productionMedia('connector-little-devil-to-biker-rabbit'),
    scrollWeight: 0.75,
  },
  {
    id: 'dive-biker-rabbit',
    kind: 'dive-in',
    chapterIndex: 3,
    ...productionMedia('dive-biker-rabbit'),
    scrollWeight: chapters[3].scrollWeight,
    linger: chapters[3].linger,
  },
  {
    id: 'connector-biker-rabbit-to-pipi',
    kind: 'connector',
    chapterIndex: 3,
    nextChapterIndex: 4,
    ...productionMedia('connector-biker-rabbit-to-pipi'),
    scrollWeight: 0.75,
  },
  {
    id: 'dive-pipi',
    kind: 'dive-in',
    chapterIndex: 4,
    ...productionMedia('dive-pipi'),
    scrollWeight: chapters[4].scrollWeight,
    linger: chapters[4].linger,
    autoAdvance: true,
  },
  {
    id: 'connector-pipi-to-reunion',
    kind: 'connector',
    chapterIndex: 4,
    nextChapterIndex: 5,
    ...productionMedia('connector-pipi-to-reunion'),
    scrollWeight: 0.75,
  },
  {
    id: 'dive-reunion',
    kind: 'dive-in',
    chapterIndex: 5,
    ...productionMedia('dive-reunion'),
    scrollWeight: chapters[5].scrollWeight,
    linger: chapters[5].linger,
  },
]

export const journeyMediaIssues = validateJourneyMedia(journeySegments)

if (process.env.NODE_ENV !== 'production' && journeyMediaIssues.length > 0) {
  console.error('[journey-media]', journeyMediaIssues.join('\n'))
}
