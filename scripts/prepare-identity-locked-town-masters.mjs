import fs from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

const targetRoot = path.resolve('.maka-media/targets/sharp-town-v2')
const boundaryRoot = path.resolve('.maka-media/boundaries/1080p')
const outputRoot = path.resolve('.maka-media/masters/identity-locked-town')

const formats = {
  desktop: {
    width: 3840,
    height: 2160,
    townWidth: 1000,
    townTop: 700,
  },
  mobile: {
    width: 2160,
    height: 3840,
    townWidth: 1550,
    townTop: 1300,
  },
}

await fs.mkdir(outputRoot, { recursive: true })

async function contractAlpha(input, iterations) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const pixelCount = info.width * info.height
  let alpha = new Uint8Array(pixelCount)

  for (let index = 0; index < pixelCount; index += 1) {
    alpha[index] = data[index * info.channels + 3]
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = alpha.slice()
    for (let y = 1; y < info.height - 1; y += 1) {
      for (let x = 1; x < info.width - 1; x += 1) {
        const index = y * info.width + x
        if (alpha[index] === 0) continue
        if (
          alpha[index - 1] === 0
          || alpha[index + 1] === 0
          || alpha[index - info.width] === 0
          || alpha[index + info.width] === 0
        ) next[index] = 0
      }
    }
    alpha = next
  }

  for (let index = 0; index < pixelCount; index += 1) {
    data[index * info.channels + 3] = alpha[index]
  }

  return sharp(data, { raw: info }).png().toBuffer()
}

for (const [format, config] of Object.entries(formats)) {
  const background = await sharp(path.join(boundaryRoot, format, 'dive-town-first.png'))
    .resize(config.width, config.height, { fit: 'cover' })
    .blur(42)
    .modulate({ saturation: 0.3 })
    .png()
    .toBuffer()

  const townSource = await sharp(path.join(targetRoot, `${format}-town-cutout.webp`))
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: config.townWidth })
    .sharpen({ sigma: 0.8, flat: 0.4, jagged: 1.2 })
    .png()
    .toBuffer()
  const town = await contractAlpha(townSource, 2)

  const townMetadata = await sharp(town).metadata()
  const output = path.join(outputRoot, `${format}.png`)

  await sharp(background)
    .composite([{
      input: town,
      left: Math.round((config.width - townMetadata.width) / 2),
      top: config.townTop,
    }])
    .png({ compressionLevel: 6 })
    .toFile(output)

  console.log(`Wrote ${output}`)
}
