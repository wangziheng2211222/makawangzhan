import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

const manifestPath = path.resolve(process.argv[2] || 'media/video-manifest.json')
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
const outputRoot = path.resolve('.maka-media/first-frames')

function framePath(format, segmentId) {
  return path.join(outputRoot, format, `${segmentId}.png`)
}

async function sha256(filePath) {
  const buffer = await fs.readFile(filePath)
  return createHash('sha256').update(buffer).digest('hex')
}

async function renderSourceFrame(source, output, format) {
  const { width, height } = manifest.formats[format]
  await sharp(path.resolve(source))
    .resize(width, height, { fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toFile(output)
}

async function renderCharacterFrame(segment, output, format) {
  const { width, height } = manifest.formats[format]
  const environment = await sharp(path.resolve(segment.environment[format]))
    .resize(width, height, { fit: 'cover', position: 'centre', kernel: sharp.kernel.lanczos3 })
    .png()
    .toBuffer()

  const placement = format === 'desktop'
    ? { width: 620, height: 760, left: 1130, top: 190 }
    : { width: 760, height: 900, left: 160, top: 275 }

  const product = await sharp(path.resolve(segment.product))
    .resize(placement.width, placement.height, {
      fit: 'contain',
      kernel: sharp.kernel.lanczos3,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  await sharp(environment)
    .composite([{ input: product, left: placement.left, top: placement.top }])
    .png({ compressionLevel: 9 })
    .toFile(output)
}

const records = []
for (const segment of manifest.segments) {
  if (segment.kind !== 'dive-in') continue

  for (const format of Object.keys(manifest.formats)) {
    const output = framePath(format, segment.id)
    await fs.mkdir(path.dirname(output), { recursive: true })

    if (segment.source) {
      await renderSourceFrame(segment.source[format], output, format)
    } else {
      await renderCharacterFrame(segment, output, format)
    }

    const metadata = await sharp(output).metadata()
    records.push({
      id: segment.id,
      format,
      sourceStatus: segment.sourceStatus,
      path: path.relative(process.cwd(), output),
      width: metadata.width,
      height: metadata.height,
      sha256: await sha256(output),
    })
    console.log(`Wrote ${path.relative(process.cwd(), output)}`)
  }
}

await fs.writeFile(
  path.join(outputRoot, 'manifest.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), frames: records }, null, 2)}\n`,
)

console.log(`Prepared ${records.length} first frames.`)
