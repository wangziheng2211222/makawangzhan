'use client'

import Image from 'next/image'
import { LoaderCircle } from 'lucide-react'
import {
  type CSSProperties,
  type RefCallback,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import {
  JourneyVideoLayer,
  type JourneyPreloadState,
} from '@/components/JourneyVideoLayer'
import { trackEvent } from '@/lib/analytics'
import {
  buildSegmentTimeline,
  clamp,
  findConnectorSegmentIndex,
  getJourneyFrame,
  getRobotCopyOpacity,
  getTownCopyOpacity,
} from '@/lib/journey-timeline'
import {
  canRetainJourneyVideoFrame,
  canShowJourneyVideo,
  hasCompletedJourneyVideoPlayback,
  shouldSeekJourneyVideo,
  shouldResumeJourneyVideoPlayback,
  subscribeToMediaQuery,
} from '@/lib/journey-video-state'
import { MOBILE_JOURNEY_MEDIA_QUERY } from '@/lib/journey-media-query'
import type {
  JourneyChapter,
  JourneyMediaSegment,
  RobotProfile,
} from '@/types/robot'

import styles from './TownJourney.module.css'

type TownJourneyProps = {
  chapters: JourneyChapter[]
  segments: JourneyMediaSegment[]
  robots: RobotProfile[]
}

type JourneyStyle = CSSProperties & {
  '--journey-scroll-units': number
  '--chapter-accent': string
}

type SegmentPlayback = {
  cleanup: () => void
  finish: () => void
  segmentId: JourneyMediaSegment['id']
  video: HTMLVideoElement
}

type MobileGesture = {
  identifier: number
  ignoreDuringPlayback: boolean
  startX: number
  startY: number
}

type WorldIntroCue = {
  endsAt: number
  id: string
  lines: readonly string[]
  startsAt: number
}

const SCRUB_TIME_CONSTANT_MS = 90
const SCRUB_EPSILON = 0.0001
const NEXT_SEGMENT_EAGER_THRESHOLD = 0.72
const MOBILE_SWIPE_THRESHOLD_PX = 44
const WHEEL_GESTURE_IDLE_MS = 180
const SEGMENT_BOUNDARY_ADVANCE_PX = 2
const LOADING_VISUAL_INITIAL_PROGRESS = 0.03
const LOADING_VISUAL_PROGRESS_CAP = 0.9
const LOADING_PROGRESS_READY_CAP = 0.96
const LOADING_PROGRESS_TIME_CONSTANT_MS = 5_000
const RESIDENT_APPLICATION_URL = 'https://doc.weixin.qq.com/forms/AJwAigdDACoAQgA9gbaAIoCNMQdD0GZef_draft'
const WORLD_INTRO_CUES: Partial<Record<JourneyMediaSegment['id'], readonly WorldIntroCue[]>> = {
  'dive-town': [
    {
      id: 'town-greeting',
      lines: ['你好，人类。'],
      startsAt: 0.02,
      endsAt: 0.31,
    },
    {
      id: 'town-welcome',
      lines: ['欢迎来到玛卡小镇。'],
      startsAt: 0.34,
      endsAt: 0.67,
    },
    {
      id: 'quiet-town',
      lines: ['玛卡小镇本来安安静静的。'],
      startsAt: 0.74,
      endsAt: 0.98,
    },
  ],
  'connector-town-to-jiuka': [
    {
      id: 'shimmer-arrives',
      lines: ['直到一颗亮晶晶的碎片，', '飞了进来。'],
      startsAt: 0.04,
      endsAt: 0.3,
    },
    {
      id: 'jiuka-likes-shimmer',
      lines: ['啾咔一看见亮晶晶的东西，', '就走不动路。'],
      startsAt: 0.43,
      endsAt: 0.69,
    },
    {
      id: 'jiuka-enters-lab',
      lines: ['追着追着，', 'TA闯进了巫师的实验室。'],
      startsAt: 0.74,
      endsAt: 0.97,
    },
  ],
  'connector-jiuka-to-little-devil': [
    {
      id: 'shimmer-knocks-potion',
      lines: ['那颗亮晶晶的碎片，', '碰倒了巫师的魔法药水。'],
      startsAt: 0.14,
      endsAt: 0.5,
    },
    {
      id: 'sheep-becomes-little-devil',
      lines: ['药水溅开，', '小绵羊变成了小恶魔。'],
      startsAt: 0.56,
      endsAt: 0.92,
    },
  ],
  'connector-little-devil-to-biker-rabbit': [
    {
      id: 'robber-runs-to-lake',
      lines: ['小镇另一边，', '一个坏蛋正往湖边逃。'],
      startsAt: 0.14,
      endsAt: 0.5,
    },
    {
      id: 'biker-rabbit-chases',
      lines: ['机车兔顾不上腿伤，', '骑上机车就追。'],
      startsAt: 0.56,
      endsAt: 0.92,
    },
  ],
  'dive-biker-rabbit': [
    {
      id: 'biker-rabbit-slides-into-water',
      lines: ['坏蛋跑远了，', '机车兔却滑进了浅水里。'],
      startsAt: 0.25,
      endsAt: 0.58,
    },
    {
      id: 'chase-pauses',
      lines: ['湖边这场追捕，', '只能先停一停。'],
      startsAt: 0.64,
      endsAt: 0.9,
    },
  ],
  'connector-biker-rabbit-to-pipi': [
    {
      id: 'pipi-rehearses',
      lines: ['小镇另一边，', '屁屁还在艺术学院排练。'],
      startsAt: 0.14,
      endsAt: 0.56,
    },
  ],
  'connector-pipi-to-reunion': [
    {
      id: 'pipi-finishes-rehearsal',
      lines: ['屁屁的排练结束了。', '玛卡小镇的一天，也到了晚上。'],
      startsAt: 0.14,
      endsAt: 0.48,
    },
    {
      id: 'town-awaits-residents',
      lines: ['夜晚的小镇，', '正在等待新的居民。'],
      startsAt: 0.58,
      endsAt: 0.92,
    },
  ],
}

function getSegmentPreloadKey(
  segmentId: JourneyMediaSegment['id'],
  mobile: boolean,
) {
  return `${mobile ? 'mobile' : 'desktop'}:${segmentId}`
}

function getWorldIntroCue(
  segmentId: JourneyMediaSegment['id'],
  progress: number,
) {
  const cues = WORLD_INTRO_CUES[segmentId]
  if (!cues) return null

  const normalizedProgress = clamp(progress)
  for (let index = cues.length - 1; index >= 0; index -= 1) {
    const cue = cues[index]
    if (normalizedProgress >= cue.startsAt && normalizedProgress < cue.endsAt) {
      return cue
    }
  }
  return null
}

export function TownJourney({
  chapters,
  segments,
  robots,
}: TownJourneyProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0)
  const [eagerSegmentIndex, setEagerSegmentIndex] = useState<number | null>(null)
  const [hasPassedFirstViewport, setHasPassedFirstViewport] = useState(false)
  const [hasEnteredTown, setHasEnteredTown] = useState(false)
  const [mobile, setMobile] = useState<boolean | null>(null)
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null)
  const [displayedPreloadProgress, setDisplayedPreloadProgress] = useState(
    LOADING_VISUAL_INITIAL_PROGRESS,
  )
  const [fullyLoadedSegmentKeys, setFullyLoadedSegmentKeys] = useState<Set<string>>(
    () => new Set(),
  )
  const [initialMediaReady, setInitialMediaReady] = useState(false)
  const [showLoadingScreen, setShowLoadingScreen] = useState(true)
  const [loadedInitialPosterMode, setLoadedInitialPosterMode] = useState<boolean | null>(null)
  const [videoRevision, setVideoRevision] = useState(0)
  const [worldIntroCue, setWorldIntroCue] = useState<WorldIntroCue | null>(
    () => WORLD_INTRO_CUES['dive-town']?.[0] ?? null,
  )
  const journeyRef = useRef<HTMLElement>(null)
  const sceneRefs = useRef<Array<HTMLElement | null>>([])
  const navRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndexRef = useRef(0)
  const activeSegmentIndexRef = useRef(0)
  const eagerSegmentIndexRef = useRef<number | null>(null)
  const worldIntroCueIdRef = useRef(worldIntroCue?.id ?? null)
  const hasPassedFirstViewportRef = useRef(false)
  const frameRef = useRef<number | null>(null)
  const targetProgressRef = useRef(0)
  const renderedProgressRef = useRef(0)
  const previousFrameTimeRef = useRef<number | null>(null)
  const scrubCallbackRef = useRef<(timestamp: number) => void>(() => undefined)
  const suppressJourneyEventsRef = useRef(false)
  const videoRefs = useRef(new Map<string, HTMLVideoElement>())
  const ambientVideoRef = useRef<HTMLVideoElement | null>(null)
  const fullyLoadedSegmentKeysRef = useRef(new Set<string>())
  const segmentPlaybackRef = useRef<SegmentPlayback | null>(null)
  const playbackSequenceEndIndexRef = useRef<number | null>(null)
  const pendingPlaybackIndexRef = useRef<number | null>(null)
  const mobileGestureRef = useRef<MobileGesture | null>(null)
  const hasCompletedInitialLoadRef = useRef(false)
  const actualPreloadProgressRef = useRef(0)
  const segmentTimeline = useMemo(() => buildSegmentTimeline(segments), [segments])
  const totalScrollWeight = segmentTimeline.totalWeight

  useLayoutEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }

    const resetScrollPosition = () => {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    }
    const resetCachedPage = (event: PageTransitionEvent) => {
      if (event.persisted) resetScrollPosition()
    }
    resetScrollPosition()
    const resetFrame = window.requestAnimationFrame(resetScrollPosition)
    window.addEventListener('pageshow', resetCachedPage)

    return () => {
      window.cancelAnimationFrame(resetFrame)
      window.removeEventListener('pageshow', resetCachedPage)
    }
  }, [])

  const commitActiveIndex = useCallback((nextIndex: number) => {
    if (activeIndexRef.current === nextIndex) return

    const activeScene = sceneRefs.current[activeIndexRef.current]
    if (activeScene?.contains(document.activeElement)) {
      navRefs.current[nextIndex]?.focus({ preventScroll: true })
    }

    activeIndexRef.current = nextIndex
    setActiveIndex(nextIndex)
  }, [])

  const commitActiveSegmentIndex = useCallback((nextIndex: number) => {
    if (activeSegmentIndexRef.current === nextIndex) return
    activeSegmentIndexRef.current = nextIndex
    setActiveSegmentIndex(nextIndex)
  }, [])

  const cancelSegmentPlayback = useCallback((segmentId?: string) => {
    const playback = segmentPlaybackRef.current
    if (segmentId && playback?.segmentId !== segmentId) return
    playbackSequenceEndIndexRef.current = null
    if (!playback) return
    segmentPlaybackRef.current = null
    playback.cleanup()
    playback.video.pause()
  }, [])

  const registerVideo = useCallback(
    (segmentId: string, video: HTMLVideoElement | null) => {
      if (!video) {
        cancelSegmentPlayback(segmentId)
        videoRefs.current.delete(segmentId)
        return
      }
      videoRefs.current.set(segmentId, video)
      setVideoRevision((revision) => revision + 1)
    },
    [cancelSegmentPlayback],
  )

  const registerAmbientVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      ambientVideoRef.current = video
    },
    [],
  )

  const handlePreloadStateChange = useCallback((state: JourneyPreloadState) => {
    if (hasCompletedInitialLoadRef.current) return
    const actualProgress = state.ready
      ? 1
      : Math.min(state.progress, LOADING_PROGRESS_READY_CAP)
    actualPreloadProgressRef.current = actualProgress
    if (!state.ready) {
      setDisplayedPreloadProgress((current) => Math.max(current, actualProgress))
    }
    if (!state.ready) return

    hasCompletedInitialLoadRef.current = true
    setDisplayedPreloadProgress(1)
    setInitialMediaReady(true)
  }, [])

  const handleSegmentPreloadStateChange = useCallback((
    segmentId: JourneyMediaSegment['id'],
    segmentMobile: boolean,
    ready: boolean,
  ) => {
    const key = getSegmentPreloadKey(segmentId, segmentMobile)
    const current = fullyLoadedSegmentKeysRef.current
    if (current.has(key) === ready) return

    const next = new Set(current)
    if (ready) next.add(key)
    else next.delete(key)
    fullyLoadedSegmentKeysRef.current = next
    setFullyLoadedSegmentKeys(next)
  }, [])

  const renderJourneyFrame = useCallback((progress: number) => {
    const journey = journeyRef.current
    if (!journey || reducedMotion !== false) return

    const nextHasPassedFirstViewport = progress * totalScrollWeight >= 1
    if (hasPassedFirstViewportRef.current !== nextHasPassedFirstViewport) {
      hasPassedFirstViewportRef.current = nextHasPassedFirstViewport
      setHasPassedFirstViewport(nextHasPassedFirstViewport)
    }

    const journeyFrame = getJourneyFrame(progress, segments, chapters.length)
    const segment = segments[journeyFrame.activeSegmentIndex]
    const chapter = chapters[journeyFrame.activeChapterIndex]
    const nextEagerSegmentIndex = journeyFrame.localProgress >= NEXT_SEGMENT_EAGER_THRESHOLD
      && journeyFrame.activeSegmentIndex < segments.length - 1
      ? journeyFrame.activeSegmentIndex + 1
      : null
    if (eagerSegmentIndexRef.current !== nextEagerSegmentIndex) {
      eagerSegmentIndexRef.current = nextEagerSegmentIndex
      setEagerSegmentIndex(nextEagerSegmentIndex)
    }
    const nextWorldIntroCue = getWorldIntroCue(segment.id, journeyFrame.localProgress)
    const nextWorldIntroCueId = nextWorldIntroCue?.id ?? null
    if (worldIntroCueIdRef.current !== nextWorldIntroCueId) {
      worldIntroCueIdRef.current = nextWorldIntroCueId
      setWorldIntroCue(nextWorldIntroCue)
    }
    const townFrame = journeyFrame.segments.find((frame) => frame.id === 'dive-town')
    const spacePhase = townFrame
      ? 1 - clamp((townFrame.mediaProgress - 0.34) / 0.08)
      : 0

    journey.style.setProperty('--segment-progress', journeyFrame.localProgress.toFixed(4))
    journey.style.setProperty('--town-space-phase', spacePhase.toFixed(4))
    const mobileBoundary = progress <= SCRUB_EPSILON
      ? 'start'
      : progress >= 1 - SCRUB_EPSILON
        ? 'end'
        : 'inside'
    if (journey.dataset.mobileBoundary !== mobileBoundary) {
      journey.dataset.mobileBoundary = mobileBoundary
    }
    commitActiveSegmentIndex(journeyFrame.activeSegmentIndex)
    commitActiveIndex(journeyFrame.activeChapterIndex)

    const visibleSegments = new Map(
      journeyFrame.segments.map((frame) => [frame.id, frame]),
    )
    videoRefs.current.forEach((video, segmentId) => {
      const videoFrame = visibleSegments.get(segmentId as JourneyMediaSegment['id'])
      const mediaSlot = video.closest<HTMLElement>('[data-journey-media-slot="true"]')
      const mediaOpacity = (videoFrame?.opacity ?? 0).toFixed(4)
      if (mediaSlot) mediaSlot.style.opacity = mediaOpacity
      else video.style.opacity = mediaOpacity
      if (
        !videoFrame
        || videoFrame.opacity <= 0
        || video.readyState < 1
        || !Number.isFinite(video.duration)
      ) {
        video.dataset.ready = 'false'
        return
      }

      if (segmentPlaybackRef.current?.segmentId === segmentId) {
        const ready = video.readyState >= 2
          && !video.error
          && video.dataset.failed !== 'true'
        if (video.dataset.ready !== String(ready)) {
          video.dataset.ready = String(ready)
        }
        return
      }

      const targetTime = Math.min(
        videoFrame.mediaProgress * video.duration,
        Math.max(video.duration - 0.04, 0),
      )
      const canRetainCurrentFrame = canRetainJourneyVideoFrame(video)
      if (shouldSeekJourneyVideo(video, targetTime)) {
        try {
          video.currentTime = targetTime
        } catch {
          if (!canRetainCurrentFrame) video.dataset.ready = 'false'
        }
        if (!canRetainCurrentFrame) video.dataset.ready = 'false'
      } else if (
        canShowJourneyVideo(video, targetTime)
        || canRetainCurrentFrame
      ) {
        if (video.dataset.ready !== 'true') video.dataset.ready = 'true'
      } else {
        if (video.dataset.ready !== 'false') video.dataset.ready = 'false'
      }
    })

    const ambientVideo = ambientVideoRef.current
    const ambientOpacity = segment.id === 'dive-reunion'
      ? clamp(journeyFrame.localProgress / 0.08)
      : 0
    if (ambientVideo) {
      const mediaSlot = ambientVideo.closest<HTMLElement>('[data-journey-media-slot="true"]')
      const mediaOpacity = ambientOpacity.toFixed(4)
      if (mediaSlot) mediaSlot.style.opacity = mediaOpacity
      else ambientVideo.style.opacity = mediaOpacity
      if (ambientOpacity > 0.001) {
        if (ambientVideo.paused) {
          ambientVideo.currentTime = 0
          ambientVideo.play().catch(() => undefined)
        }
      } else {
        ambientVideo.pause()
        if (ambientVideo.readyState >= 1 && ambientVideo.currentTime > 0) {
          ambientVideo.currentTime = 0
        }
      }
    }

    journeyFrame.chapters.forEach((chapterFrame, index) => {
      const scene = sceneRefs.current[index]
      if (!scene) return
      const fadeIn = index === 0 ? 1 : clamp(chapterFrame.progress / 0.2)
      const fadeOut = index === chapters.length - 1
        ? 1
        : clamp((1 - chapterFrame.progress) / 0.18)
      const isRobotChapter = Boolean(chapters[index].robotId)
      const isActiveRobotDive = segment.kind === 'dive-in'
        && segment.chapterIndex === index
      let copyOpacity = chapterFrame.opacity * Math.min(fadeIn, fadeOut)
      if (index === 0) {
        copyOpacity = chapterFrame.opacity * getTownCopyOpacity(chapterFrame.progress)
      } else if (isRobotChapter) {
        const showsCopyDuringPlayback = chapters[index].id === 'jiuka'
          || chapters[index].id === 'little-devil'
        const waitsForRobotVideo = isActiveRobotDive
          && segmentPlaybackRef.current?.segmentId === segment.id
          && !showsCopyDuringPlayback
        copyOpacity = isActiveRobotDive && !waitsForRobotVideo
          ? chapterFrame.opacity * getRobotCopyOpacity(chapterFrame.progress)
          : 0
      } else if (chapters[index].id === 'reunion') {
        copyOpacity = segment.id === 'dive-reunion'
          ? chapterFrame.opacity * ambientOpacity
          : 0
      }
      const copyShift = (1 - Math.min(copyOpacity, 1)) * 18
      scene.style.setProperty('--scene-opacity', chapterFrame.opacity.toFixed(4))
      scene.style.setProperty('--scene-progress', chapterFrame.progress.toFixed(4))
      scene.style.setProperty('--copy-opacity', copyOpacity.toFixed(4))
      scene.style.setProperty('--copy-shift', `${copyShift.toFixed(2)}px`)
    })

    if (
      !suppressJourneyEventsRef.current
      && segment.kind === 'dive-in'
      && chapter.robotId
      && journeyFrame.localProgress >= 0.5
    ) {
      trackEvent(
        'journey_chapter_view',
        { robot_id: chapter.robotId },
        `chapter:${chapter.robotId}`,
      )
    }

    if (
      !suppressJourneyEventsRef.current
      && segment.kind === 'dive-in'
      && chapter.id === 'reunion'
    ) {
      trackEvent('journey_complete', {}, 'journey:complete')
    }
  }, [
    chapters,
    commitActiveIndex,
    commitActiveSegmentIndex,
    reducedMotion,
    segments,
    totalScrollWeight,
  ])

  const runScrubFrame = useCallback((timestamp: number) => {
    const previousTimestamp = previousFrameTimeRef.current ?? timestamp
    const delta = Math.min(Math.max(timestamp - previousTimestamp, 0), 64)
    previousFrameTimeRef.current = timestamp

    const target = targetProgressRef.current
    const current = renderedProgressRef.current
    const alpha = 1 - Math.exp(-delta / SCRUB_TIME_CONSTANT_MS)
    const next = Math.abs(target - current) < SCRUB_EPSILON
      ? target
      : current + (target - current) * alpha

    renderedProgressRef.current = next
    renderJourneyFrame(next)

    if (Math.abs(target - next) < SCRUB_EPSILON) {
      renderedProgressRef.current = target
      renderJourneyFrame(target)
      frameRef.current = null
      previousFrameTimeRef.current = null
      return
    }

    frameRef.current = window.requestAnimationFrame((nextTimestamp) => {
      scrubCallbackRef.current(nextTimestamp)
    })
  }, [renderJourneyFrame])

  useEffect(() => {
    scrubCallbackRef.current = runScrubFrame
  }, [runScrubFrame])

  const requestJourneyUpdate = useCallback(() => {
    const journey = journeyRef.current
    if (!journey || reducedMotion !== false || segmentPlaybackRef.current) return

    const rect = journey.getBoundingClientRect()
    const scrollableDistance = Math.max(journey.offsetHeight - window.innerHeight, 1)
    targetProgressRef.current = clamp(-rect.top / scrollableDistance)

    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(runScrubFrame)
    }
  }, [reducedMotion, runScrubFrame])

  const handleVideoTimingChange = useCallback(() => {
    setVideoRevision((revision) => revision + 1)
    requestJourneyUpdate()
  }, [requestJourneyUpdate])

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_JOURNEY_MEDIA_QUERY)
    const syncPreference = () => setMobile(mediaQuery.matches)
    syncPreference()
    return subscribeToMediaQuery(mediaQuery, syncPreference)
  }, [])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncPreference = () => setReducedMotion(mediaQuery.matches)
    syncPreference()
    return subscribeToMediaQuery(mediaQuery, syncPreference)
  }, [])

  useLayoutEffect(() => {
    if (!showLoadingScreen) return
    if (initialMediaReady) return

    const startedAt = performance.now()
    let animationFrame: number
    const updateDisplayedProgress = (timestamp: number) => {
      const elapsed = timestamp - startedAt
      const simulatedProgress = LOADING_VISUAL_INITIAL_PROGRESS + (
        LOADING_VISUAL_PROGRESS_CAP - LOADING_VISUAL_INITIAL_PROGRESS
      ) * (
        1 - Math.exp(-elapsed / LOADING_PROGRESS_TIME_CONSTANT_MS)
      )
      const target = Math.min(
        Math.max(simulatedProgress, actualPreloadProgressRef.current),
        LOADING_PROGRESS_READY_CAP,
      )
      setDisplayedPreloadProgress((current) => (
        Math.max(current, target)
      ))
      animationFrame = window.requestAnimationFrame(updateDisplayedProgress)
    }

    animationFrame = window.requestAnimationFrame(updateDisplayedProgress)
    return () => window.cancelAnimationFrame(animationFrame)
  }, [initialMediaReady, showLoadingScreen])

  useEffect(() => {
    const loadingVisualReady = initialMediaReady
      && (reducedMotion === true || loadedInitialPosterMode === mobile)
    if (loadingVisualReady || !showLoadingScreen) return

    const root = document.documentElement
    const body = document.body
    const previousRootOverflow = root.style.overflow
    const previousBodyOverflow = body.style.overflow
    root.style.overflow = 'hidden'
    body.style.overflow = 'hidden'

    return () => {
      root.style.overflow = previousRootOverflow
      body.style.overflow = previousBodyOverflow
    }
  }, [initialMediaReady, loadedInitialPosterMode, mobile, reducedMotion, showLoadingScreen])

  useEffect(() => {
    const loadingVisualReady = initialMediaReady
      && (reducedMotion === true || loadedInitialPosterMode === mobile)
    if (!loadingVisualReady) return
    const timer = window.setTimeout(() => setShowLoadingScreen(false), 520)
    return () => window.clearTimeout(timer)
  }, [initialMediaReady, loadedInitialPosterMode, mobile, reducedMotion])

  useEffect(() => {
    const journey = journeyRef.current
    if (!journey) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (suppressJourneyEventsRef.current) {
            suppressJourneyEventsRef.current = false
          }
          trackEvent('town_journey_view', {}, 'journey:view')
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(journey)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (reducedMotion !== false) return

    requestJourneyUpdate()
    window.addEventListener('scroll', requestJourneyUpdate, { passive: true })
    window.addEventListener('resize', requestJourneyUpdate)

    return () => {
      window.removeEventListener('scroll', requestJourneyUpdate)
      window.removeEventListener('resize', requestJourneyUpdate)
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
      previousFrameTimeRef.current = null
    }
  }, [reducedMotion, requestJourneyUpdate])

  const setJourneyProgress = useCallback(
    (progress: number) => {
      const journey = journeyRef.current
      if (!journey) return

      const nextProgress = clamp(progress)
      targetProgressRef.current = nextProgress
      renderedProgressRef.current = nextProgress
      renderJourneyFrame(nextProgress)

      const journeyTop = window.scrollY + journey.getBoundingClientRect().top
      const distance = Math.max(journey.offsetHeight - window.innerHeight, 1)
      window.scrollTo({
        top: journeyTop + distance * nextProgress,
        behavior: 'auto',
      })
    },
    [renderJourneyFrame],
  )

  const playSegmentAtIndex = useCallback(
    function playSegmentAtIndex(entryIndex: number) {
      if (mobile === null || reducedMotion !== false || segmentPlaybackRef.current) return false

      const entry = segmentTimeline.entries[entryIndex]
      if (!entry) return false
      if (!fullyLoadedSegmentKeysRef.current.has(getSegmentPreloadKey(entry.id, mobile))) {
        return false
      }

      const video = videoRefs.current.get(entry.id)
      if (!video) return false
      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        video.preload = 'auto'
        if (video.networkState === HTMLMediaElement.NETWORK_EMPTY) video.load()
        return false
      }

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
        previousFrameTimeRef.current = null
      }

      const startPosition = Math.min(
        entry.start + (entry.index === 0 ? 0 : SEGMENT_BOUNDARY_ADVANCE_PX / window.innerHeight),
        entry.end,
      )
      const playbackWeight = Math.max(entry.end - startPosition, 0)
      const startProgress = startPosition / totalScrollWeight

      // --- Define closures before creating the playback object ---
      const updatePlayback = () => {
        const duration = video.duration
        const mediaProgress = Number.isFinite(duration) && duration > 0
          ? Math.min(clamp(video.currentTime / duration), 1 - SCRUB_EPSILON)
          : 0
        const progress = (
          startPosition + playbackWeight * mediaProgress
        ) / totalScrollWeight

        targetProgressRef.current = progress
        renderedProgressRef.current = progress
        renderJourneyFrame(progress)
      }

      const cleanup = () => {
        video.removeEventListener('timeupdate', updatePlayback)
        video.removeEventListener('ended', finishPlayback)
        video.removeEventListener('pause', finishPlaybackFromPause)
        video.removeEventListener('error', failPlayback)
        video.removeEventListener('abort', failPlayback)
        video.removeEventListener('emptied', failPlayback)
      }

      const finishPlayback = () => {
        if (segmentPlaybackRef.current !== playback) return
        cleanup()
        segmentPlaybackRef.current = null
        const nextEntry = segmentTimeline.entries[entry.index + 1]
        const sequenceEndIndex = playbackSequenceEndIndexRef.current
        const hasSequenceNext = sequenceEndIndex !== null
          && entry.index < sequenceEndIndex
          && Boolean(nextEntry)
        const reachedSequenceEnd = sequenceEndIndex === entry.index
        const waitsForAction = reachedSequenceEnd
          || (!hasSequenceNext && entry.kind === 'dive-in' && Boolean(nextEntry))
        const nextEntryReady = !nextEntry || fullyLoadedSegmentKeysRef.current.has(
          getSegmentPreloadKey(nextEntry.id, mobile),
        )
        const waitsForMedia = !nextEntryReady
          && (hasSequenceNext || entry.kind === 'connector')
        const nextPosition = waitsForAction || waitsForMedia
          ? Math.max(
              entry.end - SEGMENT_BOUNDARY_ADVANCE_PX / window.innerHeight,
              entry.start,
            )
          : entry.index === segmentTimeline.entries.length - 1
            ? totalScrollWeight
            : entry.end + SEGMENT_BOUNDARY_ADVANCE_PX / window.innerHeight
        const nextProgress = entry.index === segmentTimeline.entries.length - 1
          ? 1
          : nextPosition / totalScrollWeight

        // Start next segment BEFORE setJourneyProgress so the new video is
        // already in playback mode (data-ready stays 'true') when the frame
        // renders — prevents black flash at segment boundaries.
        let nextStarted = false
        if (reachedSequenceEnd) {
          playbackSequenceEndIndexRef.current = null
        } else if (hasSequenceNext && nextEntry) {
          nextStarted = playSegmentAtIndex(nextEntry.index)
          if (!nextStarted) {
            pendingPlaybackIndexRef.current = nextEntry.index
            requestJourneyUpdate()
          }
        } else if (!waitsForAction && entry.kind === 'connector' && nextEntry?.kind === 'dive-in') {
          nextStarted = playSegmentAtIndex(nextEntry.index)
          if (!nextStarted) {
            pendingPlaybackIndexRef.current = nextEntry.index
            requestJourneyUpdate()
          }
        }

        setJourneyProgress(nextProgress)
      }

      const failPlayback = () => {
        if (segmentPlaybackRef.current !== playback) return
        cleanup()
        segmentPlaybackRef.current = null
        playbackSequenceEndIndexRef.current = null
        pendingPlaybackIndexRef.current = null
        video.dataset.failed = 'true'
        requestJourneyUpdate()
      }

      const resumeInterruptedPlayback = () => {
        if (
          segmentPlaybackRef.current !== playback
          || document.hidden
          || !shouldResumeJourneyVideoPlayback(video)
        ) return
        video.play().catch(failPlayback)
      }

      const finishPlaybackFromPause = () => {
        if (segmentPlaybackRef.current !== playback) return
        if (hasCompletedJourneyVideoPlayback(video)) {
          finishPlayback()
          return
        }
        resumeInterruptedPlayback()
      }

      // --- Create playback object and set ref BEFORE renderJourneyFrame ---
      // This ensures renderJourneyFrame uses the playback path (readyState
      // check) instead of the scrubbing path (which may set data-ready='false'
      // during a seek, causing visibility:hidden → black flash).
      const playback: SegmentPlayback = {
        cleanup,
        finish: finishPlayback,
        segmentId: entry.id,
        video,
      }
      segmentPlaybackRef.current = playback

      // --- Set up video and render ---
      if (video.currentTime > SCRUB_EPSILON) video.currentTime = 0
      video.dataset.failed = 'false'
      video.dataset.ready = 'true'

      targetProgressRef.current = startProgress
      renderedProgressRef.current = startProgress
      renderJourneyFrame(startProgress)

      // --- Attach event listeners and start playback ---
      video.addEventListener('timeupdate', updatePlayback)
      video.addEventListener('ended', finishPlayback, { once: true })
      video.addEventListener('pause', finishPlaybackFromPause)
      video.addEventListener('error', failPlayback, { once: true })
      video.addEventListener('abort', failPlayback, { once: true })
      video.addEventListener('emptied', failPlayback, { once: true })

      try {
        const playbackPromise = video.play()
        window.setTimeout(resumeInterruptedPlayback, 250)
        if (playbackPromise) {
          playbackPromise
            .then(() => {
              if (segmentPlaybackRef.current === playback) updatePlayback()
            })
            .catch(failPlayback)
        } else {
          updatePlayback()
        }
      } catch {
        failPlayback()
      }
      return true
    },
    [
      mobile,
      reducedMotion,
      renderJourneyFrame,
      requestJourneyUpdate,
      segmentTimeline,
      setJourneyProgress,
      totalScrollWeight,
    ],
  )

  useEffect(() => {
    const pendingIndex = pendingPlaybackIndexRef.current
    const pendingIsCurrentOrNext = pendingIndex === activeSegmentIndex
      || pendingIndex === activeSegmentIndex + 1
    if (pendingIndex === null || !pendingIsCurrentOrNext) return
    if (playSegmentAtIndex(pendingIndex)) pendingPlaybackIndexRef.current = null

    if (pendingPlaybackIndexRef.current === null) return
    const retryFrame = window.requestAnimationFrame(() => {
      if (
        pendingPlaybackIndexRef.current === pendingIndex
        && playSegmentAtIndex(pendingIndex)
      ) {
        pendingPlaybackIndexRef.current = null
      }
    })
    return () => window.cancelAnimationFrame(retryFrame)
  }, [activeSegmentIndex, fullyLoadedSegmentKeys, playSegmentAtIndex, videoRevision])

  const startSegmentPlayback = useCallback(
    (segmentIndex: number, sequenceEndIndex: number | null = null) => {
      const entry = segmentTimeline.entries[segmentIndex]
      if (!entry) return false

      cancelSegmentPlayback()
      playbackSequenceEndIndexRef.current = sequenceEndIndex
      pendingPlaybackIndexRef.current = segmentIndex
      if (playSegmentAtIndex(segmentIndex)) pendingPlaybackIndexRef.current = null
      return true
    },
    [
      cancelSegmentPlayback,
      playSegmentAtIndex,
      segmentTimeline.entries,
    ],
  )

  const startTownEntrySequence = useCallback(() => {
    const firstRobotIndex = segmentTimeline.entries.findIndex(
      (entry) => entry.kind === 'dive-in' && entry.chapterIndex === 1,
    )
    if (firstRobotIndex < 0) return false

    setHasEnteredTown(true)
    return startSegmentPlayback(0, firstRobotIndex)
  }, [segmentTimeline.entries, startSegmentPlayback])

  const playNextChapter = useCallback(
    (chapterIndex: number, robotId: RobotProfile['id']) => {
      const connectorIndex = findConnectorSegmentIndex(segments, chapterIndex)
      if (connectorIndex < 0) return

      const requiredSegments = segments.slice(connectorIndex, connectorIndex + 2)
      const nextChapterReady = reducedMotion === true || (
        mobile !== null
        && requiredSegments.every((segment) => (
          fullyLoadedSegmentKeys.has(getSegmentPreloadKey(segment.id, mobile))
        ))
      )
      if (!nextChapterReady) return

      trackEvent('journey_next_click', { robot_id: robotId })
      if (reducedMotion === true) {
        sceneRefs.current[chapterIndex + 1]?.scrollIntoView({
          behavior: 'auto',
          block: 'start',
        })
        return
      }
      startSegmentPlayback(connectorIndex)
    },
    [fullyLoadedSegmentKeys, mobile, reducedMotion, segments, startSegmentPlayback],
  )

  const enterTown = useCallback(() => {
    trackEvent('journey_enter_town_click')
    if (reducedMotion === true) {
      sceneRefs.current[1]?.scrollIntoView({ behavior: 'auto', block: 'start' })
      return
    }

    startTownEntrySequence()
  }, [reducedMotion, startTownEntrySequence])

  const playJourneySegment = useCallback(
    (direction: 1 | -1) => {
      if (mobile === null || reducedMotion !== false) return false

      const currentPlayback = segmentPlaybackRef.current
      if (currentPlayback) {
        if (!hasCompletedJourneyVideoPlayback(currentPlayback.video)) return false
        currentPlayback.finish()
        if (segmentPlaybackRef.current) return true
      }

      const currentFrame = getJourneyFrame(
        renderedProgressRef.current,
        segments,
        chapters.length,
      )

      if (direction < 0) {
        const targetIndex = currentFrame.localProgress <= 0.02
          ? currentFrame.activeSegmentIndex - 1
          : currentFrame.activeSegmentIndex
        if (targetIndex < 0) return false
        setJourneyProgress(
          segmentTimeline.entries[targetIndex].start / totalScrollWeight,
        )
        return true
      }

      const entry = segmentTimeline.entries[currentFrame.activeSegmentIndex]
      if (
        !entry
        || (entry.end >= totalScrollWeight && currentFrame.localProgress >= 0.99)
      ) return false

      if (entry.index === 0) return startTownEntrySequence()
      return playSegmentAtIndex(entry.index)
    },
    [
      chapters.length,
      mobile,
      playSegmentAtIndex,
      reducedMotion,
      segmentTimeline.entries,
      segments,
      setJourneyProgress,
      startTownEntrySequence,
      totalScrollWeight,
    ],
  )

  useEffect(() => {
    const journey = journeyRef.current
    if (!journey || reducedMotion !== false) return

    let ignoreWheelGesture = false
    let wheelGestureResetId: number | undefined
    const scheduleWheelGestureReset = () => {
      if (wheelGestureResetId !== undefined) {
        window.clearTimeout(wheelGestureResetId)
      }
      wheelGestureResetId = window.setTimeout(() => {
        ignoreWheelGesture = false
        wheelGestureResetId = undefined
      }, WHEEL_GESTURE_IDLE_MS)
    }
    const handleWheel = (event: WheelEvent) => {
      if (
        event.ctrlKey
        || event.deltaY === 0
        || Math.abs(event.deltaY) <= Math.abs(event.deltaX)
      ) return

      if (segmentPlaybackRef.current) ignoreWheelGesture = true
      if (ignoreWheelGesture) {
        event.preventDefault()
        scheduleWheelGestureReset()
        return
      }

      const rect = journey.getBoundingClientRect()
      const isPinned = rect.top <= 1 && rect.bottom >= window.innerHeight - 1
      if (!isPinned) return

      const direction = event.deltaY > 0 ? 1 : -1
      if (playJourneySegment(direction) || segmentPlaybackRef.current) {
        event.preventDefault()
      }
    }

    journey.addEventListener('wheel', handleWheel, { passive: false })
    return () => {
      journey.removeEventListener('wheel', handleWheel)
      if (wheelGestureResetId !== undefined) {
        window.clearTimeout(wheelGestureResetId)
      }
    }
  }, [mobile, playJourneySegment, reducedMotion])

  useEffect(() => {
    const journey = journeyRef.current
    if (!journey || mobile !== true || reducedMotion !== false) return

    const findTouch = (touches: TouchList, identifier: number) => (
      Array.from(touches).find((touch) => touch.identifier === identifier)
    )
    const canHandleDirection = (direction: 1 | -1) => (
      direction > 0
        ? renderedProgressRef.current < 1 - SCRUB_EPSILON
        : renderedProgressRef.current > SCRUB_EPSILON
    )
    const handleTouchStart = (event: TouchEvent) => {
      if (
        event.touches.length !== 1
        || (
          !segmentPlaybackRef.current
          && event.target instanceof Element
          && event.target.closest('a, button')
        )
      ) {
        mobileGestureRef.current = null
        return
      }

      const touch = event.touches[0]
      mobileGestureRef.current = {
        identifier: touch.identifier,
        ignoreDuringPlayback: Boolean(segmentPlaybackRef.current),
        startX: touch.clientX,
        startY: touch.clientY,
      }

      const currentFrame = getJourneyFrame(
        renderedProgressRef.current,
        segments,
        chapters.length,
      )
      const currentVideo = videoRefs.current.get(
        segments[currentFrame.activeSegmentIndex].id,
      )
      if (currentVideo?.readyState === 0) currentVideo.load()
    }
    const handleTouchMove = (event: TouchEvent) => {
      const gesture = mobileGestureRef.current
      if (!gesture || event.touches.length !== 1) return
      const touch = findTouch(event.touches, gesture.identifier)
      if (!touch) return

      const deltaX = touch.clientX - gesture.startX
      const deltaY = touch.clientY - gesture.startY
      if (Math.abs(deltaY) < 8 || Math.abs(deltaY) <= Math.abs(deltaX)) return

      if (gesture.ignoreDuringPlayback || segmentPlaybackRef.current) {
        gesture.ignoreDuringPlayback = true
        event.preventDefault()
        return
      }

      const direction = deltaY < 0 ? 1 : -1
      if (canHandleDirection(direction)) event.preventDefault()
    }
    const handleTouchEnd = (event: TouchEvent) => {
      const gesture = mobileGestureRef.current
      mobileGestureRef.current = null
      if (!gesture) return

      const touch = findTouch(event.changedTouches, gesture.identifier)
      if (!touch) return
      const deltaX = touch.clientX - gesture.startX
      const deltaY = touch.clientY - gesture.startY
      if (gesture.ignoreDuringPlayback || segmentPlaybackRef.current) {
        if (
          Math.abs(deltaY) >= MOBILE_SWIPE_THRESHOLD_PX
          && Math.abs(deltaY) > Math.abs(deltaX)
        ) {
          event.preventDefault()
        }
        return
      }
      if (
        Math.abs(deltaY) < MOBILE_SWIPE_THRESHOLD_PX
        || Math.abs(deltaY) <= Math.abs(deltaX)
      ) return

      const direction = deltaY < 0 ? 1 : -1
      if (!canHandleDirection(direction)) return
      event.preventDefault()
      playJourneySegment(direction)
    }
    const handleTouchCancel = () => {
      mobileGestureRef.current = null
    }

    journey.addEventListener('touchstart', handleTouchStart, { passive: false })
    journey.addEventListener('touchmove', handleTouchMove, { passive: false })
    journey.addEventListener('touchend', handleTouchEnd, { passive: false })
    journey.addEventListener('touchcancel', handleTouchCancel, { passive: false })
    return () => {
      journey.removeEventListener('touchstart', handleTouchStart)
      journey.removeEventListener('touchmove', handleTouchMove)
      journey.removeEventListener('touchend', handleTouchEnd)
      journey.removeEventListener('touchcancel', handleTouchCancel)
      mobileGestureRef.current = null
    }
  }, [chapters.length, mobile, playJourneySegment, reducedMotion, segments])

  useEffect(() => {
    const syncPlaybackVisibility = () => {
      const playback = segmentPlaybackRef.current
      if (!playback) {
        if (!document.hidden) requestJourneyUpdate()
        return
      }

      if (document.hidden) {
        playback.video.pause()
        return
      }

      if (shouldResumeJourneyVideoPlayback(playback.video)) {
        playback.video.play().catch(() => undefined)
      }
    }
    const stopPlaybackOnPageHide = () => cancelSegmentPlayback()

    document.addEventListener('visibilitychange', syncPlaybackVisibility)
    window.addEventListener('pagehide', stopPlaybackOnPageHide)
    return () => {
      document.removeEventListener('visibilitychange', syncPlaybackVisibility)
      window.removeEventListener('pagehide', stopPlaybackOnPageHide)
    }
  }, [cancelSegmentPlayback, requestJourneyUpdate])

  useEffect(() => {
    mobileGestureRef.current = null
    eagerSegmentIndexRef.current = null
    setEagerSegmentIndex(null)
    cancelSegmentPlayback()
    requestJourneyUpdate()
  }, [cancelSegmentPlayback, mobile, reducedMotion, requestJourneyUpdate])

  useEffect(() => () => {
    cancelSegmentPlayback()
    videoRefs.current.forEach((video) => {
      video.pause()
    })
    videoRefs.current.clear()
    const ambientVideo = ambientVideoRef.current
    if (ambientVideo) ambientVideo.pause()
    ambientVideoRef.current = null
  }, [cancelSegmentPlayback])

  useEffect(() => {
    if (reducedMotion !== true) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue
          const index = Number((entry.target as HTMLElement).dataset.chapterIndex)
          commitActiveIndex(index)
          const chapter = chapters[index]
          if (!suppressJourneyEventsRef.current && chapter.robotId) {
            trackEvent(
              'journey_chapter_view',
              { robot_id: chapter.robotId },
              `chapter:${chapter.robotId}`,
            )
          }
          if (!suppressJourneyEventsRef.current && chapter.id === 'reunion') {
            trackEvent('journey_complete', {}, 'journey:complete')
          }
        }
      },
      { threshold: [0.5] },
    )

    sceneRefs.current.forEach((scene) => {
      if (scene) observer.observe(scene)
    })
    return () => observer.disconnect()
  }, [chapters, commitActiveIndex, reducedMotion])

  const jumpToChapter = useCallback(
    (index: number) => {
      const journey = journeyRef.current
      if (!journey) return

      const targetSegmentIndex = segments.findIndex(
        (segment) => segment.kind === 'dive-in' && segment.chapterIndex === index,
      )
      if (targetSegmentIndex < 0) return

      suppressJourneyEventsRef.current = true

      if (reducedMotion === true) {
        cancelSegmentPlayback()
        pendingPlaybackIndexRef.current = null
        commitActiveIndex(index)
        commitActiveSegmentIndex(targetSegmentIndex)
        sceneRefs.current[index]?.scrollIntoView({ behavior: 'auto', block: 'start' })
      } else {
        startSegmentPlayback(targetSegmentIndex)
      }

      window.requestAnimationFrame(() => {
        suppressJourneyEventsRef.current = false
        requestJourneyUpdate()
      })
    },
    [
      commitActiveIndex,
      commitActiveSegmentIndex,
      cancelSegmentPlayback,
      reducedMotion,
      segments,
      requestJourneyUpdate,
      startSegmentPlayback,
    ],
  )

  const setSceneRef = (index: number): RefCallback<HTMLElement> => (node) => {
    sceneRefs.current[index] = node
  }

  const journeyStyle: JourneyStyle = {
    '--journey-scroll-units': totalScrollWeight,
    '--chapter-accent': chapters[activeIndex].accent,
  }
  const chapterNavItems = chapters.flatMap((chapter, index) => (
    chapter.robotId
      ? [{
          id: chapter.id,
          label: chapter.name,
          targetIndex: index,
          chapterIndexes: [index],
          isActive: activeIndex === index,
        }]
      : []
  ))
  const canShowChapterNav = reducedMotion === true
    ? activeIndex > 0
    : hasPassedFirstViewport
  const isChapterNavVisible = canShowChapterNav
    && chapters[activeIndex].id !== 'reunion'
  const visibleWorldIntroCue = mobile === true && hasEnteredTown
    ? worldIntroCue
    : undefined
  const loadingVisualReady = initialMediaReady
    && (reducedMotion === true || loadedInitialPosterMode === mobile)

  return (
    <section
      id="town-journey"
      ref={journeyRef}
      className={styles.journey}
      style={journeyStyle}
      aria-label="玛卡小镇角色旅程"
      data-active-chapter={chapters[activeIndex].id}
      data-active-segment={segments[activeSegmentIndex].id}
      data-mobile={mobile === true ? 'true' : 'false'}
      data-reduced-motion={reducedMotion === true ? 'true' : 'false'}
      data-media-ready={initialMediaReady ? 'true' : 'false'}
    >
      <div className={styles.stage}>
        {mobile !== null ? (
          <div
            key={`initial-poster-${mobile ? 'mobile' : 'desktop'}`}
            className={styles.initialJourneyPoster}
            data-active={activeSegmentIndex === 0 ? 'true' : 'false'}
            aria-hidden="true"
          >
            <Image
              src={(mobile ? segments[0].posterMobile : segments[0].posterDesktop)
                || `/images/scenes/dive-town-runtime-first-frame-${mobile ? 'mobile' : 'desktop'}.webp`}
              alt=""
              fill
              sizes="100vw"
              priority
              unoptimized
              onLoad={() => setLoadedInitialPosterMode(mobile)}
              onError={() => setLoadedInitialPosterMode(mobile)}
            />
          </div>
        ) : null}
        <JourneyVideoLayer
          segments={segments}
          activeSegmentIndex={activeSegmentIndex}
          eagerSegmentIndex={eagerSegmentIndex}
          mobile={mobile}
          reducedMotion={reducedMotion !== false}
          registerVideo={registerVideo}
          registerAmbientVideo={registerAmbientVideo}
          onVideoTimingChange={handleVideoTimingChange}
          onPreloadStateChange={handlePreloadStateChange}
          onSegmentPreloadStateChange={handleSegmentPreloadStateChange}
        />
        <div className={styles.sceneStack}>
          {chapters.map((chapter, index) => {
            const isActive = index === activeIndex
            const isHidden = reducedMotion !== true && !isActive
            const robot = chapter.robotId
              ? robots.find((item) => item.id === chapter.robotId)
              : undefined
            const connectorIndex = findConnectorSegmentIndex(segments, index)
            const requiredNextSegments = connectorIndex >= 0
              ? segments.slice(connectorIndex, connectorIndex + 2)
              : []
            const nextChapterReady = reducedMotion === true || (
              mobile !== null
              && requiredNextSegments.length > 0
              && requiredNextSegments.every((segment) => (
                fullyLoadedSegmentKeys.has(getSegmentPreloadKey(segment.id, mobile))
              ))
            )
            return (
              <article
                id={`chapter-${chapter.id}`}
                key={chapter.id}
                ref={setSceneRef(index)}
                className={`${styles.scene} ${isActive ? styles.activeScene : ''}`}
                data-chapter-index={index}
                data-chapter-id={chapter.id}
                aria-hidden={isHidden}
                inert={isHidden ? true : undefined}
                style={{ '--scene-accent': chapter.accent } as CSSProperties}
              >
                <div
                  className={`${styles.copy} ${robot ? styles.robotCopy : ''} ${index === 0 ? styles.townCopy : ''} ${chapter.id === 'reunion' ? styles.reunionCopy : ''}`}
                >
                  {index === 0 ? (
                    <>
                      {mobile !== true || !hasEnteredTown ? (
                        <h1 className={styles.townTitle} tabIndex={-1}>
                          <Image
                            className={`${styles.townWordmark} ${styles.townWordmarkLight}`}
                            src="/images/brand/maka-planet-logo-white-cn.png"
                            alt=""
                            aria-hidden="true"
                            width={2584}
                            height={807}
                            priority
                          />
                          <span className="srOnly">{chapter.title}</span>
                        </h1>
                      ) : null}
                      {activeSegmentIndex === 0 && !hasEnteredTown ? (
                        <button
                          type="button"
                          className={styles.sceneAction}
                          onClick={enterTown}
                        >
                          进入小镇
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <h2 tabIndex={-1}>
                      {robot ? <span className={styles.robotEnglishName}>{robot.englishName}</span> : null}
                      {chapter.id === 'reunion' ? (
                        <>
                          玛卡小镇
                          <br />
                          招募居民中
                        </>
                      ) : robot ? (
                        <>
                          {chapter.title.slice(0, -1)}
                          <span className={styles.titleLastCharacter}>{chapter.title.slice(-1)}</span>
                        </>
                      ) : chapter.title}
                    </h2>
                  )}
                  {robot ? (
                    <p className={styles.description}>
                      {robot.archetype}
                      {chapter.description ? `。${chapter.description}` : null}
                    </p>
                  ) : chapter.description ? (
                    <p className={styles.description}>{chapter.description}</p>
                  ) : null}
                  {robot ? (
                    <button
                      type="button"
                      className={styles.sceneAction}
                      aria-label={`继续${robot.name}之后的旅程`}
                      aria-busy={!nextChapterReady}
                      disabled={!nextChapterReady}
                      onClick={() => playNextChapter(index, robot.id)}
                    >
                      <span>下一章</span>
                      {!nextChapterReady ? (
                        <LoaderCircle
                          className={styles.sceneActionSpinner}
                          size={16}
                          strokeWidth={2}
                          aria-hidden="true"
                        />
                      ) : null}
                    </button>
                  ) : null}
                  {chapter.id === 'reunion' ? (
                    <a
                      className={styles.sceneAction}
                      href={RESIDENT_APPLICATION_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="申请成为玛卡小镇居民"
                      onClick={() => {
                        trackEvent('business_cta_click', {
                          cta_id: 'reunion_resident_application',
                          cta_label: '我要申请',
                          source: 'reunion',
                          destination: RESIDENT_APPLICATION_URL,
                        })
                      }}
                    >
                      我要申请
                    </a>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>

        {showLoadingScreen ? (
          <div
            className={styles.loadingScreen}
            data-ready={loadingVisualReady ? 'true' : 'false'}
            role="status"
            aria-live="polite"
          >
            <div className={styles.loadingContent}>
              <div className={styles.loadingLogo} aria-hidden="true" />
              <span className="srOnly">玛卡星球</span>
              <div className={styles.loadingProgressMeta}>
                <span>{loadingVisualReady ? '旅程就绪' : '正在进入玛卡星球'}</span>
                <span className={styles.loadingProgressValue} aria-hidden="true" />
              </div>
              <div
                className={styles.loadingTrack}
                role="progressbar"
                aria-label="首批旅程资源加载进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(displayedPreloadProgress * 100)}
              >
                <span style={{ width: `${displayedPreloadProgress * 100}%` }} />
              </div>
            </div>
          </div>
        ) : null}

        {visibleWorldIntroCue ? (
          <p
            key={visibleWorldIntroCue.id}
            className={styles.worldIntroSubtitle}
            role="status"
          >
            {visibleWorldIntroCue.lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </p>
        ) : null}

        <nav
          className={styles.chapterNav}
          aria-label="旅程章节"
          aria-hidden={!isChapterNavVisible}
          data-visible={isChapterNavVisible ? 'true' : 'false'}
          inert={!isChapterNavVisible ? true : undefined}
        >
          {chapterNavItems.map((item) => (
            <button
              key={item.id}
              ref={(node) => {
                item.chapterIndexes.forEach((chapterIndex) => {
                  navRefs.current[chapterIndex] = node
                })
              }}
              type="button"
              className={styles.chapterButton}
              aria-current={item.isActive ? 'step' : undefined}
              onClick={() => jumpToChapter(item.targetIndex)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </section>
  )
}
