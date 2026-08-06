import fs from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'

const API_BASE = 'http://ai-platform-dev.cds8.cn'
const CREATE_PATH = '/v2/external/image/tencent/gpt-image2/create'
const TASK_PATH = '/v1/task/get'
const INTERNAL_OSS_HOST = 'ai-platform-resource-test.oss-cn-shanghai-internal.aliyuncs.com'
const CDN_HOST = 'cdn-ai-platform-resource-test.cds8.cn'
const OUTPUT_ROOT = path.resolve('output/story-scenes-v2/rabbit-candidates-v5')
const TASK_RECORD_PATH = path.join(OUTPUT_ROOT, 'tasks.json')
const CHARACTER_REFERENCE_URL = 'https://raw.githubusercontent.com/wangziheng2211222/makawangzhan/main/public/images/products/biker-rabbit-cutout.webp'
const STYLE_REFERENCE_URL = 'https://raw.githubusercontent.com/wangziheng2211222/makawangzhan/main/public/images/scenes/maka-town-social.webp'

const { values } = parseArgs({
  options: {
    attempt: { type: 'string', default: 'attempt-01' },
    format: { type: 'string', default: 'all' },
    'source-key': { type: 'string' },
    'edit-target-url': { type: 'string' },
    'target-only': { type: 'boolean', default: false },
    'character-reference-url': { type: 'string', default: CHARACTER_REFERENCE_URL },
    prompt: { type: 'string', default: 'media/prompts/story-scenes-v2/biker-rabbit-keyframe.md' },
    'poll-seconds': { type: 'string', default: '10' },
  },
})

const promptPath = path.resolve(values.prompt)

if (!/^[a-z0-9-]+$/.test(values.attempt)) {
  throw new Error('--attempt must contain only lowercase letters, digits, and hyphens.')
}
if (!['desktop', 'mobile', 'all'].includes(values.format)) {
  throw new Error('--format must be desktop, mobile, or all.')
}
const pollMs = Number.parseInt(values['poll-seconds'], 10) * 1000
if (!Number.isFinite(pollMs) || pollMs < 5000) {
  throw new Error('--poll-seconds must be at least 5.')
}

const formats = {
  desktop: {
    ratio: '16:9',
    formatPrompt: '输出必须是原生 16:9 横屏 2K 构图。角色和追捕动作位于画面右侧，左侧保留自然、低细节的文案负空间。两耳与两脚必须完整入画。',
  },
  mobile: {
    ratio: '9:16',
    formatPrompt: '输出必须是原生 9:16 竖屏 2K 构图。角色、脸和机车完整位于上半部至中部，底部 30% 保持连续安静路面。两耳与两脚必须完整入画。',
  },
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`)
  await fs.rename(temporary, file)
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

function publicUrl(url) {
  return url?.replace(INTERNAL_OSS_HOST, CDN_HOST)
}

async function saveRecord(record) {
  record.updatedAt = new Date().toISOString()
  await writeJson(TASK_RECORD_PATH, record)
}

async function generate(format, basePrompt, record) {
  const key = `${values.attempt}/${format}`
  const destination = path.join(OUTPUT_ROOT, 'attempts', values.attempt, format, 'biker-rabbit.png')
  let task = record.tasks[key]

  if (!task?.taskId) {
    const sourceTask = values['source-key'] ? record.tasks[values['source-key']] : null
    if (values['source-key'] && !sourceTask?.providerUrl) {
      throw new Error(`--source-key ${values['source-key']} does not identify a completed candidate.`)
    }
    const correctionPrompt = sourceTask && !values['edit-target-url']
      ? '\n\n图 2 是已生成的构图参考。保留它已经正确的结构拓扑：原短臂末端与握把同高、零间隙直接连接，没有第二对手。将这个正确结构重构为本次要求的目标宽高比，不复制错误附肢。'
      : ''
    const prompt = values['target-only']
      ? basePrompt
      : `${basePrompt}${correctionPrompt}\n\n${formats[format].formatPrompt}`
    const referenceUrls = values['edit-target-url']
      ? values['target-only']
        ? [values['edit-target-url']]
        : [values['edit-target-url'], values['character-reference-url']]
      : sourceTask
      ? [values['character-reference-url'], sourceTask.providerUrl]
      : [values['character-reference-url'], STYLE_REFERENCE_URL]
    const payload = {
      idle_task: 0,
      tag: 'live-long',
      ext: {
        aspect_radio: formats[format].ratio,
        image_url: referenceUrls,
        model_version: 'image2_high',
        prompt,
        resolution: '2K',
      },
    }
    const body = await fetchJson(`${API_BASE}${CREATE_PATH}`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const taskId = body.data?.task_id_for_swagger || String(body.data?.task_id ?? '')
    if (!taskId) throw new Error(`${key}: create response did not contain task_id.`)
    task = record.tasks[key] = {
      key,
      taskId,
      status: 'submitted',
      submittedAt: new Date().toISOString(),
      endpoint: CREATE_PATH,
      request: payload,
      createResponse: body,
      destination: path.relative(process.cwd(), destination),
      sourceKey: values['source-key'] ?? null,
    }
    await saveRecord(record)
    console.log(`[submitted] ${key}: ${taskId}`)
  }

  if (task.status === 'complete') {
    console.log(`[existing] ${key}: ${task.taskId}`)
    return
  }

  while (true) {
    const body = await fetchJson(`${API_BASE}${TASK_PATH}?task_id=${encodeURIComponent(task.taskId)}`)
    const status = body.data?.status
    if (status === 99) {
      Object.assign(task, {
        status: 'failed',
        failedAt: new Date().toISOString(),
        taskResponse: body,
      })
      await saveRecord(record)
      throw new Error(`${key}: provider task failed: ${JSON.stringify(body.data?.result).slice(0, 1000)}`)
    }
    if (status === 100) {
      const image = body.data?.result?.data?.find((item) => item.code === 100 && item.url)
      if (!image?.url) throw new Error(`${key}: successful task did not return an image URL.`)
      const response = await fetch(publicUrl(image.url), { signal: AbortSignal.timeout(180000) })
      if (!response.ok) throw new Error(`${key}: image download failed with HTTP ${response.status}.`)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()))
      Object.assign(task, {
        status: 'complete',
        completedAt: new Date().toISOString(),
        providerUrl: publicUrl(image.url),
        taskResponse: body,
      })
      await saveRecord(record)
      console.log(`[downloaded] ${path.relative(process.cwd(), destination)}`)
      return
    }
    task.status = status === 10 ? 'processing' : 'queued'
    task.lastPolledAt = new Date().toISOString()
    await saveRecord(record)
    console.log(`[waiting] ${key}: ${task.status}`)
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}

const promptRaw = await fs.readFile(promptPath, 'utf8')
const basePrompt = promptRaw.replace(/^# .*\n+/, '').trim()
const record = await readJson(TASK_RECORD_PATH, {
  version: 1,
  purpose: 'isolated Gee-too 2K keyframe candidates',
  outputRoot: path.relative(process.cwd(), OUTPUT_ROOT),
  promptFile: path.relative(process.cwd(), promptPath),
  createdAt: new Date().toISOString(),
  tasks: {},
})

const selectedFormats = values.format === 'all' ? ['desktop', 'mobile'] : [values.format]
for (const format of selectedFormats) {
  await generate(format, basePrompt, record)
}
