import type { JourneyMediaSegment } from '../types/robot'

export type SegmentTimelineEntry = JourneyMediaSegment & {
  index: number
  start: number
  end: number
}

export type SegmentFrame = {
  index: number
  id: JourneyMediaSegment['id']
  opacity: number
  localProgress: number
  mediaProgress: number
}

export type ChapterFrame = {
  opacity: number
  progress: number
}

export type JourneyFrame = {
  progress: number
  weightedPosition: number
  activeSegmentIndex: number
  activeChapterIndex: number
  localProgress: number
  segments: SegmentFrame[]
  chapters: ChapterFrame[]
}

export function clamp(value: number) {
  return Math.min(Math.max(value, 0), 1)
}

export function getTownCopyOpacity(progress: number) {
  return 1 - clamp((progress - 0.38) / 0.14)
}

export function getRobotCopyOpacity(progress: number) {
  return clamp((progress - 0.05) / 0.1)
}

export function getBikerRabbitCopyOpacity(progress: number) {
  return clamp((progress - 0.82) / 0.12)
}

export function getPipiCopyOpacity(progress: number) {
  return clamp((progress - 0.35) / 0.12)
}

export function lingerEase(progress: number, linger = 0) {
  const amount = clamp(linger)
  const centered = clamp(progress) - 0.5
  return clamp((1 - amount) * progress + amount * (4 * centered ** 3 + 0.5))
}

export function buildSegmentTimeline(segments: JourneyMediaSegment[]) {
  let offset = 0
  const entries = segments.map((segment, index): SegmentTimelineEntry => {
    const entry = {
      ...segment,
      index,
      start: offset,
      end: offset + segment.scrollWeight,
    }
    offset = entry.end
    return entry
  })

  return { entries, totalWeight: offset }
}

export function findConnectorSegmentIndex(
  segments: JourneyMediaSegment[],
  chapterIndex: number,
) {
  return segments.findIndex(
    (segment) => segment.kind === 'connector' && segment.chapterIndex === chapterIndex,
  )
}

export function getRequiredChapterAdvanceSegments(
  segments: JourneyMediaSegment[],
  chapterIndex: number,
) {
  const connectorIndex = findConnectorSegmentIndex(segments, chapterIndex)
  if (connectorIndex < 0) return []

  let endExclusive = connectorIndex + 2
  while (
    endExclusive < segments.length
    && segments[endExclusive - 1]?.autoAdvance === true
  ) {
    endExclusive += 2
  }
  return segments.slice(connectorIndex, endExclusive)
}

function getEntryLocalProgress(entry: SegmentTimelineEntry, position: number) {
  return clamp((position - entry.start) / entry.scrollWeight)
}

/** Small overlap (in scroll-weight units) so the outgoing segment fades out
 *  while the incoming segment is already visible — prevents black flash. */
const SEGMENT_CROSSFADE_WEIGHT = 0.04

function getSegmentOpacity(
  entries: SegmentTimelineEntry[],
  index: number,
  position: number,
) {
  const entry = entries[index]
  const includesEnd = index === entries.length - 1

  // Fully visible during own range
  if (position >= entry.start && (position < entry.end || (includesEnd && position <= entry.end))) {
    return 1
  }

  // Crossfade tail: stays partially visible just after end so the next
  // segment's video has time to show its first frame before this one disappears.
  if (!includesEnd && position > entry.end && position < entry.end + SEGMENT_CROSSFADE_WEIGHT) {
    return 1 - clamp((position - entry.end) / SEGMENT_CROSSFADE_WEIGHT)
  }

  return 0
}

export function getJourneyFrame(
  progress: number,
  segments: JourneyMediaSegment[],
  chapterCount: number,
): JourneyFrame {
  const normalizedProgress = clamp(progress)
  const { entries, totalWeight } = buildSegmentTimeline(segments)
  const position = normalizedProgress * totalWeight
  let activeSegmentIndex = entries.length - 1

  for (const entry of entries) {
    if (position < entry.end || entry.index === entries.length - 1) {
      activeSegmentIndex = entry.index
      break
    }
  }

  const segmentFrames: SegmentFrame[] = []
  const chapterFrames: ChapterFrame[] = Array.from(
    { length: chapterCount },
    () => ({ opacity: 0, progress: 0 }),
  )

  for (const entry of entries) {
    const opacity = getSegmentOpacity(entries, entry.index, position)
    if (opacity <= 0) continue

    const localProgress = normalizedProgress === 1 && entry.index === entries.length - 1
      ? 1
      : getEntryLocalProgress(entry, position)
    const mediaProgress = entry.kind === 'dive-in'
      ? lingerEase(localProgress, entry.linger)
      : localProgress

    segmentFrames.push({
      index: entry.index,
      id: entry.id,
      opacity,
      localProgress,
      mediaProgress,
    })

    if (entry.kind === 'dive-in') {
      const chapterFrame = chapterFrames[entry.chapterIndex]
      chapterFrame.opacity += opacity
      chapterFrame.progress = Math.max(chapterFrame.progress, mediaProgress)
      continue
    }

    const nextChapterIndex = entry.nextChapterIndex ?? entry.chapterIndex
    const chapterMix = localProgress >= 0.5 ? 1 : 0
    const fromOpacity = opacity * (1 - chapterMix)
    const toOpacity = opacity * chapterMix
    chapterFrames[entry.chapterIndex].opacity += fromOpacity
    chapterFrames[entry.chapterIndex].progress = Math.max(
      chapterFrames[entry.chapterIndex].progress,
      localProgress,
    )
    chapterFrames[nextChapterIndex].opacity += toOpacity
    chapterFrames[nextChapterIndex].progress = Math.max(
      chapterFrames[nextChapterIndex].progress,
      localProgress,
    )
  }

  let activeChapterIndex = 0
  let highestChapterOpacity = -1
  chapterFrames.forEach((chapter, index) => {
    chapter.opacity = clamp(chapter.opacity)
    if (chapter.opacity > highestChapterOpacity) {
      highestChapterOpacity = chapter.opacity
      activeChapterIndex = index
    }
  })

  const activeFrame = segmentFrames.find((frame) => frame.index === activeSegmentIndex)

  return {
    progress: normalizedProgress,
    weightedPosition: position,
    activeSegmentIndex,
    activeChapterIndex,
    localProgress: activeFrame?.localProgress ?? 0,
    segments: segmentFrames,
    chapters: chapterFrames,
  }
}
