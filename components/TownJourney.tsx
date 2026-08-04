'use client'

import Image from 'next/image'
import {
  type CSSProperties,
  type RefCallback,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { JourneyVideoLayer } from '@/components/JourneyVideoLayer'
import { JD_STORE_URL } from '@/data/robots'
import { trackEvent } from '@/lib/analytics'
import {
  clamp,
  getJourneyFrame,
  getRobotCopyOpacity,
  getTownCopyOpacity,
} from '@/lib/journey-timeline'
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

const SCRUB_TIME_CONSTANT_MS = 90
const SCRUB_EPSILON = 0.0001

function SceneLayer({
  chapter,
  robot,
  isActive,
  index,
}: {
  chapter: JourneyChapter
  robot?: RobotProfile
  isActive: boolean
  index: number
}) {
  const isTown = chapter.id === 'town' || chapter.id === 'reunion'
  const alt = chapter.id === 'town'
    ? '从太空看向地球，玛卡小镇的旅程即将开始'
    : chapter.id === 'reunion'
      ? '黑夜中的玛卡小镇，萤火虫在喷泉与树丛间飞舞'
    : `${chapter.title}机器人`

  if (!isTown && robot && chapter.environmentDesktop && chapter.environmentMobile) {
    return (
      <div className={styles.chapterArtwork}>
        <picture className={styles.environmentPicture}>
          <source media="(max-width: 800px)" srcSet={chapter.environmentMobile} />
          <Image
            src={chapter.environmentDesktop}
            alt=""
            fill
            loading={isActive ? 'eager' : 'lazy'}
            sizes="100vw"
            style={{ objectFit: 'cover' }}
          />
        </picture>
        <div
          className={styles.productPicture}
          data-low-resolution={robot.id === 'biker-rabbit' || robot.id === 'pipi' ? 'true' : 'false'}
        >
          <Image
            src={robot.productImage}
            alt={alt}
            fill
            loading={isActive ? 'eager' : 'lazy'}
            sizes="(max-width: 800px) 72vw, 42vw"
            style={{ objectFit: 'contain' }}
          />
        </div>
      </div>
    )
  }

  return (
    <picture className={styles.scenePicture}>
      <source media="(max-width: 800px)" srcSet={chapter.posterMobile} />
      <Image
        className={isTown ? styles.townImage : styles.robotImage}
        src={chapter.posterDesktop}
        alt={alt}
        fill
        priority={index === 0}
        loading={isActive || index === 0 ? 'eager' : 'lazy'}
        sizes={isTown ? '(max-width: 700px) 100vw, 68vw' : '(max-width: 700px) 88vw, 48vw'}
      />
    </picture>
  )
}

export function TownJourney({
  chapters,
  segments,
  robots,
}: TownJourneyProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [activeSegmentIndex, setActiveSegmentIndex] = useState(0)
  const [hasPassedFirstViewport, setHasPassedFirstViewport] = useState(false)
  const [reducedMotion, setReducedMotion] = useState<boolean | null>(null)
  const journeyRef = useRef<HTMLElement>(null)
  const sceneRefs = useRef<Array<HTMLElement | null>>([])
  const navRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndexRef = useRef(0)
  const activeSegmentIndexRef = useRef(0)
  const hasPassedFirstViewportRef = useRef(false)
  const frameRef = useRef<number | null>(null)
  const targetProgressRef = useRef(0)
  const renderedProgressRef = useRef(0)
  const previousFrameTimeRef = useRef<number | null>(null)
  const scrubCallbackRef = useRef<(timestamp: number) => void>(() => undefined)
  const suppressJourneyEventsRef = useRef(false)
  const videoRefs = useRef(new Map<string, HTMLVideoElement>())
  const ambientVideoRef = useRef<HTMLVideoElement | null>(null)
  const userReadyRef = useRef(false)
  const totalScrollWeight = useMemo(
    () => segments.reduce((total, segment) => total + segment.scrollWeight, 0),
    [segments],
  )
  const segmentOffsets = useMemo(
    () => segments.map((_, index) => (
      segments.slice(0, index).reduce((total, segment) => total + segment.scrollWeight, 0)
    )),
    [segments],
  )

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

  const primeVideo = useCallback((video: HTMLVideoElement) => {
    const playback = video.play()
    if (playback) playback.then(() => video.pause()).catch(() => undefined)
  }, [])

  const registerVideo = useCallback(
    (segmentId: string, video: HTMLVideoElement | null) => {
      if (!video) {
        videoRefs.current.delete(segmentId)
        return
      }
      videoRefs.current.set(segmentId, video)
      if (userReadyRef.current) primeVideo(video)
    },
    [primeVideo],
  )

  const registerAmbientVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      ambientVideoRef.current = video
      if (video && userReadyRef.current) primeVideo(video)
    },
    [primeVideo],
  )

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
    const townFrame = journeyFrame.segments.find((frame) => frame.id === 'dive-town')
    const spacePhase = townFrame
      ? 1 - clamp((townFrame.mediaProgress - 0.34) / 0.08)
      : 0

    journey.style.setProperty('--segment-progress', journeyFrame.localProgress.toFixed(4))
    journey.style.setProperty('--town-space-phase', spacePhase.toFixed(4))
    commitActiveSegmentIndex(journeyFrame.activeSegmentIndex)
    commitActiveIndex(journeyFrame.activeChapterIndex)

    const visibleSegments = new Map(
      journeyFrame.segments.map((frame) => [frame.id, frame]),
    )
    videoRefs.current.forEach((video, segmentId) => {
      const videoFrame = visibleSegments.get(segmentId as JourneyMediaSegment['id'])
      video.style.opacity = (videoFrame?.opacity ?? 0).toFixed(4)
      if (
        !videoFrame
        || videoFrame.opacity <= 0
        || video.readyState < 1
        || !Number.isFinite(video.duration)
      ) return

      const targetTime = Math.min(
        videoFrame.mediaProgress * video.duration,
        Math.max(video.duration - 0.04, 0),
      )
      if (Math.abs(video.currentTime - targetTime) > 0.012) {
        try {
          video.currentTime = targetTime
        } catch {
          // The next timing update retries seeks rejected before metadata is ready.
        }
      }
    })

    const ambientVideo = ambientVideoRef.current
    const ambientOpacity = segment.id === 'dive-reunion'
      ? clamp(journeyFrame.localProgress / 0.08)
      : 0
    if (ambientVideo) {
      ambientVideo.style.opacity = ambientOpacity.toFixed(4)
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
        copyOpacity = isActiveRobotDive
          ? chapterFrame.opacity * getRobotCopyOpacity(chapterFrame.progress)
          : 0
      }
      const copyShift = (1 - Math.min(copyOpacity, 1)) * 18
      const sceneScale = 1.015 + chapterFrame.progress * 0.045
      const sceneShift = (chapterFrame.progress - 0.5) * -14
      const productShift = sceneShift * -0.7

      scene.style.setProperty('--scene-opacity', chapterFrame.opacity.toFixed(4))
      scene.style.setProperty('--scene-progress', chapterFrame.progress.toFixed(4))
      scene.style.setProperty('--copy-opacity', copyOpacity.toFixed(4))
      scene.style.setProperty('--copy-shift', `${copyShift.toFixed(2)}px`)
      scene.style.setProperty('--scene-scale', sceneScale.toFixed(4))
      scene.style.setProperty('--scene-shift', `${sceneShift.toFixed(2)}px`)
      scene.style.setProperty('--product-shift', `${productShift.toFixed(2)}px`)
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
    if (!journey || reducedMotion !== false) return

    const rect = journey.getBoundingClientRect()
    const scrollableDistance = Math.max(journey.offsetHeight - window.innerHeight, 1)
    targetProgressRef.current = clamp(-rect.top / scrollableDistance)

    if (frameRef.current === null) {
      frameRef.current = window.requestAnimationFrame(runScrubFrame)
    }
  }, [reducedMotion, runScrubFrame])

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncPreference = () => setReducedMotion(mediaQuery.matches)
    syncPreference()
    mediaQuery.addEventListener('change', syncPreference)
    return () => mediaQuery.removeEventListener('change', syncPreference)
  }, [])

  useEffect(() => {
    if (reducedMotion !== false) {
      userReadyRef.current = true
      return
    }

    userReadyRef.current = true
    videoRefs.current.forEach(primeVideo)
    if (ambientVideoRef.current) primeVideo(ambientVideoRef.current)
  }, [primeVideo, reducedMotion])

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

  useEffect(() => () => {
    videoRefs.current.forEach((video) => {
      video.pause()
      video.removeAttribute('src')
      video.load()
    })
    videoRefs.current.clear()
    const ambientVideo = ambientVideoRef.current
    if (ambientVideo) {
      ambientVideo.pause()
      ambientVideo.removeAttribute('src')
      ambientVideo.load()
    }
    ambientVideoRef.current = null
  }, [])

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
      commitActiveIndex(index)
      commitActiveSegmentIndex(targetSegmentIndex)

      if (reducedMotion === true) {
        sceneRefs.current[index]?.scrollIntoView({ behavior: 'auto', block: 'start' })
      } else {
        const journeyTop = window.scrollY + journey.getBoundingClientRect().top
        const distance = Math.max(journey.offsetHeight - window.innerHeight, 1)
        const segment = segments[targetSegmentIndex]
        const chapterMidpoint = (
          segmentOffsets[targetSegmentIndex] + segment.scrollWeight * 0.5
        ) / totalScrollWeight
        window.scrollTo({ top: journeyTop + distance * chapterMidpoint, behavior: 'auto' })
      }

      window.requestAnimationFrame(() => {
        suppressJourneyEventsRef.current = false
        requestJourneyUpdate()
      })
    },
    [
      commitActiveIndex,
      commitActiveSegmentIndex,
      reducedMotion,
      segmentOffsets,
      segments,
      totalScrollWeight,
      requestJourneyUpdate,
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

  return (
    <section
      id="town-journey"
      ref={journeyRef}
      className={styles.journey}
      style={journeyStyle}
      aria-label="玛卡小镇角色旅程"
      data-active-chapter={chapters[activeIndex].id}
      data-reduced-motion={reducedMotion === true ? 'true' : 'false'}
    >
      <div className={styles.stage}>
        <JourneyVideoLayer
          segments={segments}
          activeSegmentIndex={activeSegmentIndex}
          reducedMotion={reducedMotion}
          registerVideo={registerVideo}
          registerAmbientVideo={registerAmbientVideo}
          onVideoTimingChange={requestJourneyUpdate}
        />
        <div className={styles.sceneStack}>
          {chapters.map((chapter, index) => {
            const isActive = index === activeIndex
            const isHidden = reducedMotion !== true && !isActive
            const robot = chapter.robotId
              ? robots.find((item) => item.id === chapter.robotId)
              : undefined
            const shouldRenderMedia = reducedMotion === true

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
                {shouldRenderMedia ? (
                  <SceneLayer
                    chapter={chapter}
                    robot={robot}
                    isActive={isActive || reducedMotion === true}
                    index={index}
                  />
                ) : null}
                <div
                  className={`${styles.copy} ${robot ? styles.robotCopy : ''} ${index === 0 ? styles.townCopy : ''} ${chapter.id === 'reunion' ? styles.reunionCopy : ''}`}
                >
                  {index === 0 ? (
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
                  ) : (
                    <h2 tabIndex={-1}>
                      {robot ? <span>{robot.englishName}</span> : null}
                      {chapter.id === 'reunion' ? (
                        <>
                          玛卡小镇
                          <br />
                          新成员陆续加入中
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
                  {robot?.ctaHref && robot.ctaLabel ? (
                    <a
                      className={styles.sceneAction}
                      href={robot.ctaHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`查看${robot.name}详情`}
                      onClick={() => {
                        trackEvent('business_cta_click', {
                          cta_id: `chapter_${robot.id}_detail`,
                          cta_label: robot.ctaLabel,
                          robot_id: robot.id,
                          source: 'chapter',
                          destination: robot.ctaHref,
                        })
                      }}
                    >
                      {robot.ctaLabel}
                    </a>
                  ) : null}
                  {chapter.id === 'reunion' ? (
                    <a
                      className={styles.sceneAction}
                      href={JD_STORE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label="前往京东查看玛卡小镇详情"
                      onClick={() => {
                        trackEvent('business_cta_click', {
                          cta_id: 'reunion_town_detail',
                          cta_label: '查看详情',
                          source: 'reunion',
                          destination: JD_STORE_URL,
                        })
                      }}
                    >
                      查看详情
                    </a>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>

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
