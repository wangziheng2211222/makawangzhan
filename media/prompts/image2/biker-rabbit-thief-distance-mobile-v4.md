# 机车兔首帧：仅移动小偷

Use case: precise-object-edit
Asset type: localized inpainting edit of a 9:16 mobile video first frame

Image 1 is the sole edit target and the sole source of truth. Do not recreate, reinterpret, recompose, restyle, relight, or sharpen the image.

Make exactly one localized change: move the existing dark-gray cloaked toy thief farther away from the pink motorcycle rider, following the same road toward the bridge. Put the same thief in the midground, visibly smaller because of perspective, with a clear stretch of empty road between the thief and motorcycle. Preserve the thief's cloak, two eyes, running silhouette, sack, direction, and material.

Treat this as two small inpainting regions only:
1. At the thief's original foreground position, remove the thief and its old shadow, then reconstruct the exact continuous cobblestone, river edge, water reflection, and lighting already surrounding that location.
2. At the new midground position along the same path, insert the same thief at the correct smaller perspective scale with one physically attached shadow.

Every pixel outside those two small regions must remain visually identical to Image 1. In particular, freeze the exact camera and framing; the pink rider's identity, face, expression, ears, body, limbs, bandage, pose, scale, pixel position, motorcycle, handlebars, wheels, and shadows; the bridge, river, buildings, stalls, awnings, fruit, lamps, sky, clouds, road, depth, colors, textures, and lighting. Preserve the exact quiet lower-road area.

Output: native 9:16 vertical 2K image. No text, logo, watermark, border, or UI.

Avoid: whole-image redraw; camera change; recomposition; moved or resized rider; changed motorcycle; changed architecture; changed river; changed lighting; changed color grade; duplicate thief; ghost thief; leftover old shadow; smear; morphing; new props; new residents; extra limbs; fingers; human anatomy; cropped ears; cropped wheels; blur; motion blur.
