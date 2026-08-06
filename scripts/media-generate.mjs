import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    manifest: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
})

if (!values.manifest) {
  throw new Error('Missing --manifest <path>.')
}

const manifestPath = resolve(values.manifest)
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const issues = []

if (manifest.version !== 1) issues.push('Manifest version must be 1.')
if (!Array.isArray(manifest.tasks) || manifest.tasks.length === 0) {
  issues.push('Manifest must include at least one task.')
}

const taskIds = new Set()
for (const task of manifest.tasks ?? []) {
  if (!task.id || taskIds.has(task.id)) issues.push(`Duplicate or missing task id: ${task.id ?? 'missing'}.`)
  taskIds.add(task.id)
  if (!['dive-in', 'connector'].includes(task.kind)) issues.push(`${task.id} has an invalid kind.`)
  if (task.aspectRatio !== '16:9' || task.width !== 1280 || task.height !== 720) {
    issues.push(`${task.id} must use the 720p 16:9 pilot format.`)
  }
  if (task.codec !== 'h264' || task.gop !== 8 || task.audio !== false) {
    issues.push(`${task.id} must use H.264, GOP 8, and no audio.`)
  }
  if (!task.promptFile || !task.output) issues.push(`${task.id} is missing a prompt or output path.`)
}

for (const task of manifest.tasks ?? []) {
  for (const dependency of task.dependsOn ?? []) {
    if (!taskIds.has(dependency)) issues.push(`${task.id} depends on unknown task ${dependency}.`)
  }
}

if (issues.length > 0) {
  throw new Error(`Invalid media manifest:\n- ${issues.join('\n- ')}`)
}

console.table(manifest.tasks.map((task) => ({
  id: task.id,
  kind: task.kind,
  format: `${task.width}x${task.height}`,
  references: task.referenceStatus,
  output: task.output,
})))
console.log(`Supplier contract: ${manifest.supplierContractStatus}`)
console.log(`Price snapshot: ${manifest.priceSnapshot ?? 'not available'}`)

if (values['dry-run']) {
  console.log('Dry run passed. No generation task was submitted.')
  process.exit(0)
}

throw new Error(
  'Live submission is blocked until approved high-resolution references, current pricing, and the real Chanjing task tracking/download contract are available.',
)
