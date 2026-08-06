export type RobotId = 'jiuka' | 'little-devil' | 'biker-rabbit' | 'pipi'

export type RobotAvailability = 'available' | 'preorder' | 'coming-soon'

export type RobotProfile = {
  id: RobotId
  name: string
  englishName: string
  archetype: string
  personalityTraits: string[]
  originStory: string
  storyConflict: string
  storyAbility: string
  catchphrase: string
  likes: string[]
  fears: string[]
  relationships?: string[]
  productCapability?: string
  productProof?: string
  audience?: string
  accent: string
  productImage: string
  chapterVideoDesktop?: string
  chapterVideoMobile?: string
  ctaLabel?: string
  ctaHref?: string
  availability?: RobotAvailability
}

export type JourneyChapterId = 'town' | RobotId | 'reunion'

export type JourneyChapter = {
  id: JourneyChapterId
  name: string
  title: string
  description?: string
  accent: string
  videoDesktop?: string
  videoMobile?: string
  scrollWeight: number
  linger?: number
  robotId?: RobotId
}

export type JourneySegmentId =
  | 'dive-town'
  | 'connector-town-to-jiuka'
  | 'dive-jiuka'
  | 'connector-jiuka-to-little-devil'
  | 'dive-little-devil'
  | 'connector-little-devil-to-biker-rabbit'
  | 'dive-biker-rabbit'
  | 'connector-biker-rabbit-to-pipi'
  | 'dive-pipi'
  | 'connector-pipi-to-reunion'
  | 'dive-reunion'

export type JourneyMediaSegment = {
  id: JourneySegmentId
  kind: 'dive-in' | 'connector'
  chapterIndex: number
  nextChapterIndex?: number
  videoDesktop?: string
  videoMobile?: string
  posterDesktop?: string
  posterMobile?: string
  scrollWeight: number
  linger?: number
}
