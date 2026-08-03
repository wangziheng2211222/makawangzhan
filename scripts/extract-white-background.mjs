import fs from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

const [, , inputPath, outputPath] = process.argv

if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/extract-white-background.mjs <input> <output>')
  process.exit(1)
}

const { data, info } = await sharp(inputPath)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true })

const { width, height, channels } = info
const pixelCount = width * height
const visited = new Uint8Array(pixelCount)
const queue = new Int32Array(pixelCount)
let head = 0
let tail = 0

function isBackground(index) {
  const offset = index * channels
  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  const minimum = Math.min(red, green, blue)
  const maximum = Math.max(red, green, blue)

  return minimum >= 246 && maximum - minimum <= 12
}

function enqueue(index) {
  if (visited[index] || !isBackground(index)) return
  visited[index] = 1
  queue[tail] = index
  tail += 1
}

for (let x = 0; x < width; x += 1) {
  enqueue(x)
  enqueue((height - 1) * width + x)
}

for (let y = 0; y < height; y += 1) {
  enqueue(y * width)
  enqueue(y * width + width - 1)
}

while (head < tail) {
  const index = queue[head]
  head += 1
  const x = index % width
  const y = Math.floor(index / width)

  if (x > 0) enqueue(index - 1)
  if (x + 1 < width) enqueue(index + 1)
  if (y > 0) enqueue(index - width)
  if (y + 1 < height) enqueue(index + width)
}

for (let index = 0; index < pixelCount; index += 1) {
  if (visited[index]) data[index * channels + 3] = 0
}

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await sharp(data, { raw: info })
  .webp({ quality: 94, alphaQuality: 100 })
  .toFile(outputPath)

console.log(`Wrote ${outputPath}`)
