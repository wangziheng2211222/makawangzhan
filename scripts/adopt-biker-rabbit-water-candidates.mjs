import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

const API_BASE = 'http://ai-platform-dev.cds8.cn'
const TASK_PATH = '/v1/task/get'
const CDN_HOST = 'cdn-ai-platform-resource-test.cds8.cn'
const INTERNAL_OSS_HOST = 'ai-platform-resource-test.oss-cn-shanghai-internal.aliyuncs.com'

const outputRoot = path.resolve('output/story-scenes-v2')
const statePath = path.join(outputRoot, 'state.json')
const candidateRoot = path.join(outputRoot, 'candidates/biker-rabbit-water-v1')
const candidateStatePath = path.join(candidateRoot, 'state.json')
const keyframeRecordPath = path.join(outputRoot, 'rabbit-lake-candidates-v1/tasks.json')

const selections = {
  desktop: {
    keyframeKey: 'attempt-03/desktop',
    keyframeTaskId: '872514518240559104',
    videoTaskId: '872525243449180160',
    continuityKeyframe: path.join(candidateRoot, 'desktop-continuous-first.png'),
    publicKeyframe: path.resolve('public/images/scenes/source/biker-rabbit-desktop.png'),
    providerVideo: path.join(candidateRoot, 'desktop.mp4'),
    finalVideo: path.join(candidateRoot, 'desktop-continuous.mp4'),
    publicVideo: path.resolve('public/media/story-source/desktop/dive-biker-rabbit.mp4'),
  },
  mobile: {
    keyframeKey: 'attempt-05/mobile',
    keyframeTaskId: '872520768583987200',
    videoTaskId: '872525243444985856',
    continuityKeyframe: path.join(candidateRoot, 'mobile-continuous-first.png'),
    publicKeyframe: path.resolve('public/images/scenes/source/biker-rabbit-mobile.png'),
    providerVideo: path.join(candidateRoot, 'mobile.mp4'),
    finalVideo: path.join(candidateRoot, 'mobile-continuous.mp4'),
    publicVideo: path.resolve('public/media/story-source/mobile/dive-biker-rabbit.mp4'),
  },
}

function publicUrl(url) {
  return url?.replace(INTERNAL_OSS_HOST, CDN_HOST)
}

async function sha256(file) {
  return createHash('sha256').update(await fs.readFile(file)).digest('hex')
}

async function fetchTask(taskId) {
  const response = await fetch(`${API_BASE}${TASK_PATH}?task_id=${encodeURIComponent(taskId)}`, {
    signal: AbortSignal.timeout(120_000),
  })
  const body = await response.json()
  if (!response.ok || body.code !== 200 || body.data?.status !== 100) {
    throw new Error(`${taskId}: AI platform task is not complete: ${JSON.stringify(body).slice(0, 800)}`)
  }
  return body.data.result
}

async function copyAtomic(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  await fs.copyFile(source, temporary)
  await fs.rename(temporary, destination)
}

const [state, candidateState, keyframeRecord] = await Promise.all([
  fs.readFile(statePath, 'utf8').then(JSON.parse),
  fs.readFile(candidateStatePath, 'utf8').then(JSON.parse),
  fs.readFile(keyframeRecordPath, 'utf8').then(JSON.parse),
])
const adoptedAt = new Date().toISOString()

for (const [format, selection] of Object.entries(selections)) {
  const keyframeTask = keyframeRecord.tasks?.[selection.keyframeKey]
  const candidateTask = candidateState.tasks?.[`${format}/dive-biker-rabbit`]
  if (keyframeTask?.taskId !== selection.keyframeTaskId || keyframeTask.status !== 'complete') {
    throw new Error(`${format}: approved generation keyframe does not match the recorded selection.`)
  }
  if (
    candidateTask?.taskId !== selection.videoTaskId
    || candidateTask.keyframeTaskId !== selection.keyframeTaskId
    || candidateTask.keyframeKey !== selection.keyframeKey
    || candidateTask.status !== 'complete'
  ) throw new Error(`${format}: approved video task does not match the recorded selection.`)

  const [continuityKeyframeHash, publicKeyframeHash, finalVideoHash, publicVideoHash] =
    await Promise.all([
      sha256(selection.continuityKeyframe),
      sha256(selection.publicKeyframe),
      sha256(selection.finalVideo),
      sha256(selection.publicVideo),
    ])
  if (continuityKeyframeHash !== publicKeyframeHash) {
    throw new Error(`${format}: stable keyframe differs from the first continuous video frame.`)
  }
  if (finalVideoHash !== publicVideoHash) {
    throw new Error(`${format}: stable video differs from the reviewed continuous candidate.`)
  }

  const result = await fetchTask(selection.videoTaskId)
  const video = result?.data?.find((item) => item.code === 100 && item.role === 'video')
  if (!video?.url || publicUrl(video.url) !== candidateTask.providerUrl) {
    throw new Error(`${format}: live AI platform result does not match the approved provider URL.`)
  }

  const providerDestination = path.join(outputRoot, `provider-video/${format}/dive-biker-rabbit-provider.mp4`)
  const finalDestination = path.join(outputRoot, `videos/${format}/dive-biker-rabbit.mp4`)
  await Promise.all([
    copyAtomic(selection.providerVideo, providerDestination),
    copyAtomic(selection.finalVideo, finalDestination),
  ])

  const key = `video/${format}/dive-biker-rabbit`
  const previous = state.tasks?.[key]
  if (previous?.taskId && previous.taskId !== selection.videoTaskId) {
    state.supersededTasks ??= []
    state.supersededTasks.push({
      ...previous,
      supersededAt: adoptedAt,
      supersededByTaskId: selection.videoTaskId,
      supersededReason: 'Replaced by reviewed lake-pursuit video with a clear fear-of-water ending.',
    })
  }
  state.tasks ??= {}
  state.tasks[key] = {
    key,
    kind: 'video',
    taskId: selection.videoTaskId,
    status: 'complete',
    submittedAt: candidateTask.submittedAt,
    completedAt: candidateTask.completedAt,
    result,
    providerUrl: candidateTask.providerUrl,
    providerMetadata: candidateTask.metadata,
    adoptedAt,
    sourceCandidateState: path.relative(process.cwd(), candidateStatePath),
    sourceCandidateKey: `${format}/dive-biker-rabbit`,
    sourceKeyframeTaskId: selection.keyframeTaskId,
    sourceKeyframeUrl: candidateTask.firstFrameUrl,
    continuityTrimmedProviderFrames: 1,
    finalSourceSha256: finalVideoHash,
  }
}

const temporary = `${statePath}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`)
await fs.rename(temporary, statePath)

console.log('Adopted reviewed continuous biker-rabbit lake videos for desktop and mobile.')
