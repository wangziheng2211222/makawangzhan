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
const INITIAL_PRELOAD_COUNT = 3
const INITIAL_PRELOAD_TIMEOUT_MS = 30_000
const MINIMUM_PRELOAD_DISPLAY_MS = 2500

export type JourneyPreloadState = {
  progress: number
  ready: boolean
}

type PreloadAssetId = JourneyMediaSegment['id']

type JourneyVideoLayerProps = {
  segments: JourneyMediaSegment[]
  activeSegmentIndex: number
  eagerSegmentIndex?: number | null
  mobile?: boolean | null
  reducedMotion: boolean | null
  registerVideo: (segmentId: string, video: HTMLVideoElement | null) => void
  registerAmbientVideo: (video: HTMLVideoElement | null) => void
  onVideoTimingChange: () => void
  onPreloadStateChange: (state: JourneyPreloadState) => void
  onSegmentPreloadStateChange: (
    segmentId: JourneyMediaSegment['id'],
    mobile: boolean,
    ready: boolean,
  ) => void
}

type ManagedVideoProps = {
  segment: JourneyMediaSegment
  mobile: boolean
  preload: 'auto' | 'metadata' | 'none'
  preloadedSource?: string
  registerVideo: JourneyVideoLayerProps['registerVideo']
  onVideoTimingChange: JourneyVideoLayerProps['onVideoTimingChange']
}

function configureInlinePlayback(video: HTMLVideoElement) {
  video.defaultMuted = true
  video.muted = true
  video.playsInline = true
  video.setAttribute('webkit-playsinline', 'true')
  video.setAttribute('x5-playsinline', 'true')
  video.setAttribute('x5-video-player-type', 'h5-page')
  video.setAttribute('x5-video-player-fullscreen', 'false')
}

function ManagedVideo({
  segment,
  mobile,
  preload,
  preloadedSource,
  registerVideo,
  onVideoTimingChange,
}: ManagedVideoProps) {
  const directSource = mobile ? segment.videoMobile : segment.videoDesktop
  const [fallbackSource, setFallbackSource] = useState<string | null>(null)
  const source = preloadedSource || fallbackSource || directSource
  const objectUrlRef = useRef<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const fallbackStartedRef = useRef(false)
  const mountedRef = useRef(true)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (
      preload !== 'auto'
      || !source
      || !video
      || video.readyState !== HTMLMediaElement.HAVE_NOTHING
      || video.networkState !== HTMLMediaElement.NETWORK_EMPTY
    ) return

    video.load()
  }, [preload, source])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortControllerRef.current?.abort()
      const video = videoRef.current
      if (video) video.pause()
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current)
        objectUrlRef.current = null
      }
    }
  }, [])

  const setVideoRef: RefCallback<HTMLVideoElement> = useCallback(
    (video) => {
      videoRef.current = video
      if (video) configureInlinePlayback(video)
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
      setFallbackSource(objectUrl)
    } catch {
      if (mountedRef.current && !controller.signal.aborted) {
        fallbackStartedRef.current = false
      }
    }
  }, [directSource, source])

  const markUnavailable = useCallback(() => {
    if (videoRef.current) videoRef.current.dataset.ready = 'false'
    onVideoTimingChange()
  }, [onVideoTimingChange])

  const handleLoadStart = useCallback(() => {
    if (videoRef.current) videoRef.current.dataset.failed = 'false'
    markUnavailable()
  }, [markUnavailable])

  const handleError = useCallback(() => {
    if (videoRef.current) videoRef.current.dataset.failed = 'true'
    markUnavailable()
    if (allowBlobFallback) void loadBlobFallback()
  }, [loadBlobFallback, markUnavailable])

  if (!source) return null

  return (
    <div className={styles.journeyMediaSlot} data-journey-media-slot="true">
      <video
        ref={setVideoRef}
        className={styles.journeyVideo}
        muted
        playsInline
        preload={preload}
        src={source}
        aria-hidden="true"
        tabIndex={-1}
        data-ready="false"
        data-failed="false"
        data-segment-id={segment.id}
        onLoadStart={handleLoadStart}
        onLoadedMetadata={onVideoTimingChange}
        onLoadedData={onVideoTimingChange}
        onSeeked={onVideoTimingChange}
        onError={handleError}
        onStalled={onVideoTimingChange}
        onAbort={markUnavailable}
        onEmptied={markUnavailable}
      />
    </div>
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
  const setVideoRef: RefCallback<HTMLVideoElement> = useCallback(
    (video) => {
      if (video) configureInlinePlayback(video)
      registerAmbientVideo(video)
    },
    [registerAmbientVideo],
  )

  return (
    <div
      className={`${styles.journeyMediaSlot} ${styles.reunionLoopSlot}`}
      data-journey-media-slot="true"
    >
      <video
        ref={setVideoRef}
        className={styles.journeyVideo}
        muted
        loop
        playsInline
        preload="metadata"
        src={source}
        aria-hidden="true"
        tabIndex={-1}
        data-ready="false"
        data-segment-id="reunion-loop"
        onLoadStart={(event) => { event.currentTarget.dataset.ready = 'false' }}
        onLoadedData={(event) => { event.currentTarget.dataset.ready = 'true' }}
        onPlaying={(event) => { event.currentTarget.dataset.ready = 'true' }}
        onError={(event) => { event.currentTarget.dataset.ready = 'false' }}
      />
    </div>
  )
}

export function JourneyVideoLayer({
  segments,
  activeSegmentIndex,
  eagerSegmentIndex = null,
  mobile = false,
  reducedMotion,
  registerVideo,
  registerAmbientVideo,
  onVideoTimingChange,
  onPreloadStateChange,
  onSegmentPreloadStateChange,
}: JourneyVideoLayerProps) {
  const [preloadedMode, setPreloadedMode] = useState<boolean | null>(null)
  const [preloadedMedia, setPreloadedMedia] = useState<{
    mobile: boolean | null
    sources: Record<string, string>
  }>({ mobile: null, sources: {} })
  useEffect(() => {
    if (reducedMotion === true) {
      onPreloadStateChange({ progress: 1, ready: true })
      return
    }
    if (reducedMotion !== false || mobile === null) return

    let cancelled = false
    let minimumDelayId: number | undefined
    let timeoutId: number | undefined
    const preloadStartedAt = Date.now()
    const initialController = new AbortController()
    const backgroundController = new AbortController()
    const objectUrls = new Set<string>()
    const loadedAssetIds = new Set<PreloadAssetId>()
    // WeChat / mobile WebViews cannot reliably decode blob: URLs in <video>
    // (Android X5 kernel shows a black frame without firing any error event,
    // iOS WKWebView support is inconsistent across versions). On mobile the
    // <video> element always uses the direct HTTP URL; this fetch pipeline
    // still runs to drive loading progress, gate segment playback, and warm
    // the HTTP cache (see the Cache-Control header for /media/journey/*).
    const useObjectUrls = mobile === false
    const segmentAssets: Array<{ id: PreloadAssetId; source: string }> = segments.flatMap(
      (segment) => {
        const source = mobile ? segment.videoMobile : segment.videoDesktop
        return source ? [{ id: segment.id, source }] : []
      },
    )
    const initialAssets = segmentAssets.slice(0, INITIAL_PRELOAD_COUNT)
    const progressById = new Map(initialAssets.map((asset) => [asset.id, 0]))

    onPreloadStateChange({ progress: 0, ready: false })

    const reportProgress = () => {
      if (cancelled || initialAssets.length === 0) return
      const progress = Array.from(progressById.values())
        .reduce((total, value) => total + value, 0) / initialAssets.length
      onPreloadStateChange({ progress, ready: false })
    }

    const preloadAsset = async (
      { id, source }: { id: PreloadAssetId; source: string },
      signal: AbortSignal,
    ) => {
      try {
        const response = await fetch(source, { signal })
        if (!response.ok) throw new Error(`Video request failed: ${response.status}`)

        const contentLength = Number(response.headers.get('content-length'))
        let blob: Blob
        if (response.body && Number.isFinite(contentLength) && contentLength > 0) {
          const reader = response.body.getReader()
          const chunks: BlobPart[] = []
          let loadedBytes = 0

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            chunks.push(value)
            loadedBytes += value.byteLength
            if (progressById.has(id)) {
              progressById.set(id, Math.min(loadedBytes / contentLength, 1))
              reportProgress()
            }
          }

          blob = new Blob(chunks, {
            type: response.headers.get('content-type') || 'video/mp4',
          })
        } else {
          blob = await response.blob()
        }

        if (cancelled) return
        if (useObjectUrls) {
          const objectUrl = URL.createObjectURL(blob)
          objectUrls.add(objectUrl)
          setPreloadedMedia((current) => ({
            mobile,
            sources: {
              ...(current.mobile === mobile ? current.sources : {}),
              [id]: objectUrl,
            },
          }))
        }
        loadedAssetIds.add(id)
        onSegmentPreloadStateChange(id, mobile, true)
        return true
      } catch {
        if (!cancelled) onSegmentPreloadStateChange(id, mobile, false)
        // The mounted video can still request its direct source.
        return false
      } finally {
        if (!cancelled && progressById.has(id)) {
          progressById.set(id, 1)
          reportProgress()
        }
      }
    }

    void (async () => {
      const initialPreload = Promise.allSettled(
        initialAssets.map((asset) => preloadAsset(asset, initialController.signal)),
      )
      const timedOut = await Promise.race([
        initialPreload.then(() => false),
        new Promise<true>((resolve) => {
          timeoutId = window.setTimeout(() => resolve(true), INITIAL_PRELOAD_TIMEOUT_MS)
        }),
      ])
      if (timedOut) {
        initialController.abort()
        await initialPreload
      }

      const remainingDisplayTime = MINIMUM_PRELOAD_DISPLAY_MS
        - (Date.now() - preloadStartedAt)
      if (remainingDisplayTime > 0) {
        await new Promise<void>((resolve) => {
          minimumDelayId = window.setTimeout(resolve, remainingDisplayTime)
        })
      }
      if (cancelled) return

      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      setPreloadedMode(mobile)
      onPreloadStateChange({ progress: 1, ready: true })

      for (const asset of segmentAssets) {
        if (cancelled) return
        if (loadedAssetIds.has(asset.id)) continue
        const loaded = await preloadAsset(asset, backgroundController.signal)
        if (!loaded && !cancelled) {
          await preloadAsset(asset, backgroundController.signal)
        }
      }
    })()

    return () => {
      cancelled = true
      initialController.abort()
      backgroundController.abort()
      if (minimumDelayId !== undefined) window.clearTimeout(minimumDelayId)
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl))
    }
  }, [
    mobile,
    onPreloadStateChange,
    onSegmentPreloadStateChange,
    reducedMotion,
    segments,
  ])

  const initialPreloadReady = preloadedMode === mobile
  const preloadedSources = preloadedMedia.mobile === mobile
    ? preloadedMedia.sources
    : {}

  if (reducedMotion !== false || mobile === null || !initialPreloadReady) return null

  return (
    <div className={styles.videoStack} aria-hidden="true">
      {segments.map((segment, index) => {
        const hasSource = mobile ? segment.videoMobile : segment.videoDesktop
        const isNextSegment = index === activeSegmentIndex + 1
        const shouldMount = mobile
          ? index === activeSegmentIndex || isNextSegment
          : Math.abs(index - activeSegmentIndex) <= 2
        if (!hasSource || !shouldMount) return null

        return (
          <ManagedVideo
            key={`${segment.id}-${mobile ? 'mobile' : 'desktop'}`}
            segment={segment}
            mobile={mobile}
            // Mobile WebViews (WeChat X5 / iOS WKWebView) get the direct HTTP
            // URL — blob: URLs render as a black screen there (see above).
            preloadedSource={mobile === false ? preloadedSources[segment.id] : undefined}
            preload={index === activeSegmentIndex || index === eagerSegmentIndex || isNextSegment
              ? 'auto'
              : 'none'}
            registerVideo={registerVideo}
            onVideoTimingChange={onVideoTimingChange}
          />
        )
      })}
      {activeSegmentIndex >= segments.length - 2 ? (
        <ReunionAmbientVideo
          key={`reunion-loop-${mobile ? 'mobile' : 'desktop'}`}
          mobile={mobile}
          registerAmbientVideo={registerAmbientVideo}
        />
      ) : null}
    </div>
  )
}
