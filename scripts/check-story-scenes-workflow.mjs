import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  STORY_CONNECTORS,
  STORY_FORMATS,
  STORY_SEGMENT_IDS,
  assertValidManifestPromptFiles,
  boundaryInputFingerprintMatches,
  inputFingerprint,
  manifestIssues,
  promptFormatRule,
  publishInventoryIssues,
} from './story-scenes-workflow.mjs'

const manifest = JSON.parse(await fs.readFile('media/story-scenes-v2.json', 'utf8'))
assert.deepEqual(manifestIssues(manifest), [])
assert.equal(STORY_SEGMENT_IDS.length, 11)
assert.equal(STORY_SEGMENT_IDS.filter((id) => id.startsWith('dive-')).length, 6)
assert.equal(STORY_CONNECTORS.length, 5)

const wrongDimensions = structuredClone(manifest)
wrongDimensions.formats.desktop.width = 1440
wrongDimensions.formats.desktop.height = 1440
assert.ok(manifestIssues(wrongDimensions).some((issue) => issue.includes('desktop.width')))
assert.ok(manifestIssues(wrongDimensions).some((issue) => issue.includes('desktop.height')))

const wrongConnectorOrder = structuredClone(manifest)
wrongConnectorOrder.connectors.reverse()
assert.ok(manifestIssues(wrongConnectorOrder).some((issue) => issue.includes('Connector id/from/to order')))

const invalidFormatPrompt = structuredClone(manifest)
invalidFormatPrompt.connectors[2].formatPromptFiles.square = null
assert.ok(manifestIssues(invalidFormatPrompt).some((issue) => issue.includes('formatPromptFiles contains unknown format')))
assert.ok(manifestIssues(invalidFormatPrompt).some((issue) => issue.includes('formatPromptFiles.square must be a repo-relative')))

const invalidFormatOverride = structuredClone(manifest)
invalidFormatOverride.connectors[3].formatPromptOverrides.square = null
assert.ok(manifestIssues(invalidFormatOverride).some((issue) => issue.includes('formatPromptOverrides contains unknown format')))
assert.ok(manifestIssues(invalidFormatOverride).some((issue) => issue.includes('formatPromptOverrides.square must be a repo-relative')))

const escapedFormatPrompt = structuredClone(manifest)
escapedFormatPrompt.connectors[2].formatPromptFiles.mobile = '../outside.md'
assert.ok(manifestIssues(escapedFormatPrompt).some((issue) => issue.includes('repo-relative story prompt')))

const conflictingFormatPrompt = structuredClone(manifest)
conflictingFormatPrompt.connectors[2].formatPromptOverrides = {
  mobile: 'media/prompts/story-scenes-v2/connector-little-devil-to-biker-rabbit-mobile.md',
}
assert.ok(manifestIssues(conflictingFormatPrompt).some((issue) => issue.includes('cannot configure both')))

const promptFiles = new Set([
  ...manifest.scenes.flatMap((scene) => [scene.imagePromptFile, scene.videoPromptFile]),
  ...manifest.connectors.flatMap((connector) => [
    connector.promptFile,
    ...Object.values(connector.formatPromptFiles ?? {}),
    ...Object.values(connector.formatPromptOverrides ?? {}),
  ]),
])
await Promise.all([...promptFiles].map(async (file) => {
  assert.equal((await fs.stat(file)).isFile(), true, `${file} must be a regular file`)
}))
await assertValidManifestPromptFiles(manifest)

const missingPrompt = structuredClone(manifest)
missingPrompt.scenes[0].imagePromptFile = 'media/prompts/story-scenes-v2/missing-prompt.md'
await assert.rejects(
  assertValidManifestPromptFiles(missingPrompt),
  /missing-prompt\.md: prompt file is missing/,
)

const promptFixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'story-prompt-files-'))
try {
  await Promise.all([...promptFiles].map(async (file) => {
    const target = path.join(promptFixtureRoot, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, '# prompt\n')
  }))
  const directoryPrompt = manifest.scenes[0].imagePromptFile
  await fs.rm(path.join(promptFixtureRoot, directoryPrompt))
  await fs.mkdir(path.join(promptFixtureRoot, directoryPrompt))
  await assert.rejects(
    assertValidManifestPromptFiles(manifest, promptFixtureRoot),
    new RegExp(`${directoryPrompt}: prompt path must be a regular file`),
  )
} finally {
  await fs.rm(promptFixtureRoot, { recursive: true, force: true })
}

const invalidManualSource = structuredClone(manifest)
invalidManualSource.scenes[2].manualImageSources.desktop.url = 'file:///tmp/biker-rabbit.png'
invalidManualSource.scenes[2].manualImageSources.desktop.sha256 = 'not-a-digest'
const invalidManualIssues = manifestIssues(invalidManualSource)
assert.ok(invalidManualIssues.some((issue) => issue.includes('manualImageSources.desktop.url')))
assert.ok(invalidManualIssues.some((issue) => issue.includes('manualImageSources.desktop.sha256')))

const fingerprintA = inputFingerprint({ model: 'seedance', prompt: 'locked', input: { b: 2, a: 1 } })
const fingerprintB = inputFingerprint({ input: { a: 1, b: 2 }, prompt: 'locked', model: 'seedance' })
const fingerprintC = inputFingerprint({ input: { a: 1, b: 2 }, prompt: 'changed', model: 'seedance' })
assert.equal(fingerprintA, fingerprintB)
assert.notEqual(fingerprintA, fingerprintC)

const currentBoundary = {
  expectedFingerprint: 'a'.repeat(64),
  sourceSha256: 'b'.repeat(64),
  sourceUrl: 'https://cdn.example.com/dive-jiuka.mp4',
  edgeSsim: 0.978654,
}
const reusedBoundaryTask = {
  inputFingerprint: 'c'.repeat(64),
  boundaryReuse: {
    reason: 'local-interior-repair',
    sourceSha256: currentBoundary.sourceSha256,
    sourceUrl: currentBoundary.sourceUrl,
    edgeSsim: currentBoundary.edgeSsim,
    reusedAt: '2026-08-04T08:00:00.000Z',
  },
}
assert.equal(boundaryInputFingerprintMatches(reusedBoundaryTask, currentBoundary), true)
assert.equal(reusedBoundaryTask.inputFingerprint, 'c'.repeat(64))
assert.equal(boundaryInputFingerprintMatches(
  { inputFingerprint: currentBoundary.expectedFingerprint },
  currentBoundary,
), true)

const reuseWithWrongSha = structuredClone(reusedBoundaryTask)
reuseWithWrongSha.boundaryReuse.sourceSha256 = 'd'.repeat(64)
assert.equal(boundaryInputFingerprintMatches(reuseWithWrongSha, currentBoundary), false)

const reuseWithWrongUrl = structuredClone(reusedBoundaryTask)
reuseWithWrongUrl.boundaryReuse.sourceUrl = 'https://cdn.example.com/other.mp4'
assert.equal(boundaryInputFingerprintMatches(reuseWithWrongUrl, currentBoundary), false)

assert.equal(boundaryInputFingerprintMatches(reusedBoundaryTask, {
  ...currentBoundary,
  edgeSsim: 0.949999,
}), false)

const reuseWithLowSsim = structuredClone(reusedBoundaryTask)
reuseWithLowSsim.boundaryReuse.edgeSsim = 0.949999
assert.equal(boundaryInputFingerprintMatches(reuseWithLowSsim, {
  ...currentBoundary,
  edgeSsim: 0.949999,
}), false)

const reuseWithWrongReason = structuredClone(reusedBoundaryTask)
reuseWithWrongReason.boundaryReuse.reason = 'manual-override'
assert.equal(boundaryInputFingerprintMatches(reuseWithWrongReason, currentBoundary), false)

const reuseWithInvalidTimestamp = structuredClone(reusedBoundaryTask)
reuseWithInvalidTimestamp.boundaryReuse.reusedAt = '2026-08-04'
assert.equal(boundaryInputFingerprintMatches(reuseWithInvalidTimestamp, currentBoundary), false)

const reuseWithExtraField = structuredClone(reusedBoundaryTask)
reuseWithExtraField.boundaryReuse.note = 'unvalidated metadata'
assert.equal(boundaryInputFingerprintMatches(reuseWithExtraField, currentBoundary), false)

assert.match(promptFormatRule('image', 'desktop'), /文案负空间/)
assert.match(promptFormatRule('dive', 'mobile'), /输入首帧/)
assert.match(promptFormatRule('connector', 'desktop'), /首尾边界帧/)
assert.doesNotMatch(promptFormatRule('connector', 'desktop'), /文案负空间/)
assert.throws(() => promptFormatRule(undefined, 'desktop'), /Unknown prompt kind/)

const generatorSource = await fs.readFile('scripts/generate-story-scenes.mjs', 'utf8')
assert.match(generatorSource, /await validateManifest\(\)/)
assert.match(generatorSource, /await assertValidManifestPromptFiles\(manifest\)/)
assert.match(generatorSource, /edgeSsim = await frameSsim/)
assert.match(generatorSource, /fingerprintMatches: boundaryInputFingerprintMatches/)
assert.match(generatorSource, /REMOTE_HASH_TIMEOUT_MS = 45_000/)
assert.match(generatorSource, /REMOTE_HASH_ATTEMPTS = 3/)
assert.match(generatorSource, /--adopt-legacy requires --only/)
assert.match(generatorSource, /legacy provider URL does not match the saved provider video/)
assert.match(generatorSource, /Story generator is already running/)
assert.match(generatorSource, /\[recovered publish\]/)
assert.match(generatorSource, /boundary frame SSIM/)
assert.match(generatorSource, /connector first-frame SSIM/)
assert.match(generatorSource, /\[encoded existing\]/)
assert.match(generatorSource, /locked-boundaries-v1/)
assert.match(generatorSource, /Number\.parseFloat\(line\)/)
const legacyRabbitAdoptionSource = await fs.readFile('scripts/adopt-biker-rabbit-candidates.mjs', 'utf8')
assert.match(legacyRabbitAdoptionSource, /Refusing to restore old generated biker-rabbit candidates/)
const promptCalls = [...generatorSource.matchAll(/await readPrompt\(([^)]*)\)/g)]
assert.equal(promptCalls.length, 4)
for (const [, args] of promptCalls) {
  assert.match(args, /,\s*'(image|dive|connector)'\s*$/)
}

const validInventory = [
  {
    key: 'video/desktop/dive-jiuka',
    kind: 'video',
    exists: true,
    requiresTask: true,
    taskStatus: 'complete',
    requiresFingerprint: true,
    fingerprintMatches: true,
    requiresArtifactFingerprint: true,
    artifactFingerprintMatches: true,
    mediaIssues: [],
  },
  {
    key: 'boundary/desktop/dive-jiuka/first',
    kind: 'boundary',
    exists: true,
    requiresTask: true,
    taskStatus: 'complete',
    requiresFingerprint: true,
    fingerprintMatches: true,
    requiresArtifactFingerprint: true,
    artifactFingerprintMatches: true,
    boundarySourceKind: 'final-encoded-external',
    mediaIssues: [],
  },
]
assert.deepEqual(publishInventoryIssues(validInventory), [])

const rejectedInventory = structuredClone(validInventory)
rejectedInventory[0].exists = false
rejectedInventory[0].fingerprintMatches = false
rejectedInventory[1].boundarySourceKind = 'provider-original'
const rejectedIssues = publishInventoryIssues(rejectedInventory)
assert.ok(rejectedIssues.some((issue) => issue.includes('candidate file is missing')))
assert.ok(rejectedIssues.some((issue) => issue.includes('input fingerprint is stale')))
assert.ok(rejectedIssues.some((issue) => issue.includes('boundary source must be final-encoded-external')))

assert.deepEqual(STORY_FORMATS.desktop, {
  ratio: '16:9', width: 1920, height: 1080, gop: 8, crf: 20,
})
assert.deepEqual(STORY_FORMATS.mobile, {
  ratio: '9:16', width: 1080, height: 1920, gop: 4, crf: 23,
})

console.log('Story scene workflow checks passed: manifest, prompt kinds, fingerprints, and publish rejection.')
