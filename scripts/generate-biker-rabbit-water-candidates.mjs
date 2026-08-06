import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

const API_BASE = 'http://ai-platform-dev.cds8.cn'
const TASK_PATH = '/v1/task/get'
const CDN_HOST = 'cdn-ai-platform-resource-test.cds8.cn'
const INTERNAL_OSS_HOST = 'ai-platform-resource-test.oss-cn-shanghai-internal.aliyuncs.com'

const { values } = parseArgs({
  options: {
    candidate: { type: 'string', default: 'biker-rabbit-water-v1' },
    'keyframe-record': {
      type: 'string',
      default: 'output/story-scenes-v2/rabbit-lake-candidates-v1/tasks.json',
    },
    'keyframe-source-key': { type: 'string', default: 'attempt-01' },
    'desktop-keyframe-key': { type: 'string' },
    'mobile-keyframe-key': { type: 'string' },
    'poll-seconds': { type: 'string', default: '10' },
  },
})

if (!/^[a-z0-9][a-z0-9-]*$/.test(values.candidate)) {
  throw new Error('--candidate must contain only lowercase letters, numbers, and hyphens.')
}

const pollMs = Number.parseInt(values['poll-seconds'], 10) * 1000
if (!Number.isFinite(pollMs) || pollMs < 5000) {
  throw new Error('--poll-seconds must be at least 5.')
}

const manifest = JSON.parse(await fs.readFile('media/story-scenes-v2.json', 'utf8'))
const keyframeRecord = JSON.parse(await fs.readFile(values['keyframe-record'], 'utf8'))
const prompt = (await fs.readFile(
  'media/prompts/story-scenes-v2/biker-rabbit-water-motion.md',
  'utf8',
)).replace(/^# .*\n+/, '').trim()
const scene = manifest.scenes.find((item) => item.id === 'dive-biker-rabbit')
if (!scene) throw new Error('dive-biker-rabbit is missing from the story scene manifest.')

const outputRoot = path.resolve('output/story-scenes-v2/candidates', values.candidate)
const statePath = path.join(outputRoot, 'state.json')
const state = await readJson(statePath, { version: 1, tasks: {} })

function publicUrl(url) {
  return url?.replace(INTERNAL_OSS_HOST, CDN_HOST)
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
  await fs.mkdir(outputRoot, { recursive: true })
  const temporary = `${statePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`)
  await fs.rename(temporary, statePath)
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

async function download(url, destination) {
  const response = await fetch(publicUrl(url), { signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`)
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()))
}

function successfulVideo(result) {
  return result?.data?.find((item) => item.code === 100 && item.role === 'video')
    ?? result?.data?.find((item) => item.code === 100 && item.url)
}

function payloadFor(format, firstFrameUrl) {
  const formatInstruction = format === 'desktop'
    ? '输出必须为原生 16:9 横屏 1080p；主体、湖岸和追捕路线都在桌面安全区内。'
    : '输出必须为原生 9:16 竖屏 1080p；两只耳朵、机车、湖岸、两条腿和两只脚始终完整，不得被画面边缘裁切。'
  const lockedFrameInstruction = '输入图片是审核通过的唯一首帧。视频第 0 帧必须与输入图完全一致，只能从该首帧继续动作，不得重新绘制角色、机车或街景。'
  return {
    idle_task: 0,
    ext: {
      model: manifest.video.model,
      content: [
        { type: 'text', text: `${prompt}\n\n${lockedFrameInstruction}\n${formatInstruction}` },
        { type: 'image_url', role: 'first_frame', image_url: { url: firstFrameUrl } },
      ],
      duration: manifest.video.durationSeconds,
      generate_audio: manifest.video.generateAudio,
      ratio: manifest.formats[format].ratio,
      resolution: manifest.video.resolution,
      watermark: manifest.video.watermark,
    },
  }
}

async function ensureSubmitted(format) {
  const key = `${format}/dive-biker-rabbit`
  if (state.tasks[key]?.taskId) return state.tasks[key]
  const keyframeKey = values[`${format}-keyframe-key`]
    ?? `${values['keyframe-source-key']}/${format}`
  const imageTask = keyframeRecord.tasks[keyframeKey]
  if (!imageTask?.providerUrl) throw new Error(`${format}: generated lake keyframe URL is missing.`)
  const payload = payloadFor(format, imageTask.providerUrl)
  const body = await fetchJson(`${API_BASE}${manifest.video.endpoint}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const taskId = body.data?.task_id_for_swagger || String(body.data?.task_id ?? '')
  if (!taskId) throw new Error(`${format}: create response did not contain task_id.`)
  state.tasks[key] = {
    taskId,
    status: 'submitted',
    firstFrameUrl: imageTask.providerUrl,
    keyframeKey,
    keyframeTaskId: imageTask.taskId,
    submittedAt: new Date().toISOString(),
  }
  await saveState()
  console.log(`[submitted] ${key}: ${taskId}`)
  return state.tasks[key]
}

async function waitForVideo(format) {
  const key = `${format}/dive-biker-rabbit`
  const task = state.tasks[key]
  if (task.status === 'complete' && task.file) return
  while (true) {
    const body = await fetchJson(`${API_BASE}${TASK_PATH}?task_id=${encodeURIComponent(task.taskId)}`)
    const status = body.data?.status
    if (status === 99) {
      state.tasks[key] = { ...task, status: 'failed', result: body.data.result }
      await saveState()
      throw new Error(`${key}: provider task failed.`)
    }
    if (status === 100) {
      const video = successfulVideo(body.data.result)
      if (!video?.url) throw new Error(`${key}: successful task has no video URL.`)
      const destination = path.join(outputRoot, `${format}.mp4`)
      await download(video.url, destination)
      state.tasks[key] = {
        ...task,
        status: 'complete',
        completedAt: new Date().toISOString(),
        providerUrl: publicUrl(video.url),
        metadata: {
          duration: video.duration,
          fps: video.fps,
          resolution: video.resolution,
        },
        file: path.relative(process.cwd(), destination),
      }
      await saveState()
      console.log(`[complete] ${key}: ${state.tasks[key].file}`)
      return
    }
    state.tasks[key] = { ...task, status: status === 10 ? 'processing' : 'queued' }
    await saveState()
    console.log(`[waiting] ${key}`)
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

await Promise.all(['desktop', 'mobile'].map(ensureSubmitted))
await Promise.all(['desktop', 'mobile'].map(waitForVideo))
