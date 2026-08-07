const TARGET_TIME_TOLERANCE_SECONDS = 1 / 24
const PLAYBACK_END_TOLERANCE_SECONDS = 3 / 24
const PLAYBACK_START_FALLBACK_MS = 1_500
const PLAYBACK_START_PROGRESS_EPSILON_SECONDS = 1 / 1000

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

type JourneyVideoLoadState = {
  networkState: number
  readyState: number
}

type JourneyVideoPlaybackReadiness = Pick<
  JourneyVideoReadiness,
  'dataset' | 'error' | 'readyState'
>

export type JourneyChapterAdvanceStatus = 'loading' | 'failed' | null

type JourneyVideoPlaybackStart = {
  currentTime: number
  error: unknown
  paused: boolean
  readyState: number
  seeking: boolean
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

export function canStartJourneyVideoPlayback(video: JourneyVideoPlaybackReadiness) {
  return video.readyState >= 2
    && !video.error
    && video.dataset.failed !== 'true'
}

export function isJourneySegmentReadyForPlayback(
  mobile: boolean,
  preloadReady: boolean,
  video?: JourneyVideoPlaybackReadiness,
) {
  if (video) return canStartJourneyVideoPlayback(video)
  return !mobile && preloadReady
}

export function getJourneyChapterAdvanceButtonState(
  preloadReady: boolean,
  status: JourneyChapterAdvanceStatus,
) {
  const busy = !preloadReady || status === 'loading'
  return {
    busy,
    disabled: busy,
    label: status === 'failed' ? '重试' : '下一个',
  }
}

export function shouldRequestJourneyVideoLoad(
  video: JourneyVideoLoadState,
  force = false,
) {
  if (force) return true
  return video.readyState < 2 && (
    video.networkState === 0
    || video.networkState === 1
  )
}

export function shouldFallbackToManualJourneyVideoPlayback(
  video: JourneyVideoPlaybackStart,
  playbackStartTime: number,
  elapsedMs: number,
) {
  return elapsedMs >= PLAYBACK_START_FALLBACK_MS
    && video.readyState >= 3
    && !video.paused
    && !video.seeking
    && !video.error
    && video.currentTime <= playbackStartTime + PLAYBACK_START_PROGRESS_EPSILON_SECONDS
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
