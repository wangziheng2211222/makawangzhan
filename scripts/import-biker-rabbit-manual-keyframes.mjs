import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

const projectRoot = process.cwd()
const outputRoot = path.resolve('output/story-scenes-v2')
const manualRoot = path.join(outputRoot, 'manual-source')
const qcRoot = path.join(outputRoot, 'qc/biker-rabbit-manual')
const referencePath = path.resolve('public/images/products/biker-rabbit-cutout.webp')

const sources = {
  desktop: {
    source: '/Users/cds-dn-680/Desktop/机车兔-169.png',
    png: path.join(manualRoot, 'biker-rabbit-desktop.png'),
    jpg: path.join(outputRoot, 'images/desktop/biker-rabbit.jpg'),
    expected: { width: 1672, height: 941 },
  },
  mobile: {
    source: '/Users/cds-dn-680/Desktop/机车兔-916.png',
    png: path.join(manualRoot, 'biker-rabbit-mobile.png'),
    jpg: path.join(outputRoot, 'images/mobile/biker-rabbit.jpg'),
    expected: { width: 941, height: 1672 },
  },
}

const importedAt = new Date().toISOString()
const provenance = {
  version: 1,
  character: 'Gee-too / biker-rabbit',
  importedAt,
  reviewStatus: 'manual-keyframes-approved; pipeline adoption pending public URL',
  stateModified: false,
  sources: {},
  qc: {},
}

for (const [format, item] of Object.entries(sources)) {
  const [sourceBuffer, metadata] = await Promise.all([
    fs.readFile(item.source),
    sharp(item.source).metadata(),
  ])
  if (metadata.width !== item.expected.width || metadata.height !== item.expected.height) {
    throw new Error(
      `${format}: expected ${item.expected.width}x${item.expected.height}, got ${metadata.width}x${metadata.height}.`,
    )
  }

  await atomicWrite(item.png, sourceBuffer)
  const jpegBuffer = await sharp(sourceBuffer)
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4', progressive: true, mozjpeg: true })
    .toBuffer()
  await atomicWrite(item.jpg, jpegBuffer)

  const jpegMetadata = await sharp(jpegBuffer).metadata()
  provenance.sources[format] = {
    sourcePath: item.source,
    sourceSha256: sha256(sourceBuffer),
    sourceFormat: metadata.format,
    sourceWidth: metadata.width,
    sourceHeight: metadata.height,
    preservedPngPath: path.relative(projectRoot, item.png),
    preservedPngSha256: sha256(await fs.readFile(item.png)),
    pipelineJpegPath: path.relative(projectRoot, item.jpg),
    pipelineJpegSha256: sha256(jpegBuffer),
    pipelineJpegFormat: jpegMetadata.format,
    pipelineJpegWidth: jpegMetadata.width,
    pipelineJpegHeight: jpegMetadata.height,
    providerUrl: null,
  }
}

await fs.mkdir(qcRoot, { recursive: true })
const overviewPath = path.join(qcRoot, 'overview-board.jpg')
const anatomyPath = path.join(qcRoot, 'anatomy-board.jpg')
await atomicWrite(overviewPath, await buildOverviewBoard())
await atomicWrite(anatomyPath, await buildAnatomyBoard())

provenance.qc = {
  overviewBoard: path.relative(projectRoot, overviewPath),
  anatomyBoard: path.relative(projectRoot, anatomyPath),
  checklist: {
    topEars: '2 visible',
    shortArms: '2 original face-side short arms; each is the only hand contact for its grip',
    extraGripHands: 'none visible',
    longLegs: '2 separate long legs',
    feet: '2 visible feet on separate footrests',
    bandage: '1 white bandage on one lower leg only',
  },
}

await atomicWrite(
  path.join(manualRoot, 'biker-rabbit-provenance.json'),
  Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`),
)

console.log('Imported manual desktop and mobile Gee-too keyframes without modifying pipeline state.')

async function buildOverviewBoard() {
  const canvas = sharp({
    create: { width: 2600, height: 1420, channels: 3, background: '#eef1f2' },
  })
  const desktop = await framedImage(sources.desktop.source, 1800, 1013, 'DESKTOP 16:9')
  const mobile = await framedImage(sources.mobile.source, 570, 1013, 'MOBILE 9:16')
  return canvas
    .composite([
      { input: desktop, left: 80, top: 190 },
      { input: mobile, left: 1950, top: 190 },
      { input: label('MANUAL KEYFRAME OVERVIEW', 62, 2440, 100), left: 80, top: 55 },
    ])
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4', progressive: true, mozjpeg: true })
    .toBuffer()
}

async function buildAnatomyBoard() {
  const canvas = sharp({
    create: { width: 2760, height: 1260, channels: 3, background: '#eef1f2' },
  })
  const reference = await framedImage(referencePath, 620, 1000, 'ORIGINAL CHARACTER')
  const desktopCrop = await framedCrop(
    sources.desktop.source,
    { left: 745, top: 45, width: 640, height: 850 },
    900,
    1000,
    'DESKTOP CONTACT',
  )
  const mobileCrop = await framedCrop(
    sources.mobile.source,
    { left: 205, top: 350, width: 535, height: 1010 },
    900,
    1000,
    'MOBILE CONTACT',
  )
  return canvas
    .composite([
      { input: reference, left: 60, top: 190 },
      { input: desktopCrop, left: 740, top: 190 },
      { input: mobileCrop, left: 1700, top: 190 },
      { input: label('GEE-TOO ANATOMY AND GRIP CHECK', 58, 2640, 100), left: 60, top: 55 },
    ])
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4', progressive: true, mozjpeg: true })
    .toBuffer()
}

async function framedImage(file, width, height, title) {
  const image = await sharp(file)
    .resize(width - 24, height - 84, { fit: 'contain', background: '#ffffff' })
    .extend({ top: 0, bottom: 0, left: 0, right: 0, background: '#ffffff' })
    .toBuffer()
  return frame(image, width, height, title)
}

async function framedCrop(file, extract, width, height, title) {
  const image = await sharp(file)
    .extract(extract)
    .resize(width - 24, height - 84, { fit: 'contain', background: '#ffffff' })
    .toBuffer()
  return frame(image, width, height, title)
}

async function frame(image, width, height, title) {
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite([
      { input: image, left: 12, top: 72 },
      { input: label(title, 30, width - 24, 50), left: 12, top: 12 },
    ])
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer()
}

function label(text, fontSize, width, height) {
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
      + `<text x="0" y="${Math.round(fontSize * 0.8)}" font-family="Arial, sans-serif" `
      + `font-size="${fontSize}" font-weight="700" fill="#202426">${escaped}</text></svg>`,
  )
}

async function atomicWrite(destination, buffer) {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.tmp`
  await fs.writeFile(temporary, buffer)
  await fs.rename(temporary, destination)
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}
