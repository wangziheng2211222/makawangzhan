'use client'

import Image from 'next/image'
import {
  type RefCallback,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

import type { JourneyMediaSegment } from '@/types/robot'

import styles from './TownJourney.module.css'

const allowBlobFallback = process.env.NEXT_PUBLIC_VIDEO_BLOB_FALLBACK === 'true'

type JourneyVideoLayerProps = {
  segments: JourneyMediaSegment[]
  activeSegmentIndex: number
  reducedMotion: boolean | null
  registerVideo: (segmentId: string, video: HTMLVideoElement | null) => void
  registerAmbientVideo: (video: HTMLVideoElement | null) => void
  onVideoTimingChange: () => void
}

type ManagedVideoProps = {
  segment: JourneyMediaSegment
  mediaId: string
  active: boolean
  mobile: boolean
  registerVideo: JourneyVideoLayerProps['registerVideo']
  onReadyChange: (mediaId: string, ready: boolean) => void
  onVideoTimingChange: JourneyVideoLayerProps['onVideoTimingChange']
}

function ManagedVideo({
  segment,
  mediaId,
  active,
  mobile,
  registerVideo,
  onReadyChange,
  onVideoTimingChange,
}: ManagedVideoProps) {
  const directSource = mobile ? segment.videoMobile : segment.videoDesktop
  const [source, setSource] = useState(directSource)
  const [ready, setReady] = useState(false)
  const objectUrlRef = useRef<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const fallbackStartedRef = useRef(false)
  const mountedRef = useRef(true)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      onReadyChange(mediaId, false)
      abortControllerRef.current?.abort()
      const video = videoRef.current
      if (video) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [mediaId, onReadyChange])

  const setVideoReady = useCallback(
    (nextReady: boolean) => {
      setReady(nextReady)
      onReadyChange(mediaId, nextReady)
    },
    [mediaId, onReadyChange],
  )

  const setVideoRef: RefCallback<HTMLVideoElement> = useCallback(
    (video) => {
      videoRef.current = video
      registerVideo(segment.id, video)
    },
    [registerVideo, segment.id],
  )

  const loadBlobFallback = useCallback(async () => {
    if (!directSource || fallbackStartedRef.current || source !== directSource) return
    fallbackStartedRef.current = true
    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const response = await fetch(directSource, { signal: controller.signal })
      if (!response.ok) throw new Error(`Video request failed: ${response.status}`)
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      if (!mountedRef.current || controller.signal.aborted) {
        URL.revokeObjectURL(objectUrl)
        return
      }
      objectUrlRef.current = objectUrl
      setSource(objectUrl)
    } catch {
      if (mountedRef.current && !controller.signal.aborted) {
        fallbackStartedRef.current = false
      }
    }
  }, [directSource, source])

  if (!source) return null

  return (
    <video
      ref={setVideoRef}
      className={`${styles.journeyVideo} ${active ? styles.activeJourneyVideo : ''}`}
      muted
      playsInline
      preload="auto"
      src={source}
      aria-hidden="true"
      tabIndex={-1}
      data-ready={ready ? 'true' : 'false'}
      data-segment-id={segment.id}
      onLoadStart={() => setVideoReady(false)}
      onLoadedMetadata={onVideoTimingChange}
      onLoadedData={() => {
        setVideoReady(true)
        onVideoTimingChange()
      }}
      onSeeked={onVideoTimingChange}
      onError={allowBlobFallback ? loadBlobFallback : undefined}
    />
  )
}

function ReunionAmbientVideo({
  mobile,
  mediaId,
  registerAmbientVideo,
  onReadyChange,
}: {
  mobile: boolean
  mediaId: string
  registerAmbientVideo: JourneyVideoLayerProps['registerAmbientVideo']
  onReadyChange: (mediaId: string, ready: boolean) => void
}) {
  const source = `/media/journey/${mobile ? 'mobile' : 'desktop'}/reunion-loop.mp4`

  useEffect(
    () => () => onReadyChange(mediaId, false),
    [mediaId, onReadyChange],
  )

  return (
    <video
      ref={registerAmbientVideo}
      className={`${styles.journeyVideo} ${styles.reunionLoopVideo}`}
      muted
      loop
      playsInline
      preload="auto"
      src={source}
      aria-hidden="true"
      tabIndex={-1}
      data-segment-id="reunion-loop"
      onLoadStart={() => onReadyChange(mediaId, false)}
      onLoadedData={() => onReadyChange(mediaId, true)}
    />
  )
}

export function JourneyVideoLayer({
  segments,
  activeSegmentIndex,
  reducedMotion,
  registerVideo,
  registerAmbientVideo,
  onVideoTimingChange,
}: JourneyVideoLayerProps) {
  const [mobile, setMobile] = useState<boolean | null>(null)
  const [loadRemainingMedia, setLoadRemainingMedia] = useState(true)
  const [readyMediaIds, setReadyMediaIds] = useState<Set<string>>(() => new Set())

  const setMediaReady = useCallback((mediaId: string, ready: boolean) => {
    setReadyMediaIds((current) => {
      if (current.has(mediaId) === ready) return current

      const next = new Set(current)
      if (ready) next.add(mediaId)
      else next.delete(mediaId)
      return next
    })
  }, [])

  useLayoutEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 800px)')
    const sync = () => setMobile(mediaQuery.matches)
    sync()
    mediaQuery.addEventListener('change', sync)
    return () => mediaQuery.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (reducedMotion === true || loadRemainingMedia) return
    // 所有视频在首次加载时立即开始加载，无需用户交互
  }, [loadRemainingMedia, reducedMotion])

  if (reducedMotion === true) return null

  const initialSegmentCount = Math.min(8, segments.length)
  const shouldLoadRemaining = loadRemainingMedia
    || activeSegmentIndex >= initialSegmentCount
  const segmentsToLoad = shouldLoadRemaining
    ? segments
    : segments.slice(0, initialSegmentCount)
  const selectedFormat = mobile === true ? 'mobile' : 'desktop'
  const getMediaId = (segmentId: string) => `${selectedFormat}:${segmentId}`
  const hasSelectedSource = (segment: JourneyMediaSegment) => mobile !== null
    && Boolean(mobile ? segment.videoMobile : segment.videoDesktop)
  const initialMediaIds = segments
    .slice(0, initialSegmentCount)
    .filter(hasSelectedSource)
    .map((segment) => getMediaId(segment.id))
  const initialReadyCount = initialMediaIds.filter((id) => readyMediaIds.has(id)).length
  const initialMediaReady = initialMediaIds.length > 0
    && initialReadyCount === initialMediaIds.length
  const loadingMediaIds = [
    ...segmentsToLoad.filter(hasSelectedSource).map((segment) => getMediaId(segment.id)),
    ...(shouldLoadRemaining ? [getMediaId('reunion-loop')] : []),
  ]
  const progressMediaIds = initialMediaReady ? loadingMediaIds : initialMediaIds
  const readyCount = progressMediaIds.filter((id) => readyMediaIds.has(id)).length
  const loadProgress = progressMediaIds.length > 0
    ? Math.round((readyCount / progressMediaIds.length) * 100)
    : 0

  return (
    <div
      className={styles.videoStack}
      data-initial-media-ready={initialMediaReady ? 'true' : 'false'}
    >
      <div className={styles.videoLoading} role="status" aria-live="polite">
        <Image
          className={styles.videoLoadingLogo}
          src="/images/brand/maka-planet-logo.png"
          alt=""
          width={1085}
          height={450}
          priority
        />
        <div
          className={styles.videoLoadingTrack}
          role="progressbar"
          aria-label="画面加载进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={loadProgress}
        >
          <span
            className={styles.videoLoadingProgress}
            style={{ width: `${loadProgress}%` }}
          />
        </div>
        <span className="srOnly">画面加载中，{loadProgress}%</span>
      </div>
      {mobile !== null ? (
        <>
          {segmentsToLoad.map((segment, index) => {
            const hasSource = mobile ? segment.videoMobile : segment.videoDesktop
            if (!hasSource) return null

            return (
              <ManagedVideo
                key={`${segment.id}-${mobile ? 'mobile' : 'desktop'}`}
                segment={segment}
                mediaId={getMediaId(segment.id)}
                active={index === activeSegmentIndex}
                mobile={mobile}
                registerVideo={registerVideo}
                onReadyChange={setMediaReady}
                onVideoTimingChange={onVideoTimingChange}
              />
            )
          })}
          {shouldLoadRemaining ? (
            <ReunionAmbientVideo
              key={`reunion-loop-${mobile ? 'mobile' : 'desktop'}`}
              mobile={mobile}
              mediaId={getMediaId('reunion-loop')}
              registerAmbientVideo={registerAmbientVideo}
              onReadyChange={setMediaReady}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
