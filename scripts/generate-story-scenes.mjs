import { createHash } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'

import sharp from 'sharp'

import {
  STORY_CONNECTORS,
  STORY_FORMATS,
  STORY_SEGMENT_IDS,
  assertValidManifest,
  assertValidManifestPromptFiles,
  boundaryInputFingerprintMatches,
  inputFingerprint,
  promptFormatRule,
  publishInventoryIssues,
} from './story-scenes-workflow.mjs'

const API_BASE = 'http://ai-platform-dev.cds8.cn'
const TASK_PATH = '/v1/task/get'
const EXTRACT_PATH = '/v1/media/create/extract'
const INTERNAL_OSS_HOST = 'ai-platform-resource-test.oss-cn-shanghai-internal.aliyuncs.com'
const CDN_HOST = 'cdn-ai-platform-resource-test.cds8.cn'
const FFMPEG = '/opt/homebrew/bin/ffmpeg'
const FFPROBE = '/opt/homebrew/bin/ffprobe'
const REMOTE_HASH_TIMEOUT_MS = 45_000
const REMOTE_HASH_ATTEMPTS = 3

const { values } = parseArgs({
  options: {
    manifest: { type: 'string', default: 'media/story-scenes-v2.json' },
    stage: { type: 'string', default: 'all' },
    only: { type: 'string' },
    'max-in-flight': { type: 'string', default: '4' },
    'poll-seconds': { type: 'string', default: '10' },
    'adopt-legacy': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
  },
})

const allowedStages = new Set(['images', 'dives', 'existing', 'boundaries', 'connectors', 'verify', 'publish', 'all'])
if (!allowedStages.has(values.stage)) {
  throw new Error('--stage must be images, dives, existing, boundaries, connectors, verify, publish, or all.')
}

const maxInFlight = Number.parseInt(values['max-in-flight'], 10)
const pollMs = Number.parseInt(values['poll-seconds'], 10) * 1000
const onlyPatterns = values.only?.split(',').map((pattern) => pattern.trim()).filter(Boolean) ?? []
if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 8) {
  throw new Error('--max-in-flight must be an integer from 1 to 8.')
}
if (!Number.isFinite(pollMs) || pollMs < 5000) {
  throw new Error('--poll-seconds must be at least 5.')
}
if (values.force && onlyPatterns.length === 0) {
  throw new Error('--force requires --only so paid tasks cannot be regenerated accidentally.')
}
if (values['adopt-legacy'] && onlyPatterns.length === 0) {
  throw new Error('--adopt-legacy requires --only so legacy provenance cannot be applied broadly.')
}
if (values['adopt-legacy'] && values.force) {
  throw new Error('--adopt-legacy and --force are mutually exclusive.')
}

const manifestPath = path.resolve(values.manifest)
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const outputRoot = path.resolve('output/story-scenes-v2')
const statePath = path.join(outputRoot, 'state.json')
const imageRoot = path.join(outputRoot, 'images')
const providerRoot = path.join(outputRoot, 'provider-video')
const videoRoot = path.join(outputRoot, 'videos')
const boundaryRoot = path.join(outputRoot, 'boundaries')
const publishStagingRoot = path.join(outputRoot, 'publish-staging')
const runLockPath = path.join(outputRoot, '.generator.lock')
const publishJournalPath = path.join(outputRoot, '.publish-transaction.json')

await validateManifest()
await fs.access(FFMPEG, fs.constants.X_OK)
await fs.access(FFPROBE, fs.constants.X_OK)
await acquireRunLock()
await recoverInterruptedPublish()

let state = await readJson(statePath, {
  version: 1,
  manifest: path.relative(process.cwd(), manifestPath),
  tasks: {},
})
let saveQueue = Promise.resolve()

async function acquireRunLock() {
  await fs.mkdir(outputRoot, { recursive: true })
  let handle
  try {
    handle = await fs.open(runLockPath, 'wx')
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const rawOwner = await fs.readFile(runLockPath, 'utf8').catch(() => '')
    let owner
    try {
      owner = JSON.parse(rawOwner)
    } catch {
      owner = { pid: Number.parseInt(rawOwner, 10) }
    }
    let ownerIsRunning = false
    if (Number.isInteger(owner.pid) && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0)
        ownerIsRunning = true
      } catch (processError) {
        if (processError.code !== 'ESRCH') throw processError
      }
    }
    if (!ownerIsRunning) {
      await fs.rm(runLockPath, { force: true })
      return acquireRunLock()
    }
    throw new Error(`Story generator is already running (lock owner PID ${owner.pid}).`)
  }
  await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`)
  await handle.close()
  process.on('exit', () => {
    try {
      unlinkSync(runLockPath)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  })
}

async function recoverInterruptedPublish() {
  const journal = await readJson(publishJournalPath, null)
  if (!journal) return
  if (journal.phase === 'committed') {
    const modified = []
    for (const item of journal.items ?? []) {
      if (
        item.publishedSha256
        && await fileSha256OrNull(item.destination) !== item.publishedSha256
      ) modified.push(item.destination)
    }
    await Promise.allSettled((journal.items ?? []).map((item) =>
      fs.rm(item.temporary, { force: true })))
    await fs.rm(publishJournalPath, { force: true })
    console.log(`[recovered publish] finalized ${journal.items?.length ?? 0} committed files`)
    if (modified.length) {
      console.warn(`[recovered publish] preserved ${modified.length} files modified after commit:\n- ${modified.join('\n- ')}`)
    }
    return
  }

  const attempted = (journal.items ?? []).slice(0, journal.attemptedCount ?? 0).reverse()
  const isLegacyJournal = journal.version !== 2 || attempted.some((item) =>
    !Object.hasOwn(item, 'destinationSha256') || !item.publishedSha256)
  if (isLegacyJournal) {
    await Promise.allSettled((journal.items ?? []).map((item) =>
      fs.rm(item.temporary, { force: true })))
    throw new Error(
      `Legacy publish recovery journal lacks destination fingerprints; preserved public files and journal for manual review: ${publishJournalPath}`,
    )
  }

  const conflicts = []
  for (const item of attempted) {
    const currentSha256 = await fileSha256OrNull(item.destination)
    if (currentSha256 === item.publishedSha256) {
      if (item.existed) {
        if (await fileSha256OrNull(item.backup) === item.destinationSha256) {
          await fs.copyFile(item.backup, item.destination)
        } else {
          conflicts.push(`${item.destination} (backup fingerprint mismatch)`)
        }
      } else await fs.rm(item.destination, { force: true })
    } else if (currentSha256 !== item.destinationSha256) {
      conflicts.push(item.destination)
    }
  }
  await Promise.allSettled((journal.items ?? []).map((item) =>
    fs.rm(item.temporary, { force: true })))
  if (conflicts.length) {
    throw new Error(`Interrupted publish has externally modified destinations; preserved them and kept the recovery journal:\n- ${conflicts.join('\n- ')}`)
  }
  await fs.rm(publishJournalPath, { force: true })
  console.log(`[recovered publish] rolled back ${attempted.length} attempted files`)
}

if (values.force) {
  const stagePrefixes = {
    images: ['image/'],
    dives: ['video/'],
    existing: [],
    boundaries: ['boundary/'],
    connectors: ['connector/'],
    verify: [],
    publish: [],
    all: ['image/', 'video/', 'boundary/', 'connector/'],
  }[values.stage]
  for (const [key] of Object.entries({ ...state.tasks })) {
    if (
      !stagePrefixes.some((prefix) => key.startsWith(prefix))
      || !onlyPatterns.some((pattern) => key.includes(pattern))
    ) continue
    await supersedeTaskAndDownstream(key, 'forced by CLI')
  }
}

async function validateManifest() {
  assertValidManifest(manifest)
  await assertValidManifestPromptFiles(manifest)
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

async function saveState() {
  const snapshot = `${JSON.stringify(state, null, 2)}\n`
  const temporary = `${statePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  saveQueue = saveQueue.then(async () => {
    await fs.mkdir(path.dirname(statePath), { recursive: true })
    await fs.writeFile(temporary, snapshot)
    await fs.rename(temporary, statePath)
  })
  return saveQueue
}

async function sha256File(file) {
  const hash = createHash('sha256')
  hash.update(await fs.readFile(file))
  return hash.digest('hex')
}

async function fileSha256OrNull(file) {
  return await fileExists(file) ? sha256File(file) : null
}

const remoteSha256Cache = new Map()

async function sha256Remote(url) {
  const resolved = publicUrl(url)
  if (!remoteSha256Cache.has(resolved)) {
    remoteSha256Cache.set(resolved, fetchBuffer(resolved).then((buffer) =>
      createHash('sha256').update(buffer).digest('hex')))
  }
  return remoteSha256Cache.get(resolved)
}

function dependentTaskKeys(key) {
  const keys = new Set([key])
  const [kind, format, id] = key.split('/')

  if (kind === 'image' || kind === 'video') {
    const videoId = kind === 'image' ? id : key.split('/')[2]
    if (kind === 'image') keys.add(`video/${format}/${videoId}`)
    for (const connector of STORY_CONNECTORS) {
      if (connector.from !== videoId && connector.to !== videoId) continue
      const edge = connector.from === videoId ? 'last' : 'first'
      keys.add(`boundary/${format}/${videoId}/${edge}`)
      keys.add(`connector/${format}/${connector.id}`)
    }
  }

  if (kind === 'boundary') {
    const edge = key.split('/')[3]
    for (const connector of STORY_CONNECTORS) {
      if (
        (connector.from === id && edge === 'last')
        || (connector.to === id && edge === 'first')
      ) keys.add(`connector/${format}/${connector.id}`)
    }
  }

  return [...keys]
}

async function supersedeTaskAndDownstream(key, reason) {
  let changed = false
  for (const dependentKey of dependentTaskKeys(key)) {
    const task = state.tasks[dependentKey]
    if (!task) continue
    state.supersededTasks ??= []
    state.supersededTasks.push({
      ...task,
      supersededAt: new Date().toISOString(),
      supersededReason: `${reason}; invalidated by ${key}`,
    })
    delete state.tasks[dependentKey]
    changed = true
  }
  if (changed) await saveState()
}

async function ensureTaskFingerprint(key, expectedFingerprint) {
  const task = state.tasks[key]
  if (!task || task.inputFingerprint === expectedFingerprint) return
  if (values['adopt-legacy'] && taskMatches(key)) return
  if (!values.force || !taskMatches(key)) {
    const reason = task.inputFingerprint ? 'changed' : 'missing from legacy state'
    throw new Error(
      `${key}: input fingerprint is ${reason}; rerun this exact item with --force --only ${key}.`,
    )
  }
  await supersedeTaskAndDownstream(key, 'input fingerprint changed')
}

function publicUrl(url) {
  return url?.replace(INTERNAL_OSS_HOST, CDN_HOST)
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(120000),
  })
  const raw = await response.text()
  let body
  try {
    body = JSON.parse(raw)
  } catch {
    throw new Error(`${response.status} ${url}: ${raw.slice(0, 500)}`)
  }
  if (!response.ok || body.code !== 200) {
    throw new Error(`${response.status} ${url}: ${JSON.stringify(body).slice(0, 800)}`)
  }
  return body
}

async function submitTask(key, endpoint, payload, kind, expectedFingerprint) {
  if (
    state.tasks[key]?.taskId
    && (expectedFingerprint === undefined || state.tasks[key]?.inputFingerprint === expectedFingerprint)
  ) {
    return state.tasks[key]
  }
  if (state.tasks[key]?.taskId) {
    throw new Error(`${key}: stale task reached submitTask without dependency invalidation.`)
  }

  const body = await fetchJson(`${API_BASE}${endpoint}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const taskId = body.data?.task_id_for_swagger || String(body.data?.task_id ?? '')
  if (!taskId) throw new Error(`${key}: create response did not contain task_id.`)

  state.tasks[key] = {
    key,
    kind,
    taskId,
    status: 'submitted',
    inputFingerprint: expectedFingerprint,
    submittedAt: new Date().toISOString(),
  }
  await saveState()
  console.log(`[submitted] ${key}: ${taskId}`)
  return state.tasks[key]
}

async function waitForTask(key) {
  const task = state.tasks[key]
  if (!task?.taskId) throw new Error(`${key}: missing task id.`)
  if (task.status === 'complete') return task

  while (true) {
    const body = await fetchJson(`${API_BASE}${TASK_PATH}?task_id=${encodeURIComponent(task.taskId)}`)
    const status = body.data?.status
    if (status === 100) {
      state.tasks[key] = {
        ...state.tasks[key],
        status: 'complete',
        completedAt: new Date().toISOString(),
        result: body.data.result,
      }
      await saveState()
      console.log(`[complete] ${key}`)
      return state.tasks[key]
    }
    if (status === 99) {
      state.tasks[key] = {
        ...state.tasks[key],
        status: 'failed',
        failedAt: new Date().toISOString(),
        result: body.data.result,
      }
      await saveState()
      throw new Error(`${key}: provider task failed: ${JSON.stringify(body.data.result).slice(0, 1000)}`)
    }
    state.tasks[key] = {
      ...state.tasks[key],
      status: status === 10 ? 'processing' : 'queued',
    }
    await saveState()
    console.log(`[waiting] ${key}`)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs))
  }
}

function successfulItem(result, role) {
  const items = result?.data
  if (!Array.isArray(items)) return null
  return items.find((item) => item.code === 100 && (!role || item.role === role))
    ?? items.find((item) => item.code === 100 && item.url)
}

async function download(url, destination) {
  const response = await fetch(publicUrl(url), { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}: ${publicUrl(url)}`)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()))
}

async function fetchBuffer(url) {
  const resolved = publicUrl(url)
  let lastError
  for (let attempt = 1; attempt <= REMOTE_HASH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(resolved, { signal: AbortSignal.timeout(REMOTE_HASH_TIMEOUT_MS) })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < REMOTE_HASH_ATTEMPTS) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000 * attempt))
      }
    }
  }
  throw new Error(`Download failed: ${resolved}: ${lastError.message}`)
}

async function writeAtomic(destination, buffer) {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  await fs.writeFile(temporary, buffer)
  await fs.rename(temporary, destination)
}

async function readPrompt(file, format, kind) {
  const raw = await fs.readFile(path.resolve(file), 'utf8')
  const prompt = raw.replace(/^# .*\n+/, '').trim()
  const formatRule = promptFormatRule(kind, format)
  return `${prompt}\n\n${formatRule}`
}

async function readPromptSupplement(file) {
  const raw = await fs.readFile(path.resolve(file), 'utf8')
  return raw.replace(/^# .*\n+/, '').trim()
}

function imagePath(format, scene) {
  return path.join(imageRoot, format, `${scene.chapterId}.jpg`)
}

function videoPath(format, id) {
  return path.join(videoRoot, format, `${id}.mp4`)
}

function publicVideoPath(format, id) {
  return path.resolve(`public/media/journey/${format}/${id}.mp4`)
}

function formalVideoSource(format, id) {
  return videoPath(format, id)
}

function providerVideoPath(format, id) {
  return path.join(providerRoot, format, `${id}-provider.mp4`)
}

function boundaryPath(format, id, edge) {
  return path.join(boundaryRoot, format, `${id}-${edge}.jpg`)
}

function taskMatches(key) {
  return onlyPatterns.length === 0 || onlyPatterns.some((pattern) => key.includes(pattern))
}

async function processPool(items, worker) {
  let cursor = 0
  async function runWorker() {
    while (cursor < items.length) {
      const item = items[cursor]
      cursor += 1
      await worker(item)
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxInFlight, items.length) }, runWorker))
}

async function buildImageRequest(scene, format) {
  const payload = {
    idle_task: 0,
    tag: 'live-long',
    ext: {
      aspect_radio: manifest.formats[format].ratio,
      image_url: [scene.productReferenceUrl, manifest.styleReferenceUrl],
      model_version: manifest.image.modelVersion,
      prompt: await readPrompt(scene.imagePromptFile, format, 'image'),
      resolution: manifest.image.resolution,
    },
  }
  const expectedFingerprint = inputFingerprint({
    kind: 'image',
    id: scene.id,
    format,
    endpoint: manifest.image.endpoint,
    payload,
  })
  return { payload, expectedFingerprint }
}

async function adoptManualImage(scene, format, source) {
  const key = `image/${format}/${scene.id}`
  const destination = imagePath(format, scene)
  const sourceFile = path.resolve(source.file)
  const [sourceBuffer, remoteBuffer] = await Promise.all([
    fs.readFile(sourceFile),
    fetchBuffer(source.url),
  ])
  const sourceSha256 = createHash('sha256').update(sourceBuffer).digest('hex')
  const remoteSha256 = createHash('sha256').update(remoteBuffer).digest('hex')
  if (sourceSha256 !== source.sha256) {
    throw new Error(`${key}: local manual source SHA-256 does not match the manifest.`)
  }
  if (remoteSha256 !== source.sha256) {
    throw new Error(`${key}: public manual source SHA-256 does not match the manifest.`)
  }

  const expectedFingerprint = inputFingerprint({
    kind: 'manual-image',
    id: scene.id,
    format,
    providerUrl: source.url,
    sourceSha256,
  })
  await ensureTaskFingerprint(key, expectedFingerprint)

  const jpeg = await sharp(sourceBuffer)
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4', progressive: true, mozjpeg: true })
    .toBuffer()
  const artifactSha256 = createHash('sha256').update(jpeg).digest('hex')
  if (
    state.tasks[key]?.status === 'complete'
    && state.tasks[key]?.inputFingerprint === expectedFingerprint
    && state.tasks[key]?.artifactSha256 === artifactSha256
    && await fileExists(destination)
    && await sha256File(destination) === artifactSha256
  ) return

  await writeAtomic(destination, jpeg)
  const completedAt = new Date().toISOString()
  state.tasks[key] = {
    key,
    kind: 'image',
    taskId: `manual:${sourceSha256.slice(0, 24)}`,
    status: 'complete',
    inputFingerprint: expectedFingerprint,
    providerUrl: source.url,
    providerSourceSha256: remoteSha256,
    sourceFile: path.relative(process.cwd(), sourceFile),
    sourceFileSha256: sourceSha256,
    artifactSha256,
    adoptedAt: completedAt,
    completedAt,
  }
  await saveState()
  console.log(`[adopted] ${path.relative(process.cwd(), destination)}`)
}

async function generateImages() {
  const jobs = manifest.scenes.flatMap((scene) =>
    Object.keys(manifest.formats).map((format) => ({ scene, format })))
    .filter(({ scene, format }) => taskMatches(`image/${format}/${scene.id}`))

  await processPool(jobs, async ({ scene, format }) => {
    const key = `image/${format}/${scene.id}`
    const destination = imagePath(format, scene)
    const manualSource = scene.manualImageSources?.[format]
    if (manualSource) {
      await adoptManualImage(scene, format, manualSource)
      return
    }

    const { payload, expectedFingerprint } = await buildImageRequest(scene, format)
    await ensureTaskFingerprint(key, expectedFingerprint)
    if (
      values['adopt-legacy']
      && !state.tasks[key]?.inputFingerprint
      && state.tasks[key]?.status === 'complete'
      && state.tasks[key]?.providerUrl
      && await fileExists(destination)
    ) {
      const [remoteBuffer, artifactSha256] = await Promise.all([
        fetchBuffer(state.tasks[key].providerUrl),
        sha256File(destination),
      ])
      const providerSha256 = createHash('sha256').update(remoteBuffer).digest('hex')
      if (providerSha256 !== artifactSha256) {
        throw new Error(`${key}: legacy provider image does not match the local artifact.`)
      }
      state.tasks[key] = {
        ...state.tasks[key],
        inputFingerprint: expectedFingerprint,
        providerSourceSha256: providerSha256,
        artifactSha256,
        legacyAdoptedAt: new Date().toISOString(),
      }
      await saveState()
      console.log(`[adopted legacy] ${key}`)
      return
    }
    if (
      state.tasks[key]?.status === 'complete'
      && state.tasks[key]?.inputFingerprint === expectedFingerprint
      && await artifactFingerprintMatches(state.tasks[key], destination)
    ) return

    await submitTask(key, manifest.image.endpoint, payload, 'image', expectedFingerprint)
    const task = await waitForTask(key)
    const image = successfulItem(task.result)
    if (!image?.url) throw new Error(`${key}: successful task did not return an image URL.`)
    await download(image.url, destination)
    state.tasks[key] = {
      ...state.tasks[key],
      providerUrl: publicUrl(image.url),
      artifactSha256: await sha256File(destination),
    }
    await saveState()
    console.log(`[downloaded] ${path.relative(process.cwd(), destination)}`)
  })
}

function videoPayload({ prompt, ratio, firstFrameUrl, lastFrameUrl, referenceUrl }) {
  const content = [{ type: 'text', text: prompt }]
  content.push({ type: 'image_url', role: 'first_frame', image_url: { url: firstFrameUrl } })
  if (lastFrameUrl) {
    content.push({ type: 'image_url', role: 'last_frame', image_url: { url: lastFrameUrl } })
  }
  if (referenceUrl) {
    content.push({ type: 'image_url', role: 'reference_image', image_url: { url: referenceUrl } })
  }
  return {
    idle_task: 0,
    tag: 'live-long',
    ext: {
      model: manifest.video.model,
      content,
      duration: manifest.video.durationSeconds,
      generate_audio: manifest.video.generateAudio,
      ratio,
      resolution: manifest.video.resolution,
      watermark: manifest.video.watermark,
    },
  }
}

async function generateVideo(key, id, format, payload, expectedFingerprint, lockedFrames = {}) {
  const destination = videoPath(format, id)
  const lockedFrameHashes = {}
  for (const [edge, file] of Object.entries(lockedFrames)) {
    if (file) lockedFrameHashes[edge] = await sha256File(file)
  }
  const encodingFingerprint = inputFingerprint({
    version: 'locked-boundaries-v1',
    format,
    config: manifest.formats[format],
    lockedFrameHashes,
  })
  await ensureTaskFingerprint(key, expectedFingerprint)
  if (
    values['adopt-legacy']
    && state.tasks[key]?.inputFingerprint !== expectedFingerprint
    && state.tasks[key]?.status === 'complete'
    && state.tasks[key]?.providerUrl
    && await fileExists(destination)
  ) {
    const task = state.tasks[key]
    const provider = providerVideoPath(format, id)
    if (!await fileExists(provider)) throw new Error(`${key}: legacy provider video is missing.`)
    const resultUrl = publicUrl(successfulItem(task.result, 'video')?.url)
    if (resultUrl !== task.providerUrl) {
      throw new Error(`${key}: legacy task result URL does not match providerUrl.`)
    }
    const [remoteSha256, providerSha256, artifactSha256, mediaIssues] = await Promise.all([
      sha256Remote(task.providerUrl),
      sha256File(provider),
      sha256File(destination),
      videoMediaIssues(destination, format),
    ])
    if (remoteSha256 !== providerSha256) {
      throw new Error(`${key}: legacy provider URL does not match the saved provider video.`)
    }
    if (mediaIssues.length) {
      throw new Error(`${key}: legacy final video failed validation: ${mediaIssues.join(' ')}`)
    }
    state.tasks[key] = {
      ...task,
      inputFingerprint: expectedFingerprint,
      providerArtifactSha256: providerSha256,
      artifactSha256,
      encodingFingerprint,
      legacyAdoptedAt: new Date().toISOString(),
    }
    await saveState()
    console.log(`[adopted legacy] ${key}`)
  }
  if (
    state.tasks[key]?.status === 'complete'
    && state.tasks[key]?.inputFingerprint === expectedFingerprint
    && state.tasks[key]?.encodingFingerprint === encodingFingerprint
    && state.tasks[key]?.artifactSha256
    && await fileExists(destination)
    && state.tasks[key].artifactSha256 === await sha256File(destination)
  ) return

  await submitTask(key, manifest.video.endpoint, payload, 'video', expectedFingerprint)
  const task = await waitForTask(key)
  const video = successfulItem(task.result, 'video')
  if (!video?.url) throw new Error(`${key}: successful task did not return a video URL.`)
  const provider = providerVideoPath(format, id)
  state.tasks[key] = {
    ...state.tasks[key],
    providerUrl: publicUrl(video.url),
    providerMetadata: {
      duration: video.duration,
      fps: video.fps,
      resolution: video.resolution,
    },
  }
  await saveState()
  await download(video.url, provider)
  const dimensions = await videoDimensions(provider)
  const expected = manifest.formats[format]
  if (dimensions.width !== expected.width || dimensions.height !== expected.height) {
    state.tasks[key] = {
      ...state.tasks[key],
      status: 'invalid-output',
      actualDimensions: dimensions,
    }
    await saveState()
    throw new Error(
      `${key}: provider returned ${dimensions.width}x${dimensions.height}; expected native ${expected.width}x${expected.height}.`,
    )
  }
  await transcode(provider, destination, manifest.formats[format], lockedFrames)
  state.tasks[key] = {
    ...state.tasks[key],
    artifactSha256: await sha256File(destination),
    encodingFingerprint,
  }
  await saveState()
  console.log(`[encoded] ${path.relative(process.cwd(), destination)}`)
}

async function buildDiveRequest(scene, format) {
  const imageKey = `image/${format}/${scene.id}`
  const imageTask = state.tasks[imageKey]
  const sourceImage = imagePath(format, scene)
  if (!imageTask?.providerUrl || !imageTask.taskId || !await fileExists(sourceImage)) {
    throw new Error(`${scene.id}/${format}: image stage must complete first.`)
  }
  const prompt = `${await readPrompt(scene.videoPromptFile, format, 'dive')}\n\n输入图片是已经审核通过且必须锁定的唯一首帧。视频第 0 帧必须与输入图片保持相同的相机、焦段、构图、角色造型、角色位置、建筑、道具、灯光和文案负空间；只能从该首帧继续动作，不得重绘成另一处场景或重新摆放角色。`
  const payload = videoPayload({
    prompt,
    ratio: manifest.formats[format].ratio,
    firstFrameUrl: imageTask.providerUrl,
    referenceUrl: scene.useVideoReference === false ? undefined : scene.productReferenceUrl,
  })
  const expectedFingerprint = inputFingerprint({
    kind: 'video',
    id: scene.id,
    format,
    payload,
    upstream: {
      taskId: imageTask.taskId,
      inputFingerprint: imageTask.inputFingerprint,
      providerUrl: imageTask.providerUrl,
      providerSourceSha256: imageTask.providerSourceSha256,
      sourceFileSha256: await sha256File(sourceImage),
    },
  })
  return {
    payload,
    expectedFingerprint,
    lockedFrames: { first: sourceImage },
  }
}

async function generateDives() {
  const jobs = manifest.scenes.flatMap((scene) =>
    Object.keys(manifest.formats).map((format) => ({ scene, format })))
    .filter(({ scene, format }) => taskMatches(`video/${format}/${scene.id}`))

  await processPool(jobs, async ({ scene, format }) => {
    const { payload, expectedFingerprint, lockedFrames } = await buildDiveRequest(scene, format)
    await generateVideo(
      `video/${format}/${scene.id}`,
      scene.id,
      format,
      payload,
      expectedFingerprint,
      lockedFrames,
    )
  })
}

function runCapture(binary, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout = []
    const stderr = []
    child.stdout.on('data', (chunk) => stdout.push(chunk))
    child.stderr.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise({
          stdout: Buffer.concat(stdout).toString(),
          stderr: Buffer.concat(stderr).toString(),
        })
      }
      else reject(new Error(`${binary} exited ${code}: ${Buffer.concat(stderr).toString().slice(-3000)}`))
    })
  })
}

async function run(binary, args) {
  return (await runCapture(binary, args)).stdout
}

async function videoDimensions(file) {
  const raw = await run(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', file,
  ])
  const stream = JSON.parse(raw).streams?.[0]
  const width = Number.parseInt(stream?.width, 10)
  const height = Number.parseInt(stream?.height, 10)
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error(`${file}: could not determine video dimensions.`)
  }
  return { width, height }
}

async function transcode(source, destination, config, lockedFrames = {}) {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.tmp.mp4`
  const inputArgs = ['-i', source]
  const filterParts = []
  let outputLabel = '[0:v]'
  const sourceFrames = lockedFrames.last ? await frameCount(source) : undefined
  for (const [index, [edge, file]] of Object.entries(lockedFrames).entries()) {
    if (!file) continue
    const inputIndex = inputArgs.filter((arg) => arg === '-i').length
    inputArgs.push('-loop', '1', '-framerate', '24', '-i', file)
    const scaledLabel = `[locked-${edge}]`
    const nextLabel = `[locked-output-${index}]`
    const frameIndex = edge === 'last' ? sourceFrames - 1 : 0
    filterParts.push(
      `[${inputIndex}:v]scale=${config.width}:${config.height}:flags=lanczos,format=yuv420p${scaledLabel}`,
      `${outputLabel}${scaledLabel}overlay=enable='eq(n,${frameIndex})':shortest=1${nextLabel}`,
    )
    outputLabel = nextLabel
  }
  const filterArgs = filterParts.length
    ? ['-filter_complex', filterParts.join(';'), '-map', outputLabel]
    : ['-map', '0:v:0']
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', ...inputArgs,
    ...filterArgs, '-an', '-c:v', 'libx264', '-preset', 'slow',
    '-crf', String(config.crf), '-pix_fmt', 'yuv420p',
    '-g', String(config.gop), '-keyint_min', String(config.gop), '-sc_threshold', '0',
    '-movflags', '+faststart', '-map_metadata', '-1', temporary,
  ])
  await fs.rename(temporary, destination)
}

async function prepareExistingDives() {
  const jobs = ['dive-town', 'dive-reunion'].flatMap((id) =>
    Object.keys(manifest.formats).map((format) => ({ id, format })))
    .filter(({ id, format }) => taskMatches(`existing/${format}/${id}`))

  await processPool(jobs, async ({ id, format }) => {
    const source = publicVideoPath(format, id)
    const destination = videoPath(format, id)
    if (!await fileExists(source)) throw new Error(`${id}/${format}: existing public source is missing.`)
    if (await fileExists(destination)) {
      const issues = await videoMediaIssues(destination, format)
      if (issues.length === 0) return
    }
    await transcode(source, destination, manifest.formats[format])
    console.log(`[encoded existing] ${path.relative(process.cwd(), destination)}`)
  })
}

async function frameCount(file) {
  const raw = await run(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0', '-count_frames',
    '-show_entries', 'stream=nb_read_frames,nb_frames', '-of', 'json', file,
  ])
  const stream = JSON.parse(raw).streams?.[0]
  const frames = Number.parseInt(stream?.nb_read_frames || stream?.nb_frames, 10)
  if (!Number.isInteger(frames) || frames < 2) throw new Error(`${file}: invalid frame count.`)
  return frames
}

async function frameSsim(videoFile, frameIndex, imageFile) {
  const frameFile = path.join(
    outputRoot,
    `.ssim-${process.pid}-${frameIndex}-${Math.random().toString(16).slice(2)}.png`,
  )
  const comparisonFile = `${frameFile}.comparison.png`
  try {
    await run(FFMPEG, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', videoFile,
      '-vf', `select=eq(n\\,${frameIndex})`, '-vsync', '0', '-frames:v', '1', frameFile,
    ])
    const { width, height } = await sharp(frameFile).metadata()
    if (!width || !height) throw new Error('could not read extracted frame dimensions.')
    await sharp(imageFile).resize(width, height, { fit: 'fill' }).png().toFile(comparisonFile)
    const { stderr } = await runCapture(FFMPEG, [
      '-hide_banner', '-nostats', '-i', frameFile, '-i', comparisonFile,
      '-lavfi', '[0:v]format=yuv420p[a];[1:v]format=yuv420p[b];[a][b]ssim',
      '-f', 'null', '-',
    ])
    const match = stderr.match(/All:([0-9.]+)/)
    const score = Number(match?.[1])
    if (!Number.isFinite(score)) throw new Error('could not parse SSIM score.')
    return score
  } finally {
    await Promise.all([
      fs.rm(frameFile, { force: true }),
      fs.rm(comparisonFile, { force: true }),
    ])
  }
}

function segmentSource(id, format) {
  const file = videoPath(format, id)
  const injected = manifest.boundarySources?.[format]?.[id]
  if (injected) {
    return {
      url: injected.url,
      expectedSha256: injected.sha256,
      file,
      boundarySourceKind: 'final-encoded-external',
      upstreamTaskId: state.tasks[`video/${format}/${id}`]?.taskId,
    }
  }

  const generated = manifest.scenes.some((scene) => scene.id === id)
  if (generated) {
    const task = state.tasks[`video/${format}/${id}`]
    if (!task?.providerUrl) throw new Error(`${id}/${format}: generated video is not complete.`)
    return {
      url: task.providerUrl,
      file,
      boundarySourceKind: 'provider-original',
      upstreamTaskId: task.taskId,
    }
  }
  return {
    url: `${manifest.existingVideoBaseUrl}/${format}/${id}.mp4`,
    file,
    boundarySourceKind: 'external-url-unverified',
  }
}

async function buildBoundaryRequest(id, format, edge) {
  const source = segmentSource(id, format)
  if (!await fileExists(source.file)) throw new Error(`${id}/${format}: boundary source file is missing.`)
  const sourceFileSha256 = await sha256File(source.file)
  if (source.expectedSha256 && source.expectedSha256 !== sourceFileSha256) {
    throw new Error(
      `${id}/${format}: injected boundary source SHA-256 does not match the final encoded local file.`,
    )
  }
  if (source.expectedSha256) {
    const remoteSha256 = await sha256Remote(source.url)
    if (remoteSha256 !== source.expectedSha256) {
      throw new Error(
        `${id}/${format}: injected boundary source URL content does not match the final encoded SHA-256.`,
      )
    }
  }
  const frames = await frameCount(source.file)
  const idx = edge === 'first' ? 0 : frames - 1
  const payload = {
    idle_task: 0,
    idx,
    oss_tag: 'live-long',
    path: source.url,
  }
  const expectedFingerprint = inputFingerprint({
    kind: 'boundary',
    id,
    format,
    edge,
    endpoint: EXTRACT_PATH,
    payload,
    sourceFileSha256,
    upstreamTaskId: source.upstreamTaskId,
    boundarySourceKind: source.boundarySourceKind,
  })
  return {
    source,
    sourceFileSha256,
    frames,
    idx,
    payload,
    expectedFingerprint,
  }
}

async function extractBoundary(id, format, edge) {
  const key = `boundary/${format}/${id}/${edge}`
  const destination = boundaryPath(format, id, edge)
  const {
    source,
    sourceFileSha256,
    frames,
    idx,
    payload,
    expectedFingerprint,
  } = await buildBoundaryRequest(id, format, edge)
  await ensureTaskFingerprint(key, expectedFingerprint)
  if (
    state.tasks[key]?.status === 'complete'
    && state.tasks[key]?.providerUrl
    && state.tasks[key]?.inputFingerprint === expectedFingerprint
    && state.tasks[key]?.artifactSha256
    && await fileExists(destination)
    && state.tasks[key].artifactSha256 === await sha256File(destination)
  ) return

  await submitTask(key, EXTRACT_PATH, payload, 'boundary', expectedFingerprint)
  const task = await waitForTask(key)
  const url = task.result?.url
  if (!url) throw new Error(`${key}: successful extraction did not return a URL.`)
  state.tasks[key] = {
    ...state.tasks[key],
    providerUrl: publicUrl(url),
    frameIndex: idx,
    frameCount: frames,
    sourceUrl: source.url,
    sourceFileSha256,
    boundarySourceKind: source.boundarySourceKind,
  }
  await download(url, destination)
  state.tasks[key] = {
    ...state.tasks[key],
    artifactSha256: await sha256File(destination),
  }
  await saveState()
  console.log(`[boundary] ${path.relative(process.cwd(), destination)} frame=${idx}`)
}

async function generateBoundaries() {
  const requirements = new Map()
  for (const connector of manifest.connectors) {
    requirements.set(`${connector.from}/last`, { id: connector.from, edge: 'last' })
    requirements.set(`${connector.to}/first`, { id: connector.to, edge: 'first' })
  }
  const jobs = [...requirements.values()].flatMap(({ id, edge }) =>
    Object.keys(manifest.formats).map((format) => ({ id, edge, format })))
    .filter(({ id, edge, format }) => taskMatches(`boundary/${format}/${id}/${edge}`))
  await processPool(jobs, ({ id, edge, format }) => extractBoundary(id, format, edge))
}

async function buildConnectorRequest(connector, format) {
  const firstKey = `boundary/${format}/${connector.from}/last`
  const lastKey = `boundary/${format}/${connector.to}/first`
  const firstTask = state.tasks[firstKey]
  const lastTask = state.tasks[lastKey]
  const firstFile = boundaryPath(format, connector.from, 'last')
  const lastFile = boundaryPath(format, connector.to, 'first')
  if (
    !firstTask?.providerUrl
    || !lastTask?.providerUrl
    || !firstTask.taskId
    || !lastTask.taskId
    || !await fileExists(firstFile)
    || !await fileExists(lastFile)
  ) throw new Error(`${connector.id}/${format}: boundary stage must complete first.`)

  const basePrompt = await readPrompt(connector.promptFile, format, 'connector')
  const overrideFile = connector.formatPromptOverrides?.[format]
  const supplementFile = connector.formatPromptFiles?.[format]
  const supplement = supplementFile ? await readPromptSupplement(supplementFile) : ''
  const payload = videoPayload({
    prompt: overrideFile
      ? await readPrompt(overrideFile, format, 'connector')
      : supplement
        ? `${basePrompt}\n\n${supplement}`
        : basePrompt,
    ratio: manifest.formats[format].ratio,
    firstFrameUrl: firstTask.providerUrl,
    lastFrameUrl: lastTask.providerUrl,
  })
  const expectedFingerprint = inputFingerprint({
    kind: 'connector',
    id: connector.id,
    format,
    payload,
    upstream: {
      first: {
        taskId: firstTask.taskId,
        inputFingerprint: firstTask.inputFingerprint,
        providerUrl: firstTask.providerUrl,
        sourceFileSha256: await sha256File(firstFile),
      },
      last: {
        taskId: lastTask.taskId,
        inputFingerprint: lastTask.inputFingerprint,
        providerUrl: lastTask.providerUrl,
        sourceFileSha256: await sha256File(lastFile),
      },
    },
  })
  return {
    payload,
    expectedFingerprint,
    lockedFrames: { first: firstFile, last: lastFile },
  }
}

async function generateConnectors() {
  const jobs = manifest.connectors.flatMap((connector) =>
    Object.keys(manifest.formats).map((format) => ({ connector, format })))
    .filter(({ connector, format }) => taskMatches(`connector/${format}/${connector.id}`))

  await processPool(jobs, async ({ connector, format }) => {
    const { payload, expectedFingerprint, lockedFrames } = await buildConnectorRequest(connector, format)
    await generateVideo(
      `connector/${format}/${connector.id}`,
      connector.id,
      format,
      payload,
      expectedFingerprint,
      lockedFrames,
    )
  })
}

async function imageMediaIssues(file, format) {
  const issues = []
  const metadata = await sharp(file).metadata()
  if (!metadata.width || !metadata.height) return ['image dimensions could not be determined.']
  const expected = STORY_FORMATS[format]
  const ratioDelta = Math.abs(metadata.width / metadata.height - expected.width / expected.height)
  if (ratioDelta > 0.001) issues.push(`image ratio must be ${expected.ratio}.`)
  return issues
}

function parseFrameRate(value) {
  const [numerator, denominator] = String(value ?? '').split('/').map(Number)
  return denominator ? numerator / denominator : 0
}

async function hasFaststart(file) {
  const handle = await fs.open(file, 'r')
  try {
    const { size } = await handle.stat()
    let offset = 0
    let moovOffset = -1
    let mdatOffset = -1
    while (offset + 8 <= size && (moovOffset < 0 || mdatOffset < 0)) {
      const header = Buffer.alloc(16)
      const { bytesRead } = await handle.read(header, 0, 16, offset)
      if (bytesRead < 8) break
      let atomSize = header.readUInt32BE(0)
      const atomType = header.subarray(4, 8).toString('ascii')
      let headerSize = 8
      if (atomSize === 1 && bytesRead >= 16) {
        atomSize = Number(header.readBigUInt64BE(8))
        headerSize = 16
      } else if (atomSize === 0) {
        atomSize = size - offset
      }
      if (!Number.isSafeInteger(atomSize) || atomSize < headerSize) break
      if (atomType === 'moov') moovOffset = offset
      if (atomType === 'mdat') mdatOffset = offset
      offset += atomSize
    }
    return moovOffset >= 0 && mdatOffset >= 0 && moovOffset < mdatOffset
  } finally {
    await handle.close()
  }
}

async function videoMediaIssues(file, format) {
  const issues = []
  const raw = await run(FFPROBE, [
    '-v', 'error', '-show_streams', '-of', 'json', file,
  ])
  const streams = JSON.parse(raw).streams ?? []
  const videoStreams = streams.filter((stream) => stream.codec_type === 'video')
  const audioStreams = streams.filter((stream) => stream.codec_type === 'audio')
  const video = videoStreams[0]
  const expected = STORY_FORMATS[format]

  if (videoStreams.length !== 1) issues.push(`expected one video stream, received ${videoStreams.length}.`)
  if (video?.codec_name !== 'h264') issues.push(`video codec must be h264, received ${video?.codec_name ?? 'missing'}.`)
  if (video?.width !== expected.width || video?.height !== expected.height) {
    issues.push(`dimensions must be ${expected.width}x${expected.height}, received ${video?.width ?? 0}x${video?.height ?? 0}.`)
  }
  if (audioStreams.length > 0) issues.push(`audio streams must be absent, received ${audioStreams.length}.`)
  if (!await hasFaststart(file)) issues.push('MP4 must place moov before mdat for faststart.')

  const frameRate = parseFrameRate(video?.avg_frame_rate)
  if (frameRate > 0) {
    const keyframeRaw = await run(FFPROBE, [
      '-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey',
      '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file,
    ])
    const keyframes = keyframeRaw.split(/\r?\n/)
      .map((line) => Number.parseFloat(line))
      .filter(Number.isFinite)
    const duration = Number(video?.duration)
    const gaps = keyframes.slice(1).map((timestamp, index) => timestamp - keyframes[index])
    if (keyframes.length > 0) gaps.push(keyframes[0])
    if (keyframes.length > 0 && Number.isFinite(duration)) gaps.push(duration - keyframes.at(-1))
    const maxGap = Math.max(0, ...gaps)
    const expectedGap = expected.gop / frameRate
    if (maxGap > expectedGap + (1 / frameRate) / 2) {
      issues.push(`GOP exceeds ${expected.gop} frames; maximum keyframe gap is ${maxGap.toFixed(3)}s.`)
    }
  }

  const { stderr } = await runCapture(FFMPEG, [
    '-hide_banner', '-nostats', '-i', file,
    '-vf', 'blackdetect=d=0.04:pix_th=0.10', '-an', '-f', 'null', '-',
  ])
  if (/black_start:/.test(stderr)) issues.push('black frame interval detected.')
  return issues
}

async function artifactFingerprintMatches(task, file) {
  return Boolean(task?.artifactSha256)
    && await fileExists(file)
    && task.artifactSha256 === await sha256File(file)
}

async function collectPublishInventory() {
  const entries = []

  for (const scene of manifest.scenes) {
    for (const format of Object.keys(STORY_FORMATS)) {
      const key = `image/${format}/${scene.id}`
      const file = imagePath(format, scene)
      const task = state.tasks[key]
      const exists = await fileExists(file)
      const mediaIssues = []
      try {
        if (exists) mediaIssues.push(...await imageMediaIssues(file, format))
      } catch (error) {
        mediaIssues.push(error.message)
      }
      entries.push({
        key,
        kind: 'image',
        exists,
        requiresTask: true,
        taskStatus: task?.status,
        requiresFingerprint: false,
        requiresArtifactFingerprint: false,
        mediaIssues,
      })
    }
  }

  const boundaryRequirements = new Map()
  for (const connector of STORY_CONNECTORS) {
    boundaryRequirements.set(`${connector.from}/last`, { id: connector.from, edge: 'last' })
    boundaryRequirements.set(`${connector.to}/first`, { id: connector.to, edge: 'first' })
  }
  for (const format of Object.keys(STORY_FORMATS)) {
    for (const { id, edge } of boundaryRequirements.values()) {
      const key = `boundary/${format}/${id}/${edge}`
      const file = boundaryPath(format, id, edge)
      const task = state.tasks[key]
      const exists = await fileExists(file)
      let expectedFingerprint
      let boundaryRequest
      let edgeSsim
      const mediaIssues = []
      try {
        boundaryRequest = await buildBoundaryRequest(id, format, edge)
        expectedFingerprint = boundaryRequest.expectedFingerprint
        if (exists) {
          edgeSsim = await frameSsim(boundaryRequest.source.file, boundaryRequest.idx, file)
          if (edgeSsim < 0.95) {
            mediaIssues.push(`boundary frame SSIM ${edgeSsim.toFixed(4)} is below 0.9500.`)
          }
        }
      } catch (error) {
        mediaIssues.push(error.message)
      }
      entries.push({
        key,
        kind: 'boundary',
        exists,
        requiresTask: true,
        taskStatus: task?.status,
        requiresFingerprint: true,
        fingerprintMatches: boundaryInputFingerprintMatches(task, {
          expectedFingerprint,
          sourceSha256: boundaryRequest?.sourceFileSha256,
          sourceUrl: boundaryRequest?.source.url,
          edgeSsim,
        }),
        requiresArtifactFingerprint: true,
        artifactFingerprintMatches: await artifactFingerprintMatches(task, file),
        boundarySourceKind: task?.boundarySourceKind,
        mediaIssues,
      })
    }
  }

  for (const format of Object.keys(STORY_FORMATS)) {
    for (const id of STORY_SEGMENT_IDS) {
      const file = formalVideoSource(format, id)
      const exists = await fileExists(file)
      const scene = manifest.scenes.find((candidate) => candidate.id === id)
      const connector = manifest.connectors.find((candidate) => candidate.id === id)
      const key = scene
        ? `video/${format}/${id}`
        : connector
          ? `connector/${format}/${id}`
          : `existing/${format}/${id}`
      const task = scene || connector ? state.tasks[key] : undefined
      let expectedFingerprint
      const mediaIssues = []
      try {
        if (scene) expectedFingerprint = (await buildDiveRequest(scene, format)).expectedFingerprint
        if (connector) expectedFingerprint = (await buildConnectorRequest(connector, format)).expectedFingerprint
        if (exists) mediaIssues.push(...await videoMediaIssues(file, format))
        if (exists && scene) {
          const score = await frameSsim(file, 0, imagePath(format, scene))
          if (score < 0.95) {
            mediaIssues.push(`dive first-frame SSIM ${score.toFixed(4)} is below 0.9500.`)
          }
        }
        if (exists && connector) {
          const firstBoundary = boundaryPath(format, connector.from, 'last')
          const lastBoundary = boundaryPath(format, connector.to, 'first')
          const frames = await frameCount(file)
          const [firstScore, lastScore] = await Promise.all([
            frameSsim(file, 0, firstBoundary),
            frameSsim(file, frames - 1, lastBoundary),
          ])
          if (firstScore < 0.90) {
            mediaIssues.push(`connector first-frame SSIM ${firstScore.toFixed(4)} is below 0.9000.`)
          }
          if (lastScore < 0.90) {
            mediaIssues.push(`connector last-frame SSIM ${lastScore.toFixed(4)} is below 0.9000.`)
          }
        }
      } catch (error) {
        mediaIssues.push(error.message)
      }
      entries.push({
        key,
        kind: 'video',
        exists,
        requiresTask: Boolean(scene || connector),
        taskStatus: task?.status,
        requiresFingerprint: Boolean(scene || connector),
        fingerprintMatches: task?.inputFingerprint === expectedFingerprint,
        requiresArtifactFingerprint: Boolean(scene || connector),
        artifactFingerprintMatches: scene || connector
          ? await artifactFingerprintMatches(task, file)
          : undefined,
        mediaIssues,
      })
    }
  }

  return entries
}

async function preflightPublish() {
  const entries = await collectPublishInventory()
  const issues = publishInventoryIssues(entries)
  if (issues.length) throw new Error(`Story media publish preflight failed:\n- ${issues.join('\n- ')}`)
  console.log('Publish preflight passed: 8 images, 20 boundaries, and 22 final video inputs.')
}

async function stagePublish() {
  await fs.rm(publishStagingRoot, { recursive: true, force: true })
  const artifacts = []
  for (const format of Object.keys(STORY_FORMATS)) {
    for (const id of STORY_SEGMENT_IDS) {
      const sourceVideo = formalVideoSource(format, id)
      const stagedVideo = path.join(publishStagingRoot, 'media', 'journey', format, `${id}.mp4`)
      await fs.mkdir(path.dirname(stagedVideo), { recursive: true })
      await fs.copyFile(sourceVideo, stagedVideo)
      artifacts.push(stagedVideo)
    }
  }
  for (const artifact of artifacts) {
    if (!await fileExists(artifact)) throw new Error(`Staged artifact is missing: ${artifact}`)
  }
  return artifacts
}

async function commitStaging(artifacts) {
  const backupRoot = path.join(publishStagingRoot, '.public-backup')
  const destinations = []
  for (const source of artifacts) {
    const relative = path.relative(publishStagingRoot, source)
    const destination = path.resolve('public', relative)
    const backup = path.join(backupRoot, relative)
    const existed = await fileExists(destination)
    const destinationSha256 = existed ? await sha256File(destination) : null
    const publishedSha256 = await sha256File(source)
    if (existed) {
      await fs.mkdir(path.dirname(backup), { recursive: true })
      await fs.copyFile(destination, backup)
    }
    await fs.mkdir(path.dirname(destination), { recursive: true })
    const temporary = `${destination}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
    destinations.push({
      source,
      destination,
      backup,
      temporary,
      existed,
      destinationSha256,
      publishedSha256,
    })
  }
  const journal = {
    version: 2,
    phase: 'applying',
    attemptedCount: 0,
    items: destinations.map(({
      destination,
      backup,
      temporary,
      existed,
      destinationSha256,
      publishedSha256,
    }) => ({
      destination,
      backup,
      temporary,
      existed,
      destinationSha256,
      publishedSha256,
    })),
  }
  await writeAtomic(publishJournalPath, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`))
  try {
    for (const [index, item] of destinations.entries()) {
      journal.attemptedCount = index + 1
      await writeAtomic(publishJournalPath, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`))
      await fs.copyFile(item.source, item.temporary)
      if (await sha256File(item.temporary) !== item.publishedSha256) {
        throw new Error(`Staged publish copy fingerprint mismatch: ${item.temporary}`)
      }
      const currentSha256 = await fileSha256OrNull(item.destination)
      if (currentSha256 !== item.destinationSha256) {
        throw new Error(`Publish destination changed after staging: ${item.destination}`)
      }
      await fs.rename(item.temporary, item.destination)
      console.log(`[published] ${path.relative(process.cwd(), item.destination)}`)
    }
    journal.phase = 'committed'
    await writeAtomic(publishJournalPath, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`))
    await fs.rm(publishJournalPath, { force: true })
  } catch (error) {
    await Promise.allSettled(destinations.map((item) => fs.rm(item.temporary, { force: true })))
    const rollbackErrors = []
    for (const item of destinations.slice(0, journal.attemptedCount).reverse()) {
      try {
        const currentSha256 = await fileSha256OrNull(item.destination)
        if (currentSha256 === item.publishedSha256) {
          if (item.existed) {
            if (await fileSha256OrNull(item.backup) !== item.destinationSha256) {
              rollbackErrors.push(`${item.destination}: backup fingerprint mismatch`)
            } else {
              await fs.copyFile(item.backup, item.destination)
            }
          } else await fs.rm(item.destination, { force: true })
        } else if (currentSha256 !== item.destinationSha256) {
          rollbackErrors.push(`${item.destination}: destination changed during publish; preserved external modification`)
        }
      } catch (rollbackError) {
        rollbackErrors.push(`${item.destination}: ${rollbackError.message}`)
      }
    }
    if (rollbackErrors.length) {
      throw new Error(`${error.message}\nPublish rollback also failed:\n- ${rollbackErrors.join('\n- ')}`)
    }
    await fs.rm(publishJournalPath, { force: true })
    throw error
  }
}

async function publish() {
  await preflightPublish()
  const artifacts = await stagePublish()
  await commitStaging(artifacts)
}

async function fileExists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

if (values.stage === 'images' || values.stage === 'all') await generateImages()
if (values.stage === 'dives' || values.stage === 'all') await generateDives()
if (values.stage === 'existing' || values.stage === 'all') await prepareExistingDives()
if (values.stage === 'boundaries' || values.stage === 'all') await generateBoundaries()
if (values.stage === 'connectors' || values.stage === 'all') await generateConnectors()
if (values.stage === 'verify') await preflightPublish()
if (values.stage === 'publish' || values.stage === 'all') await publish()

console.log('Story scene generation finished.')
