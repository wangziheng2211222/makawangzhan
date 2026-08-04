'use client'

import {
  type RefCallback,
  useCallback,
  useEffect,
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
  active: boolean
  mobile: boolean
  registerVideo: JourneyVideoLayerProps['registerVideo']
  onVideoTimingChange: JourneyVideoLayerProps['onVideoTimingChange']
}

function ManagedVideo({
  segment,
  active,
  mobile,
  registerVideo,
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
  }, [])

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
      onLoadStart={() => setReady(false)}
      onLoadedMetadata={onVideoTimingChange}
      onLoadedData={() => {
        setReady(true)
        onVideoTimingChange()
      }}
      onSeeked={onVideoTimingChange}
      onError={allowBlobFallback ? loadBlobFallback : undefined}
    />
  )
}

function ReunionAmbientVideo({
  mobile,
  registerAmbientVideo,
}: {
  mobile: boolean
  registerAmbientVideo: JourneyVideoLayerProps['registerAmbientVideo']
}) {
  const source = `/media/journey/${mobile ? 'mobile' : 'desktop'}/reunion-loop.mp4`

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
  const [loadRemainingMedia, setLoadRemainingMedia] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 800px)')
    const sync = () => setMobile(mediaQuery.matches)
    sync()
    mediaQuery.addEventListener('change', sync)
    return () => mediaQuery.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (reducedMotion === true || loadRemainingMedia) return

    const loadRemaining = () => setLoadRemainingMedia(true)
    window.addEventListener('scroll', loadRemaining, { once: true, passive: true })
    window.addEventListener('pointerdown', loadRemaining, { once: true, passive: true })
    window.addEventListener('touchstart', loadRemaining, { once: true, passive: true })
    window.addEventListener('keydown', loadRemaining, { once: true })
    return () => {
      window.removeEventListener('scroll', loadRemaining)
      window.removeEventListener('pointerdown', loadRemaining)
      window.removeEventListener('touchstart', loadRemaining)
      window.removeEventListener('keydown', loadRemaining)
    }
  }, [loadRemainingMedia, reducedMotion])

  if (reducedMotion === true) return null

  const initialSegmentCount = Math.ceil(segments.length / 2)
  const shouldLoadRemaining = loadRemainingMedia
    || activeSegmentIndex >= initialSegmentCount
  const segmentsToLoad = shouldLoadRemaining
    ? segments
    : segments.slice(0, initialSegmentCount)

  return (
    <div className={styles.videoStack}>
      <div className={styles.videoLoading} role="status" aria-live="polite">
        <span className={styles.videoLoadingIndicator} aria-hidden="true" />
        <span>画面加载中</span>
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
                active={index === activeSegmentIndex}
                mobile={mobile}
                registerVideo={registerVideo}
                onVideoTimingChange={onVideoTimingChange}
              />
            )
          })}
          {shouldLoadRemaining ? (
            <ReunionAmbientVideo
              key={`reunion-loop-${mobile ? 'mobile' : 'desktop'}`}
              mobile={mobile}
              registerAmbientVideo={registerAmbientVideo}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
