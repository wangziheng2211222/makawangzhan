const TARGET_TIME_TOLERANCE_SECONDS = 1 / 24
const PLAYBACK_END_TOLERANCE_SECONDS = 3 / 24

type JourneyVideoReadiness = {
  currentTime: number
  readyState: number
  seeking: boolean
  error: unknown
  dataset: {
    failed?: string
    ready?: string
  }
}

type JourneyVideoPlayback = {
  currentTime: number
  duration: number
  ended: boolean
  paused: boolean
}

export function canShowJourneyVideo(
  video: JourneyVideoReadiness,
  targetTime: number,
) {
  return video.readyState >= 2
    && !video.seeking
    && !video.error
    && video.dataset.failed !== 'true'
    && Math.abs(video.currentTime - targetTime) <= TARGET_TIME_TOLERANCE_SECONDS
}

export function shouldSeekJourneyVideo(
  video: Pick<JourneyVideoReadiness, 'currentTime' | 'seeking'>,
  targetTime: number,
) {
  return !video.seeking
    && Math.abs(video.currentTime - targetTime) > TARGET_TIME_TOLERANCE_SECONDS
}

export function canRetainJourneyVideoFrame(video: JourneyVideoReadiness) {
  return video.dataset.ready === 'true'
    && video.readyState >= 1
    && !video.error
    && video.dataset.failed !== 'true'
}

export function hasCompletedJourneyVideoPlayback(video: JourneyVideoPlayback) {
  if (video.ended) return true
  if (
    !video.paused
    || !Number.isFinite(video.duration)
    || video.duration <= 0
  ) return false

  return video.duration - video.currentTime <= PLAYBACK_END_TOLERANCE_SECONDS
}

export function shouldResumeJourneyVideoPlayback(video: JourneyVideoPlayback) {
  return video.paused && !hasCompletedJourneyVideoPlayback(video)
}

export function subscribeToMediaQuery(
  mediaQuery: MediaQueryList,
  listener: () => void,
) {
  if (typeof mediaQuery.addEventListener === 'function') {
    mediaQuery.addEventListener('change', listener)
    return () => mediaQuery.removeEventListener('change', listener)
  }

  if (typeof mediaQuery.addListener === 'function') {
    mediaQuery.addListener(listener)
    return () => mediaQuery.removeListener(listener)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', listener)
    return () => window.removeEventListener('resize', listener)
  }

  return () => undefined
}
