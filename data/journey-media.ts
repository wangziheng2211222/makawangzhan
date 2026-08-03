import { chapters } from '@/data/robots'
import { validateJourneyMedia } from '@/lib/validate-journey-media'
import type { JourneyMediaSegment } from '@/types/robot'

const mediaSource = (name: string) => process.env[`NEXT_PUBLIC_MEDIA_${name}`] || undefined
const productionVideo = (format: 'desktop' | 'mobile', id: string) =>
  `/media/journey/${format}/${id}.mp4`

export const journeySegments: JourneyMediaSegment[] = [
  {
    id: 'dive-town',
    kind: 'dive-in',
    chapterIndex: 0,
    posterDesktop: chapters[0].posterDesktop,
    posterMobile: chapters[0].posterMobile,
    videoDesktop: mediaSource('DIVE_TOWN_DESKTOP') || productionVideo('desktop', 'dive-town'),
    videoMobile: mediaSource('DIVE_TOWN_MOBILE') || productionVideo('mobile', 'dive-town'),
    scrollWeight: chapters[0].scrollWeight,
    linger: chapters[0].linger,
  },
  {
    id: 'connector-town-to-jiuka',
    kind: 'connector',
    chapterIndex: 0,
    nextChapterIndex: 1,
    posterDesktop: chapters[1].posterDesktop,
    posterMobile: chapters[1].posterMobile,
    videoDesktop: mediaSource('CONNECTOR_TOWN_TO_JIUKA_DESKTOP') || productionVideo('desktop', 'connector-town-to-jiuka'),
    videoMobile: mediaSource('CONNECTOR_TOWN_TO_JIUKA_MOBILE') || productionVideo('mobile', 'connector-town-to-jiuka'),
    scrollWeight: 0.75,
  },
  {
    id: 'dive-jiuka',
    kind: 'dive-in',
    chapterIndex: 1,
    posterDesktop: chapters[1].posterDesktop,
    posterMobile: chapters[1].posterMobile,
    videoDesktop: mediaSource('DIVE_JIUKA_DESKTOP') || productionVideo('desktop', 'dive-jiuka'),
    videoMobile: mediaSource('DIVE_JIUKA_MOBILE') || productionVideo('mobile', 'dive-jiuka'),
    scrollWeight: chapters[1].scrollWeight,
    linger: chapters[1].linger,
  },
  {
    id: 'connector-jiuka-to-little-devil',
    kind: 'connector',
    chapterIndex: 1,
    nextChapterIndex: 2,
    posterDesktop: chapters[2].posterDesktop,
    posterMobile: chapters[2].posterMobile,
    videoDesktop: mediaSource('CONNECTOR_JIUKA_TO_LITTLE_DEVIL_DESKTOP') || productionVideo('desktop', 'connector-jiuka-to-little-devil'),
    videoMobile: mediaSource('CONNECTOR_JIUKA_TO_LITTLE_DEVIL_MOBILE') || productionVideo('mobile', 'connector-jiuka-to-little-devil'),
    scrollWeight: 0.75,
  },
  {
    id: 'dive-little-devil',
    kind: 'dive-in',
    chapterIndex: 2,
    posterDesktop: chapters[2].posterDesktop,
    posterMobile: chapters[2].posterMobile,
    videoDesktop: mediaSource('DIVE_LITTLE_DEVIL_DESKTOP') || productionVideo('desktop', 'dive-little-devil'),
    videoMobile: mediaSource('DIVE_LITTLE_DEVIL_MOBILE') || productionVideo('mobile', 'dive-little-devil'),
    scrollWeight: chapters[2].scrollWeight,
    linger: chapters[2].linger,
  },
  {
    id: 'connector-little-devil-to-biker-rabbit',
    kind: 'connector',
    chapterIndex: 2,
    nextChapterIndex: 3,
    posterDesktop: chapters[3].posterDesktop,
    posterMobile: chapters[3].posterMobile,
    videoDesktop: mediaSource('CONNECTOR_LITTLE_DEVIL_TO_BIKER_RABBIT_DESKTOP') || productionVideo('desktop', 'connector-little-devil-to-biker-rabbit'),
    videoMobile: mediaSource('CONNECTOR_LITTLE_DEVIL_TO_BIKER_RABBIT_MOBILE') || productionVideo('mobile', 'connector-little-devil-to-biker-rabbit'),
    scrollWeight: 0.75,
  },
  {
    id: 'dive-biker-rabbit',
    kind: 'dive-in',
    chapterIndex: 3,
    posterDesktop: chapters[3].posterDesktop,
    posterMobile: chapters[3].posterMobile,
    videoDesktop: mediaSource('DIVE_BIKER_RABBIT_DESKTOP') || productionVideo('desktop', 'dive-biker-rabbit'),
    videoMobile: mediaSource('DIVE_BIKER_RABBIT_MOBILE') || productionVideo('mobile', 'dive-biker-rabbit'),
    scrollWeight: chapters[3].scrollWeight,
    linger: chapters[3].linger,
  },
  {
    id: 'connector-biker-rabbit-to-pipi',
    kind: 'connector',
    chapterIndex: 3,
    nextChapterIndex: 4,
    posterDesktop: chapters[4].posterDesktop,
    posterMobile: chapters[4].posterMobile,
    videoDesktop: mediaSource('CONNECTOR_BIKER_RABBIT_TO_PIPI_DESKTOP') || productionVideo('desktop', 'connector-biker-rabbit-to-pipi'),
    videoMobile: mediaSource('CONNECTOR_BIKER_RABBIT_TO_PIPI_MOBILE') || productionVideo('mobile', 'connector-biker-rabbit-to-pipi'),
    scrollWeight: 0.75,
  },
  {
    id: 'dive-pipi',
    kind: 'dive-in',
    chapterIndex: 4,
    posterDesktop: chapters[4].posterDesktop,
    posterMobile: chapters[4].posterMobile,
    videoDesktop: mediaSource('DIVE_PIPI_DESKTOP') || productionVideo('desktop', 'dive-pipi'),
    videoMobile: mediaSource('DIVE_PIPI_MOBILE') || productionVideo('mobile', 'dive-pipi'),
    scrollWeight: chapters[4].scrollWeight,
    linger: chapters[4].linger,
  },
  {
    id: 'connector-pipi-to-reunion',
    kind: 'connector',
    chapterIndex: 4,
    nextChapterIndex: 5,
    posterDesktop: chapters[5].posterDesktop,
    posterMobile: chapters[5].posterMobile,
    videoDesktop: mediaSource('CONNECTOR_PIPI_TO_REUNION_DESKTOP') || productionVideo('desktop', 'connector-pipi-to-reunion'),
    videoMobile: mediaSource('CONNECTOR_PIPI_TO_REUNION_MOBILE') || productionVideo('mobile', 'connector-pipi-to-reunion'),
    scrollWeight: 0.75,
  },
  {
    id: 'dive-reunion',
    kind: 'dive-in',
    chapterIndex: 5,
    posterDesktop: chapters[5].posterDesktop,
    posterMobile: chapters[5].posterMobile,
    videoDesktop: mediaSource('DIVE_REUNION_DESKTOP') || productionVideo('desktop', 'dive-reunion'),
    videoMobile: mediaSource('DIVE_REUNION_MOBILE') || productionVideo('mobile', 'dive-reunion'),
    scrollWeight: chapters[5].scrollWeight,
    linger: chapters[5].linger,
  },
]

export const journeyMediaIssues = validateJourneyMedia(journeySegments)

if (process.env.NODE_ENV !== 'production' && journeyMediaIssues.length > 0) {
  console.error('[journey-media]', journeyMediaIssues.join('\n'))
}
