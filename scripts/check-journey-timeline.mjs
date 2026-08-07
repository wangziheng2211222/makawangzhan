import assert from 'node:assert/strict'

import {
  buildSegmentTimeline,
  findConnectorSegmentIndex,
  getJourneyFrame,
  getRobotCopyOpacity,
  getTownCopyOpacity,
  lingerEase,
} from '../lib/journey-timeline.ts'
import {
  canRetainJourneyVideoFrame,
  canShowJourneyVideo,
  hasCompletedJourneyVideoPlayback,
  shouldSeekJourneyVideo,
  shouldResumeJourneyVideoPlayback,
  subscribeToMediaQuery,
} from '../lib/journey-video-state.ts'
import { validateJourneyMedia } from '../lib/validate-journey-media.ts'

const ids = [
  'dive-town',
  'connector-town-to-jiuka',
  'dive-jiuka',
  'connector-jiuka-to-little-devil',
  'dive-little-devil',
  'connector-little-devil-to-biker-rabbit',
  'dive-biker-rabbit',
  'connector-biker-rabbit-to-pipi',
  'dive-pipi',
  'connector-pipi-to-reunion',
  'dive-reunion',
]

const segments = ids.map((id, index) => ({
  id,
  kind: index % 2 === 0 ? 'dive-in' : 'connector',
  chapterIndex: Math.floor(index / 2),
  nextChapterIndex: index % 2 === 1 ? Math.floor(index / 2) + 1 : undefined,
  videoDesktop: `/media/desktop/${id}.mp4`,
  videoMobile: `/media/mobile/${id}.mp4`,
  posterDesktop: `/images/desktop/${id}.jpg`,
  posterMobile: `/images/mobile/${id}.jpg`,
  scrollWeight: index % 2 === 0 ? 1.2 : 0.75,
  linger: index % 2 === 0 ? 0.35 : undefined,
}))

assert.deepEqual(validateJourneyMedia(segments), [])
assert.equal(segments.filter((segment) => segment.kind === 'dive-in').length, 6)
assert.equal(segments.filter((segment) => segment.kind === 'connector').length, 5)
assert.equal(findConnectorSegmentIndex(segments, 1), 3)
assert.equal(findConnectorSegmentIndex(segments, 4), 9)
assert.equal(findConnectorSegmentIndex(segments, 5), -1)

const { entries, totalWeight } = buildSegmentTimeline(segments)
assert.equal(totalWeight, 10.95)

const firstBoundary = entries[0].end
const boundaryProgress = firstBoundary / totalWeight
const boundaryFrame = getJourneyFrame(boundaryProgress, segments, 6)
assert.equal(boundaryFrame.segments.length, 1)
assert.equal(boundaryFrame.segments[0].id, 'connector-town-to-jiuka')
assert.equal(boundaryFrame.segments[0].opacity, 1)

// With crossfade, a position just past a boundary may show 2 segments:
// the outgoing one fading out and the incoming one at full opacity.
for (let step = 0; step <= 100; step += 1) {
  const progress = step / 100
  const frame = getJourneyFrame(progress, segments, 6)
  assert.deepEqual(frame, getJourneyFrame(progress, segments, 6))
  assert.ok(frame.segments.length >= 1 && frame.segments.length <= 2,
    `expected 1-2 segments at progress ${progress}, got ${frame.segments.length}`)
  const fullOpacitySegment = frame.segments.find((s) => s.opacity === 1)
  assert.ok(fullOpacitySegment, `expected at least one segment with opacity 1 at progress ${progress}`)
}

let previousLingerValue = 0
for (let step = 0; step <= 100; step += 1) {
  const value = lingerEase(step / 100, 0.45)
  assert.ok(value >= previousLingerValue)
  previousLingerValue = value
}
assert.equal(lingerEase(0, 0.45), 0)
assert.equal(lingerEase(1, 0.45), 1)

assert.equal(getRobotCopyOpacity(0), 0)
assert.equal(getRobotCopyOpacity(0.05), 0)
assert.ok(Math.abs(getRobotCopyOpacity(0.1) - 0.5) < 1e-9)
assert.ok(Math.abs(getRobotCopyOpacity(0.15) - 1) < 1e-9)
assert.ok(Math.abs(getRobotCopyOpacity(0.68) - 1) < 1e-9)
assert.equal(getRobotCopyOpacity(0.75), 1)
assert.equal(getRobotCopyOpacity(0.82), 1)
assert.equal(getRobotCopyOpacity(1), 1)

assert.equal(getTownCopyOpacity(0), 1)
assert.equal(getTownCopyOpacity(0.38), 1)
assert.ok(Math.abs(getTownCopyOpacity(0.45) - 0.5) < 1e-9)
assert.ok(getTownCopyOpacity(0.52) < 1e-9)
assert.equal(getTownCopyOpacity(1), 0)

const readyVideo = {
  currentTime: 1.5,
  readyState: 2,
  seeking: false,
  error: null,
  dataset: { failed: 'false' },
}
assert.equal(canShowJourneyVideo(readyVideo, 1.5), true)
assert.equal(canShowJourneyVideo({ ...readyVideo, seeking: true }, 1.5), false)
assert.equal(canShowJourneyVideo({ ...readyVideo, error: new Error('decode failed') }, 1.5), false)
assert.equal(canShowJourneyVideo({ ...readyVideo, dataset: { failed: 'true' } }, 1.5), false)
assert.equal(canShowJourneyVideo({ ...readyVideo, currentTime: 1.6 }, 1.5), false)
assert.equal(canShowJourneyVideo({ ...readyVideo, currentTime: 1.54 }, 1.5), true)
assert.equal(shouldSeekJourneyVideo(readyVideo, 1.6), true)
assert.equal(shouldSeekJourneyVideo({ ...readyVideo, seeking: true }, 1.6), false)
assert.equal(shouldSeekJourneyVideo(readyVideo, 1.54), false)

const presentedVideo = {
  ...readyVideo,
  dataset: { failed: 'false', ready: 'true' },
}
assert.equal(canRetainJourneyVideoFrame(presentedVideo), true)
assert.equal(canRetainJourneyVideoFrame({ ...presentedVideo, seeking: true }), true)
assert.equal(canRetainJourneyVideoFrame({
  ...presentedVideo,
  dataset: { failed: 'false', ready: 'false' },
}), false)
assert.equal(canRetainJourneyVideoFrame({
  ...presentedVideo,
  dataset: { failed: 'true', ready: 'true' },
}), false)
assert.equal(canRetainJourneyVideoFrame({ ...presentedVideo, readyState: 1 }), true)
assert.equal(canRetainJourneyVideoFrame({ ...presentedVideo, readyState: 0 }), false)

assert.equal(hasCompletedJourneyVideoPlayback({
  currentTime: 4,
  duration: 5,
  ended: true,
  paused: true,
}), true)
assert.equal(hasCompletedJourneyVideoPlayback({
  currentTime: 4.92,
  duration: 5,
  ended: false,
  paused: true,
}), true)
assert.equal(hasCompletedJourneyVideoPlayback({
  currentTime: 4.92,
  duration: 5,
  ended: false,
  paused: false,
}), false)
assert.equal(hasCompletedJourneyVideoPlayback({
  currentTime: 3,
  duration: 5,
  ended: false,
  paused: true,
}), false)
assert.equal(hasCompletedJourneyVideoPlayback({
  currentTime: 0,
  duration: Number.NaN,
  ended: false,
  paused: true,
}), false)
assert.equal(shouldResumeJourneyVideoPlayback({
  currentTime: 2,
  duration: 5,
  ended: false,
  paused: true,
}), true)
assert.equal(shouldResumeJourneyVideoPlayback({
  currentTime: 2,
  duration: 5,
  ended: false,
  paused: false,
}), false)
assert.equal(shouldResumeJourneyVideoPlayback({
  currentTime: 4.92,
  duration: 5,
  ended: false,
  paused: true,
}), false)

const mediaListener = () => undefined
let modernListener
const unsubscribeModern = subscribeToMediaQuery({
  addEventListener: (type, listener) => {
    assert.equal(type, 'change')
    modernListener = listener
  },
  removeEventListener: (type, listener) => {
    assert.equal(type, 'change')
    assert.equal(listener, modernListener)
  },
}, mediaListener)
assert.equal(modernListener, mediaListener)
unsubscribeModern()

let legacyListener
const unsubscribeLegacy = subscribeToMediaQuery({
  addListener: (listener) => { legacyListener = listener },
  removeListener: (listener) => { assert.equal(listener, legacyListener) },
}, mediaListener)
assert.equal(legacyListener, mediaListener)
unsubscribeLegacy()

const unsubscribeWithoutListenerApi = subscribeToMediaQuery({}, mediaListener)
assert.equal(typeof unsubscribeWithoutListenerApi, 'function')
unsubscribeWithoutListenerApi()

console.log('Journey timeline checks passed: 6 dives, 5 connectors, opaque cuts, monotonic linger, latched video presentation, guarded seeking and media queries.')
