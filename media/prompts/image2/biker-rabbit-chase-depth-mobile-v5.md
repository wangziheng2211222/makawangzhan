# 机车兔追小偷首帧：小偷前景，机车兔远景

Use case: precise-object-edit
Asset type: localized inpainting edit of a 9:16 mobile video first frame

Image 1 is the sole edit target and the sole source of truth. Preserve the current story direction: the dark-gray cloaked thief is running in front, close to the camera, while the pink motorcycle rider is behind and chasing the thief along the same road.

Make exactly one spatial correction: move the pink motorcycle rider together with the complete motorcycle farther away from the camera, deeper along the same cobblestone road toward the bridge. The rider and motorcycle must become visibly smaller according to natural perspective, while remaining clearly recognizable as the pursuer. Create a long, readable stretch of empty road between the foreground thief and the pursuing motorcycle rider.

The thief is already correct. Freeze the thief exactly as shown in Image 1: identical foreground pixel position, scale, running pose, direction, cloak, hood, two eyes, sack, limbs, material, lighting, and attached ground shadow. Do not move, shrink, rotate, redraw, or blur the thief.

Treat the rider relocation as two localized inpainting regions only:
1. Remove the rider, motorcycle, and their old shadows from the current near-camera position, then reconstruct the continuous cobblestone road, curb, and original lighting from the surrounding pixels.
2. Insert the same complete rider and motorcycle farther up the same road in the midground, behind the thief. Scale the entire rider-and-motorcycle group down consistently with perspective. Preserve the rider's exact identity, face, expression, pink rabbit ears, body proportions, limbs, bandaged leg, pose, plush material, motorcycle design, handlebars, headlight, wheels, colors, and one physically correct attached shadow.

Every pixel outside those two rider-relocation regions must remain visually identical to Image 1. Freeze the exact camera and framing; foreground thief; bridge; river; shoreline; buildings; stalls; awnings; fruit; lamps; sky; clouds; road geometry; depth; colors; textures; reflections; and lighting. Keep both full rabbit ears and both motorcycle wheels visible.

The depth order must be unmistakable: camera -> large foreground thief -> clear empty road gap -> smaller midground motorcycle rider -> bridge and town background. The motorcycle rider is chasing the thief, not riding beside or ahead of the thief.

Output: native 9:16 vertical 2K image. No text, logo, watermark, border, or UI.

Avoid: whole-image redraw; camera change; recomposition; moved or resized thief; changed thief; motorcycle in front of thief; rider beside thief; rider facing the wrong direction; changed rider identity; changed motorcycle; duplicate rider; duplicate motorcycle; ghost objects; leftover old rider or old shadows; changed architecture; changed river; changed lighting; changed color grade; smear; morphing; new props; new residents; extra limbs; fingers; human anatomy; cropped ears; cropped wheels; blur; motion blur.
