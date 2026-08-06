import fs from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

const outputRoot = path.resolve('output/story-scenes-v2')
const statePath = path.join(outputRoot, 'state.json')
const candidateRoot = path.join(outputRoot, 'rabbit-candidates-v5')
const candidateRecordPath = path.join(candidateRoot, 'tasks.json')
const manualProvenancePath = path.join(outputRoot, 'manual-source/biker-rabbit-provenance.json')

try {
  const manualProvenance = JSON.parse(await fs.readFile(manualProvenancePath, 'utf8'))
  if (manualProvenance.reviewStatus?.includes('manual-keyframes-approved')) {
    throw new Error(
      'Refusing to restore old generated biker-rabbit candidates over approved manual keyframes.',
    )
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const selections = {
  desktop: {
    candidateKey: 'attempt-02/desktop',
    taskId: '872413401338970112',
    source: path.join(candidateRoot, 'attempts/attempt-02/desktop/biker-rabbit.png'),
    destination: path.join(outputRoot, 'images/desktop/biker-rabbit.jpg'),
    width: 2560,
    height: 1440,
  },
  mobile: {
    candidateKey: 'attempt-01/mobile',
    taskId: '872412086722461696',
    source: path.join(candidateRoot, 'attempts/attempt-01/mobile/biker-rabbit.png'),
    destination: path.join(outputRoot, 'images/mobile/biker-rabbit.jpg'),
    width: 1440,
    height: 2560,
  },
}

const [state, candidateRecord] = await Promise.all([
  readJson(statePath),
  readJson(candidateRecordPath),
])
const adoptedAt = new Date().toISOString()
const preparedImages = []

for (const [format, selection] of Object.entries(selections)) {
  const candidate = candidateRecord.tasks?.[selection.candidateKey]
  if (!candidate) throw new Error(`${selection.candidateKey}: missing candidate task record.`)
  if (candidate.taskId !== selection.taskId) {
    throw new Error(`${selection.candidateKey}: expected task ${selection.taskId}, got ${candidate.taskId}.`)
  }
  if (candidate.status !== 'complete' || !candidate.providerUrl) {
    throw new Error(`${selection.candidateKey}: candidate is not complete with a provider URL.`)
  }
  const result = candidate.taskResponse?.data?.result
  const successfulImage = result?.data?.find((item) => item.code === 100 && item.url)
  if (!successfulImage?.url) {
    throw new Error(`${selection.candidateKey}: candidate result has no successful image item.`)
  }

  const metadata = await sharp(selection.source).metadata()
  if (metadata.width !== selection.width || metadata.height !== selection.height) {
    throw new Error(
      `${selection.candidateKey}: expected ${selection.width}x${selection.height}, got ${metadata.width}x${metadata.height}.`,
    )
  }

  const temporary = `${selection.destination}.${process.pid}.tmp`
  await fs.mkdir(path.dirname(selection.destination), { recursive: true })
  await sharp(selection.source)
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4', progressive: true, mozjpeg: true })
    .toFile(temporary)
  preparedImages.push({ temporary, destination: selection.destination })

  const key = `image/${format}/dive-biker-rabbit`
  const previous = state.tasks?.[key]
  if (previous?.taskId && previous.taskId !== candidate.taskId) {
    state.supersededTasks ??= []
    state.supersededTasks.push({
      ...previous,
      supersededAt: adoptedAt,
      supersededByTaskId: candidate.taskId,
      supersededReason: 'Replaced by reviewed Gee-too rabbit-candidates-v5 keyframe.',
    })
  }

  state.tasks ??= {}
  state.tasks[key] = {
    key,
    kind: 'image',
    taskId: candidate.taskId,
    status: 'complete',
    submittedAt: candidate.submittedAt,
    completedAt: candidate.completedAt,
    result,
    providerUrl: candidate.providerUrl,
    adoptedAt,
    sourceTaskRecord: path.relative(process.cwd(), candidateRecordPath),
    sourceTaskKey: candidate.key,
    sourceCandidatePath: path.relative(process.cwd(), selection.source),
  }
}

const stateTemporary = `${statePath}.${process.pid}.tmp`
await fs.writeFile(stateTemporary, `${JSON.stringify(state, null, 2)}\n`)

try {
  for (const prepared of preparedImages) {
    await fs.rename(prepared.temporary, prepared.destination)
  }
  await fs.rename(stateTemporary, statePath)
} catch (error) {
  await Promise.allSettled([
    fs.unlink(stateTemporary),
    ...preparedImages.map(({ temporary }) => fs.unlink(temporary)),
  ])
  throw error
}

console.log(`Adopted desktop task ${selections.desktop.taskId}.`)
console.log(`Adopted mobile task ${selections.mobile.taskId}.`)

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'))
}
