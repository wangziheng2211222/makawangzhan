'use client'

import { TownJourney } from '@/components/TownJourney'
import type {
  JourneyChapter,
  JourneyMediaSegment,
  RobotProfile,
} from '@/types/robot'

type HomeExperienceProps = {
  chapters: JourneyChapter[]
  journeySegments: JourneyMediaSegment[]
  robots: RobotProfile[]
}

export function HomeExperience({
  chapters,
  journeySegments,
  robots,
}: HomeExperienceProps) {
  return (
    <TownJourney
      chapters={chapters}
      segments={journeySegments}
      robots={robots}
    />
  )
}
