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
  reducedMotion: boolean
  registerVideo: (segmentId: string, video: HTMLVideoElement | null) => void
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
  const poster = mobile ? segment.posterMobile : segment.posterDesktop
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
      preload={active ? 'auto' : 'metadata'}
      poster={poster}
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

export function JourneyVideoLayer({
  segments,
  activeSegmentIndex,
  reducedMotion,
  registerVideo,
  onVideoTimingChange,
}: JourneyVideoLayerProps) {
  const [mobile, setMobile] = useState<boolean | null>(null)
  const [mediaEnabled, setMediaEnabled] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 800px)')
    const sync = () => setMobile(mediaQuery.matches)
    sync()
    mediaQuery.addEventListener('change', sync)
    return () => mediaQuery.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (reducedMotion) return

    const enableMedia = () => setMediaEnabled(true)
    const idleCallback = window.requestIdleCallback?.(enableMedia, { timeout: 1500 })
    const fallbackTimer = idleCallback === undefined
      ? window.setTimeout(enableMedia, 800)
      : undefined

    window.addEventListener('scroll', enableMedia, { once: true, passive: true })
    return () => {
      window.removeEventListener('scroll', enableMedia)
      if (idleCallback !== undefined) window.cancelIdleCallback(idleCallback)
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer)
    }
  }, [reducedMotion])

  if (reducedMotion || mobile === null || !mediaEnabled) return null

  return (
    <div className={styles.videoStack} aria-hidden="true">
      {segments.map((segment, index) => {
        const hasSource = mobile ? segment.videoMobile : segment.videoDesktop
        if (!hasSource || Math.abs(index - activeSegmentIndex) > 1) return null

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
    </div>
  )
}
