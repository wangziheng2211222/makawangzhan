import { HomeExperience } from '@/components/HomeExperience'
import { journeySegments } from '@/data/journey-media'
import { chapters, robots } from '@/data/robots'

export default function HomePage() {
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
