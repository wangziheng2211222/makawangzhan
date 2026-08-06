import fs from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

const sceneNames = ['jiuka', 'little-devil', 'biker-rabbit', 'pipi']
const sourceDirectory = path.resolve('output/imagegen/scenes')
const destinationDirectory = path.resolve('public/images/scenes')

await fs.mkdir(destinationDirectory, { recursive: true })

await Promise.all(
  sceneNames.flatMap((name) =>
    ['desktop', 'mobile'].map(async (format) => {
      const source = path.join(sourceDirectory, `${name}-environment-${format}-v2.png`)
      const destination = path.join(destinationDirectory, `${name}-environment-${format}.webp`)
      await sharp(source).webp({ quality: 88, effort: 5 }).toFile(destination)
      console.log(`Wrote ${destination}`)
    }),
  ),
)

const townDesktopSource = path.join(sourceDirectory, 'town-hero-purple-candidate-v4.png')
const townMobileSource = path.join(sourceDirectory, 'town-hero-purple-mobile-candidate-v4.png')

await Promise.all([
  sharp(townDesktopSource)
    .webp({ quality: 90, effort: 5 })
    .toFile(path.join(destinationDirectory, 'town-hero-desktop-preview.webp')),
  sharp(townMobileSource)
    .webp({ quality: 90, effort: 5 })
    .toFile(path.join(destinationDirectory, 'town-hero-mobile-preview.webp')),
  sharp(townDesktopSource)
    .resize(1200, 630, { fit: 'cover', position: 'centre' })
    .webp({ quality: 88, effort: 5 })
    .toFile(path.join(destinationDirectory, 'maka-town-social.webp')),
])

console.log('Wrote town preview and social assets')
