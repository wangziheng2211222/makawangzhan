import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { spawn } from 'node:child_process'

import sharp from 'sharp'

const API_BASE = 'http://ai-platform-dev.cds8.cn'
const CREATE_PATHS = {
  jieyun: '/v2/external/video/jieyun/seedance/create',
  kkidc_sd2: '/v2/external/video/kkidc_sd2/seedance/create',
}
const TASK_PATH = '/v1/task/get'
const CDN_HOST = 'cdn-ai-platform-resource-test.cds8.cn'
const INTERNAL_OSS_HOST = 'ai-platform-resource-test.oss-cn-shanghai-internal.aliyuncs.com'
const FFMPEG = '/Users/wzzz/Library/Application Support/com.snapany.desktop/tools/ffmpeg/8.0/ffmpeg'
const FFPROBE = '/Users/wzzz/Library/Application Support/com.snapany.desktop/tools/ffprobe/8.0/ffprobe'

const { values } = parseArgs({
  options: {
    manifest: { type: 'string', default: 'media/video-manifest.json' },
    stage: { type: 'string', default: 'all' },
    only: { type: 'string' },
    provider: { type: 'string', default: 'jieyun' },
    'asset-base-url': { type: 'string' },
    'asset-url-map': { type: 'string' },
    candidate: { type: 'string' },
    'retry-failed': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    'max-in-flight': { type: 'string', default: '1' },
    'poll-seconds': { type: 'string', default: '20' },
    'dry-run': { type: 'boolean', default: false },
  },
})

const manifestPath = path.resolve(values.manifest)
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const candidateRoot = values.candidate
  ? path.resolve('output/video/candidates', values.candidate)
  : null
const statePath = candidateRoot
  ? path.join(candidateRoot, 'state.json')
  : path.resolve('output/video/1080p-state.json')
const sourceRoot = candidateRoot
  ? path.join(candidateRoot, 'source')
  : path.resolve('.maka-media/source/1080p')
const boundaryRoot = candidateRoot
  ? path.join(candidateRoot, 'boundaries')
  : path.resolve('.maka-media/boundaries/1080p')
const publicRoot = candidateRoot
  ? path.join(candidateRoot, 'videos')
  : path.resolve('public/media/journey')
const requestAssetRoot = candidateRoot
  ? path.join(candidateRoot, 'request-assets')
  : path.resolve('.maka-media/request-assets/1080p')
const maxInFlight = Number.parseInt(values['max-in-flight'], 10)
const pollMs = Number.parseInt(values['poll-seconds'], 10) * 1000
const createPath = CREATE_PATHS[values.provider]
const assetUrlMap = values['asset-url-map']
  ? JSON.parse(await fs.readFile(path.resolve(values['asset-url-map']), 'utf8'))
  : null

validateManifest()
await assertExecutable(FFMPEG)
await assertExecutable(FFPROBE)

let state = await readJson(statePath, {
  version: 1,
  manifest: path.relative(process.cwd(), manifestPath),
  tasks: {},
})

function validateManifest() {
  const issues = []
  if (manifest.version !== 2) issues.push('Manifest version must be 2.')
  if (!manifest.formats?.desktop || !manifest.formats?.mobile) {
    issues.push('Manifest must define desktop and mobile formats.')
  }
  if (!Array.isArray(manifest.segments) || manifest.segments.length !== 11) {
    issues.push('Manifest must define 11 logical segments.')
  }
  if (!['all', 'dives', 'connectors'].includes(values.stage)) {
    issues.push('--stage must be all, dives, or connectors.')
  }
  if (!createPath) issues.push('--provider must be jieyun or kkidc_sd2.')
  if (!Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 6) {
    issues.push('--max-in-flight must be an integer from 1 to 6.')
  }
  if (!Number.isFinite(pollMs) || pollMs < 5000) {
    issues.push('--poll-seconds must be at least 5.')
  }
  if (values.force && !values.only) {
    issues.push('--force requires --only to avoid regenerating the full chain.')
  }
  if (values.candidate && !/^[a-z0-9][a-z0-9-]*$/.test(values.candidate)) {
    issues.push('--candidate must contain only lowercase letters, numbers, and hyphens.')
  }

  const ids = new Set(manifest.segments?.map((segment) => segment.id))
  for (const segment of manifest.segments ?? []) {
    if (!segment.id || !segment.promptFile) issues.push('Every segment needs an id and promptFile.')
    if (segment.kind === 'connector' && (!ids.has(segment.from) || !ids.has(segment.to))) {
      issues.push(`${segment.id} has an invalid connector dependency.`)
    }
  }
  for (const [format, config] of Object.entries(manifest.formats ?? {})) {
    if (config.ratio !== (format === 'desktop' ? '16:9' : '9:16')) {
      issues.push(`${format} has the wrong ratio.`)
    }
    if (config.width * config.height !== 1920 * 1080) {
      issues.push(`${format} must contain 1080p pixels.`)
    }
  }
  if (issues.length) throw new Error(`Invalid production manifest:\n- ${issues.join('\n- ')}`)
}

async function assertExecutable(file) {
  await fs.access(file, fs.constants.X_OK)
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
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  const temporary = `${statePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`)
  await fs.rename(temporary, statePath)
}

function taskKey(segmentId, format) {
  return `${format}/${segmentId}`
}

function publicPath(segmentId, format) {
  return path.join(publicRoot, format, `${segmentId}.mp4`)
}

function sourcePath(segmentId, format) {
  return path.join(sourceRoot, format, `${segmentId}-provider.mp4`)
}

function boundaryPath(segmentId, format, edge) {
  return path.join(boundaryRoot, format, `${segmentId}-${edge}.png`)
}

async function fileExists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function promptFor(segment, format) {
  const raw = await fs.readFile(path.resolve(segment.promptFile), 'utf8')
  const prompt = raw.replace(/^# .*\n+/, '').trim()
  const formatText = format === 'desktop'
    ? '输出必须为原生 16:9 横屏 1080p，主体与运动方向适合桌面宽画幅。'
    : '输出必须为原生 9:16 竖屏 1080p，主体保持在竖屏中央安全区，不得裁掉头部、耳朵、触角或脚部。'
  return `${prompt}\n\n${formatText}`
}

async function imageContent(file, role) {
  const useJpeg = values.provider === 'kkidc_sd2'
  const image = sharp(file)
  const data = useJpeg
    ? await image.jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer()
    : await image.webp({ quality: 84, effort: 6, smartSubsample: true }).toBuffer()
  let url = `data:image/${useJpeg ? 'jpeg' : 'webp'};base64,${data.toString('base64')}`
  if (values.provider === 'kkidc_sd2') {
    const name = `${createHash('sha256').update(data).digest('hex')}.jpg`
    await fs.mkdir(requestAssetRoot, { recursive: true })
    await fs.writeFile(path.join(requestAssetRoot, name), data)
    if (assetUrlMap) {
      if (!assetUrlMap[name]) throw new Error(`${name} is missing from --asset-url-map.`)
      url = new URL(assetUrlMap[name]).toString()
    } else {
      if (!values['asset-base-url']) {
        throw new Error('--asset-base-url or --asset-url-map is required for kkidc_sd2.')
      }
      url = new URL(name, `${values['asset-base-url'].replace(/\/$/, '')}/`).toString()
    }
  }
  return {
    type: 'image_url',
    role,
    image_url: { url },
  }
}

async function requestFor(segment, format) {
  const content = [{ type: 'text', text: await promptFor(segment, format) }]
  if (segment.kind === 'dive-in') {
    const firstFrame = path.resolve(
      segment.inputFrames?.[format]?.first
        ?? path.join('.maka-media/first-frames', format, `${segment.id}.png`),
    )
    content.push(await imageContent(firstFrame, 'first_frame'))
    if (segment.inputFrames?.[format]?.last) {
      content.push(await imageContent(path.resolve(segment.inputFrames[format].last), 'last_frame'))
    }
  } else {
    const fromLast = boundaryPath(segment.from, format, 'last')
    const toFirst = boundaryPath(segment.to, format, 'first')
    if (!(await fileExists(fromLast)) || !(await fileExists(toFirst))) {
      throw new Error(`${taskKey(segment.id, format)} is missing real encoded boundary frames.`)
    }
    content.push(await imageContent(fromLast, 'first_frame'))
    content.push(await imageContent(toFirst, 'last_frame'))
  }
  for (const referenceImage of segment.referenceImages?.[format] ?? []) {
    content.push(await imageContent(path.resolve(referenceImage), 'reference_image'))
  }

  const ext = {
    model: manifest.model,
    content,
    duration: manifest.request.durationSeconds,
    generate_audio: manifest.request.generateAudio,
    ratio: manifest.formats[format].ratio,
    resolution: manifest.request.resolution,
    watermark: manifest.request.watermark,
  }
  if (values.provider === 'jieyun') {
    ext.return_last_frame = manifest.request.returnLastFrame
    ext.web_search = manifest.request.webSearch
  }

  return {
    idle_task: manifest.request.idleTask,
    ext,
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120000) })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`${response.status} ${url}: ${text.slice(0, 300)}`)
  }
  if (!response.ok || body.code !== 200) {
    throw new Error(`${response.status} ${url}: ${JSON.stringify(body).slice(0, 500)}`)
  }
  return body
}

async function submit(task) {
  const key = taskKey(task.segment.id, task.format)
  if (!values['dry-run'] && values['retry-failed'] && state.tasks[key]?.status === 'failed') {
    state.failedAttempts ??= []
    state.failedAttempts.push({ key, ...state.tasks[key] })
    delete state.tasks[key]
    await saveState()
  }
  if (!values['dry-run'] && !values.force && (state.tasks[key]?.taskId || await fileExists(publicPath(task.segment.id, task.format)))) return
  const payload = await requestFor(task.segment, task.format)
  if (values['dry-run']) {
    console.log(`[dry-run] ${key}: ${(JSON.stringify(payload).length / 1024 / 1024).toFixed(2)} MiB request`)
    return
  }
  const body = await fetchJson(`${API_BASE}${createPath}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const taskId = body.data?.task_id_for_swagger || String(body.data?.task_id ?? '')
  if (!taskId) throw new Error(`${key}: create response did not contain task_id.`)
  state.tasks[key] = {
    ...state.tasks[key],
    segmentId: task.segment.id,
    format: task.format,
    kind: task.segment.kind,
    supplier: values.provider,
    taskId,
    status: 'submitted',
    submittedAt: new Date().toISOString(),
  }
  await saveState()
  console.log(`[submitted] ${key}: ${taskId}`)
}

async function query(taskId) {
  const url = new URL(TASK_PATH, API_BASE)
  url.searchParams.set('task_id', taskId)
  return fetchJson(url)
}

async function download(url, destination) {
  const externalUrl = url.replace(INTERNAL_OSS_HOST, CDN_HOST)
  const response = await fetch(externalUrl, { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}: ${externalUrl}`)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()))
}

function run(binary, args, capture = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
    const stdout = []
    const stderr = []
    child.stdout?.on('data', (chunk) => stdout.push(chunk))
    child.stderr?.on('data', (chunk) => stderr.push(chunk))
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(Buffer.concat(stdout).toString())
      else reject(new Error(`${binary} exited ${code}: ${Buffer.concat(stderr).toString().slice(-2000)}`))
    })
  })
}

async function transcodeAndExtract(segmentId, format) {
  const source = sourcePath(segmentId, format)
  const output = publicPath(segmentId, format)
  const config = manifest.formats[format]
  await fs.mkdir(path.dirname(output), { recursive: true })
  const temporary = `${output}.tmp.mp4`
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', source,
    '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(config.crf),
    '-pix_fmt', 'yuv420p', '-g', String(config.gop), '-keyint_min', String(config.gop),
    '-sc_threshold', '0', '-movflags', '+faststart', '-map_metadata', '-1', temporary,
  ])
  await fs.rename(temporary, output)

  const probeText = await run(FFPROBE, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,r_frame_rate,nb_frames,duration',
    '-show_entries', 'format=duration,size,bit_rate', '-of', 'json', output,
  ], true)
  const probe = JSON.parse(probeText)
  const frames = Number.parseInt(probe.streams?.[0]?.nb_frames, 10)
  if (!Number.isInteger(frames) || frames < 2) throw new Error(`${segmentId}/${format}: invalid frame count.`)

  await fs.mkdir(path.dirname(boundaryPath(segmentId, format, 'first')), { recursive: true })
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', output,
    '-vf', 'select=eq(n\\,0)', '-fps_mode', 'vfr', '-frames:v', '1', boundaryPath(segmentId, format, 'first'),
  ])
  await run(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', output,
    '-vf', `select=eq(n\\,${frames - 1})`, '-fps_mode', 'vfr', '-frames:v', '1', boundaryPath(segmentId, format, 'last'),
  ])
  return probe
}

async function sha256(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex')
}

async function finalize(task, result) {
  const key = taskKey(task.segment.id, task.format)
  const items = result?.data
  const video = Array.isArray(items) && items.find((item) => item.role === 'video' && item.code === 100)
  if (!video?.url) throw new Error(`${key}: successful task did not return a video URL.`)
  await download(video.url, sourcePath(task.segment.id, task.format))
  const probe = await transcodeAndExtract(task.segment.id, task.format)
  const output = publicPath(task.segment.id, task.format)
  state.tasks[key] = {
    ...state.tasks[key],
    status: 'complete',
    completedAt: new Date().toISOString(),
    useTokens: result.use_tokens,
    providerResult: { duration: video.duration, resolution: video.resolution, fps: video.fps },
    output: path.relative(process.cwd(), output),
    sha256: await sha256(output),
    probe,
  }
  await saveState()
  console.log(`[complete] ${key}`)
}

async function processWave(tasks) {
  let cursor = 0
  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++]
      const key = taskKey(task.segment.id, task.format)
      if (!values['dry-run'] && !values.force && state.tasks[key]?.status === 'complete') continue
      if (!values['dry-run'] && values.force && state.tasks[key]) {
        state.supersededTasks ??= []
        state.supersededTasks.push({ key, supersededAt: new Date().toISOString(), ...state.tasks[key] })
        delete state.tasks[key]
        await saveState()
      }
      await submit(task)
      if (values['dry-run']) continue

      while (state.tasks[key]?.status !== 'complete') {
        const body = await query(state.tasks[key].taskId)
        const status = body.data?.status
        if (status === 100) await finalize(task, body.data.result)
        else if (status === 99) {
          state.tasks[key] = { ...state.tasks[key], status: 'failed', failure: body.data.result }
          await saveState()
          throw new Error(`${key}: provider task failed.`)
        } else {
          state.tasks[key] = { ...state.tasks[key], status: status === 10 ? 'processing' : 'queued' }
          await saveState()
          console.log(`[waiting] ${key}`)
          await new Promise((resolvePromise) => setTimeout(resolvePromise, pollMs))
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(maxInFlight, tasks.length) }, worker))
}

function tasksFor(kind) {
  return manifest.segments
    .filter((segment) => segment.kind === kind)
    .flatMap((segment) => Object.keys(manifest.formats).map((format) => ({ segment, format })))
    .filter((task) => !values.only || taskKey(task.segment.id, task.format) === values.only)
}

if (values.stage === 'all' || values.stage === 'dives') await processWave(tasksFor('dive-in'))
if (values.stage === 'all' || values.stage === 'connectors') await processWave(tasksFor('connector'))

console.log('Production video generation finished.')
