import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export const STORY_FORMATS = {
  desktop: { ratio: '16:9', width: 1920, height: 1080, gop: 8, crf: 20 },
  mobile: { ratio: '9:16', width: 1080, height: 1920, gop: 4, crf: 23 },
}

export const STORY_SCENE_IDS = [
  'dive-jiuka',
  'dive-little-devil',
  'dive-biker-rabbit',
  'dive-pipi',
]

export const STORY_CONNECTORS = [
  { id: 'connector-town-to-jiuka', from: 'dive-town', to: 'dive-jiuka' },
  { id: 'connector-jiuka-to-little-devil', from: 'dive-jiuka', to: 'dive-little-devil' },
  { id: 'connector-little-devil-to-biker-rabbit', from: 'dive-little-devil', to: 'dive-biker-rabbit' },
  { id: 'connector-biker-rabbit-to-pipi', from: 'dive-biker-rabbit', to: 'dive-pipi' },
  { id: 'connector-pipi-to-reunion', from: 'dive-pipi', to: 'dive-reunion' },
]

export const STORY_SEGMENT_IDS = [
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

export const STORY_DIVE_IDS = STORY_SEGMENT_IDS.filter((id) => id.startsWith('dive-'))

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((result, key) => {
      if (value[key] !== undefined) result[key] = canonicalize(value[key])
      return result
    }, {})
  }
  return value
}

export function inputFingerprint(value) {
  const canonical = JSON.stringify(canonicalize(value))
  return createHash('sha256').update(canonical).digest('hex')
}

export function promptFormatRule(kind, format) {
  const config = STORY_FORMATS[format]
  if (!config) throw new Error(`Unknown story format: ${format}`)
  const orientation = format === 'desktop' ? '横屏' : '竖屏'

  if (kind === 'connector') {
    return `输出必须是原生 ${config.ratio} ${orientation}构图。不得裁切、拉伸、重新取景或重构输入的首尾边界帧；视频第 0 帧和最终帧必须分别保持对应输入边界的完整画幅。`
  }
  if (kind === 'dive') {
    return `输出必须是原生 ${config.ratio} ${orientation}构图。严格延续输入首帧的完整画幅，不得裁切、拉伸或重新取景。`
  }
  if (kind === 'image') {
    return format === 'desktop'
      ? '输出必须是原生 16:9 横屏构图。角色和叙事动作位于画面右侧，左侧保留自然、低细节的文案负空间。'
      : '输出必须是原生 9:16 竖屏构图。角色、脸和关键道具完整位于上半部至中部，底部 32% 保持安静，不得裁掉帽尖、耳朵、触角、角或脚。'
  }
  throw new Error(`Unknown prompt kind: ${kind}`)
}

function isStoryPromptPath(file) {
  return typeof file === 'string'
    && /^media\/prompts\/story-scenes-v2\/[a-z0-9-]+\.md$/.test(file)
}

export function manifestIssues(manifest) {
  const issues = []
  if (manifest.version !== 1) issues.push('Manifest version must be 1.')

  const sceneIds = manifest.scenes?.map((scene) => scene.id) ?? []
  if (JSON.stringify(sceneIds) !== JSON.stringify(STORY_SCENE_IDS)) {
    issues.push(`Scene order must be: ${STORY_SCENE_IDS.join(', ')}.`)
  }

  const connectors = (manifest.connectors ?? []).map(({ id, from, to }) => ({ id, from, to }))
  if (JSON.stringify(connectors) !== JSON.stringify(STORY_CONNECTORS)) {
    issues.push('Connector id/from/to order does not match the six-chapter journey.')
  }
  for (const connector of manifest.connectors ?? []) {
    if (!isStoryPromptPath(connector.promptFile)) {
      issues.push(`${connector.id}.promptFile must be a repo-relative story prompt .md path.`)
    }
    for (const field of ['formatPromptFiles', 'formatPromptOverrides']) {
      for (const [format, file] of Object.entries(connector[field] ?? {})) {
        if (!STORY_FORMATS[format]) {
          issues.push(`${connector.id}.${field} contains unknown format ${format}.`)
        }
        if (!isStoryPromptPath(file)) {
          issues.push(`${connector.id}.${field}.${format} must be a repo-relative story prompt .md path.`)
        }
      }
    }
    for (const format of Object.keys(connector.formatPromptFiles ?? {})) {
      if (Object.hasOwn(connector.formatPromptOverrides ?? {}, format)) {
        issues.push(`${connector.id}.${format} cannot configure both a prompt supplement and override.`)
      }
    }
  }

  const formatNames = Object.keys(manifest.formats ?? {})
  if (JSON.stringify(formatNames) !== JSON.stringify(Object.keys(STORY_FORMATS))) {
    issues.push('Manifest formats must contain desktop then mobile, and no other formats.')
  }
  for (const [format, expected] of Object.entries(STORY_FORMATS)) {
    const actual = manifest.formats?.[format]
    if (!actual) continue
    for (const field of ['ratio', 'width', 'height', 'gop', 'crf']) {
      if (actual[field] !== expected[field]) {
        issues.push(`${format}.${field} must be ${expected[field]}, received ${actual[field]}.`)
      }
    }
  }

  if (
    manifest.video?.model !== 'doubao-seedance-2-0-fast-260128'
    && manifest.video?.model !== 'doubao-seedance-2-0-260128'
  ) {
    issues.push('Character story videos must use a supported KKIDC Seedance 2.0 model.')
  }

  for (const scene of manifest.scenes ?? []) {
    for (const field of ['imagePromptFile', 'videoPromptFile']) {
      if (!isStoryPromptPath(scene[field])) {
        issues.push(`${scene.id}.${field} must be a repo-relative story prompt .md path.`)
      }
    }
    for (const [format, source] of Object.entries(scene.manualImageSources ?? {})) {
      if (!STORY_FORMATS[format]) {
        issues.push(`${scene.id}.manualImageSources contains unknown format ${format}.`)
        continue
      }
      if (!source?.file || typeof source.file !== 'string') {
        issues.push(`${scene.id}.manualImageSources.${format}.file must be a local file path.`)
      }
      if (!source?.url || !/^https?:\/\//.test(source.url)) {
        issues.push(`${scene.id}.manualImageSources.${format}.url must be an HTTP(S) URL.`)
      }
      if (!/^[a-f0-9]{64}$/.test(source?.sha256 ?? '')) {
        issues.push(`${scene.id}.manualImageSources.${format}.sha256 must be a lowercase SHA-256 digest.`)
      }
    }
  }

  for (const [format, sources] of Object.entries(manifest.boundarySources ?? {})) {
    if (!STORY_FORMATS[format]) {
      issues.push(`boundarySources contains unknown format ${format}.`)
      continue
    }
    for (const [id, source] of Object.entries(sources ?? {})) {
      if (!STORY_DIVE_IDS.includes(id)) issues.push(`boundarySources.${format} contains unknown dive ${id}.`)
      if (!source?.url || !/^https?:\/\//.test(source.url)) {
        issues.push(`boundarySources.${format}.${id}.url must be an HTTP(S) URL.`)
      }
      if (!/^[a-f0-9]{64}$/.test(source?.sha256 ?? '')) {
        issues.push(`boundarySources.${format}.${id}.sha256 must be a lowercase SHA-256 digest.`)
      }
    }
  }

  return issues
}

export function assertValidManifest(manifest) {
  const issues = manifestIssues(manifest)
  if (issues.length) throw new Error(`Invalid story scene manifest:\n- ${issues.join('\n- ')}`)
}

function manifestPromptFiles(manifest) {
  return new Set([
    ...(manifest.scenes ?? []).flatMap((scene) => [
      scene.imagePromptFile,
      scene.videoPromptFile,
    ]),
    ...(manifest.connectors ?? []).flatMap((connector) => [
      connector.promptFile,
      ...Object.values(connector.formatPromptFiles ?? {}),
      ...Object.values(connector.formatPromptOverrides ?? {}),
    ]),
  ].filter((file) => typeof file === 'string'))
}

export async function manifestPromptFileIssues(manifest, projectRoot = process.cwd()) {
  const checks = [...manifestPromptFiles(manifest)].map(async (file) => {
    const resolved = path.resolve(projectRoot, file)
    try {
      const stats = await fs.stat(resolved)
      return stats.isFile() ? null : `${file}: prompt path must be a regular file.`
    } catch (error) {
      if (error.code === 'ENOENT') return `${file}: prompt file is missing.`
      return `${file}: prompt file could not be inspected (${error.code ?? error.message}).`
    }
  })
  return (await Promise.all(checks)).filter(Boolean)
}

export async function assertValidManifestPromptFiles(manifest, projectRoot = process.cwd()) {
  const issues = await manifestPromptFileIssues(manifest, projectRoot)
  if (issues.length) throw new Error(`Invalid story scene prompt files:\n- ${issues.join('\n- ')}`)
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const BOUNDARY_REUSE_FIELDS = [
  'edgeSsim',
  'reason',
  'reusedAt',
  'sourceSha256',
  'sourceUrl',
]

function isCanonicalIsoTimestamp(value) {
  if (typeof value !== 'string') return false
  const timestamp = new Date(value)
  return !Number.isNaN(timestamp.valueOf()) && timestamp.toISOString() === value
}

export function boundaryInputFingerprintMatches(task, current) {
  if (
    SHA256_PATTERN.test(current?.expectedFingerprint ?? '')
    && task?.inputFingerprint === current.expectedFingerprint
  ) return true

  const reuse = task?.boundaryReuse
  if (!reuse || typeof reuse !== 'object' || Array.isArray(reuse)) return false
  if (JSON.stringify(Object.keys(reuse).sort()) !== JSON.stringify(BOUNDARY_REUSE_FIELDS)) return false

  return SHA256_PATTERN.test(task?.inputFingerprint ?? '')
    && SHA256_PATTERN.test(current?.expectedFingerprint ?? '')
    && reuse.reason === 'local-interior-repair'
    && SHA256_PATTERN.test(reuse.sourceSha256 ?? '')
    && reuse.sourceSha256 === current?.sourceSha256
    && typeof reuse.sourceUrl === 'string'
    && /^https?:\/\//.test(reuse.sourceUrl)
    && reuse.sourceUrl === current?.sourceUrl
    && Number.isFinite(reuse.edgeSsim)
    && reuse.edgeSsim >= 0.95
    && reuse.edgeSsim <= 1
    && reuse.edgeSsim === current?.edgeSsim
    && isCanonicalIsoTimestamp(reuse.reusedAt)
}

export function publishInventoryIssues(entries) {
  const issues = []
  for (const entry of entries) {
    if (!entry.exists) issues.push(`${entry.key}: candidate file is missing.`)
    if (entry.requiresTask && entry.taskStatus !== 'complete') {
      issues.push(`${entry.key}: task must be complete, received ${entry.taskStatus ?? 'missing'}.`)
    }
    if (entry.requiresFingerprint && entry.fingerprintMatches !== true) {
      issues.push(`${entry.key}: input fingerprint is stale or missing.`)
    }
    if (entry.requiresArtifactFingerprint && entry.artifactFingerprintMatches !== true) {
      issues.push(`${entry.key}: candidate file hash does not match task state.`)
    }
    if (entry.kind === 'boundary' && entry.boundarySourceKind !== 'final-encoded-external') {
      issues.push(`${entry.key}: boundary source must be final-encoded-external, received ${entry.boundarySourceKind ?? 'missing'}.`)
    }
    for (const issue of entry.mediaIssues ?? []) issues.push(`${entry.key}: ${issue}`)
  }
  return issues
}
