import { preload } from 'react-dom'

import { HomeExperience } from '@/components/HomeExperience'
import { journeySegments } from '@/data/journey-media'
import { chapters, robots } from '@/data/robots'
import {
  DESKTOP_JOURNEY_MEDIA_QUERY,
  MOBILE_JOURNEY_MEDIA_QUERY,
} from '@/lib/journey-media-query'

function preloadInitialJourneyVideo() {
  const initialSegment = journeySegments[0]

  if (initialSegment.videoDesktop) {
    preload(initialSegment.videoDesktop, {
      as: 'fetch',
      crossOrigin: 'anonymous',
      fetchPriority: 'high',
      media: DESKTOP_JOURNEY_MEDIA_QUERY,
      type: 'video/mp4',
    })
  }

  if (initialSegment.videoMobile) {
    preload(initialSegment.videoMobile, {
      as: 'fetch',
      crossOrigin: 'anonymous',
      fetchPriority: 'high',
      media: MOBILE_JOURNEY_MEDIA_QUERY,
      type: 'video/mp4',
    })
  }
}

export default function HomePage() {
  preloadInitialJourneyVideo()

  return (
    <main>
      <HomeExperience
        chapters={chapters}
        journeySegments={journeySegments}
        robots={robots}
      />
    </main>
  )
}
