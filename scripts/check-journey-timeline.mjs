import assert from 'node:assert/strict'

import {
  buildSegmentTimeline,
  getJourneyFrame,
  getRobotCopyOpacity,
  getTownCopyOpacity,
  lingerEase,
} from '../lib/journey-timeline.ts'
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
  posterDesktop: `/desktop/${id}.webp`,
  posterMobile: `/mobile/${id}.webp`,
  scrollWeight: index % 2 === 0 ? 1.2 : 0.75,
  linger: index % 2 === 0 ? 0.35 : undefined,
}))

assert.deepEqual(validateJourneyMedia(segments), [])
assert.equal(segments.filter((segment) => segment.kind === 'dive-in').length, 6)
assert.equal(segments.filter((segment) => segment.kind === 'connector').length, 5)

const { entries, totalWeight } = buildSegmentTimeline(segments)
assert.equal(totalWeight, 10.95)

const firstBoundary = entries[0].end
const boundaryProgress = firstBoundary / totalWeight
const boundaryFrame = getJourneyFrame(boundaryProgress, segments, 6)
assert.equal(boundaryFrame.segments.length, 1)
assert.equal(boundaryFrame.segments[0].id, 'connector-town-to-jiuka')
assert.equal(boundaryFrame.segments[0].opacity, 1)

for (let step = 0; step <= 100; step += 1) {
  const progress = step / 100
  const frame = getJourneyFrame(progress, segments, 6)
  assert.deepEqual(frame, getJourneyFrame(progress, segments, 6))
  assert.equal(frame.segments.length, 1)
  assert.equal(frame.segments[0].opacity, 1)
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
assert.ok(Math.abs(getRobotCopyOpacity(0.75) - 0.5) < 1e-9)
assert.ok(getRobotCopyOpacity(0.82) < 1e-9)
assert.equal(getRobotCopyOpacity(1), 0)

assert.equal(getTownCopyOpacity(0), 1)
assert.equal(getTownCopyOpacity(0.38), 1)
assert.ok(Math.abs(getTownCopyOpacity(0.45) - 0.5) < 1e-9)
assert.ok(getTownCopyOpacity(0.52) < 1e-9)
assert.equal(getTownCopyOpacity(1), 0)

console.log('Journey timeline checks passed: 6 dives, 5 connectors, opaque cuts, monotonic linger.')
