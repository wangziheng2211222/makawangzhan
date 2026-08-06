# 机车兔首帧：拉开小偷距离

Use case: precise-object-edit
Asset type: 9:16 first frame for the Maka Town mobile journey video

Input images:
- Image 1 is the exact edit target and the source of truth for the complete composition, camera, street, river, bridge, buildings, lighting, Gee-too, motorcycle, colors, materials, and all non-target pixels.
- Image 2 is the official Gee-too identity reference. Use it only to protect Gee-too's face, pink plush body, two long ears, two short round arms, two thin legs, two feet, and the single white leg bandage. Do not use it to change the pose or composition in Image 1.

Primary request: change only the thief's position and perspective scale. Move the same small dark-gray cloaked toy thief farther away from Gee-too, forward along the same escape path toward the bridge and the depth of the street. Place the thief clearly in the midground, with substantially more visible road between the thief and the motorcycle. Reduce the thief's apparent size consistently with the existing street perspective, while keeping the same cloak, eyes, running pose, sack, silhouette, and escape direction.

Restore the thief's original foreground location with a seamless continuation of the exact existing cobblestone road, river edge, reflections, shadows, and lighting from Image 1. There must be no ghost, duplicate, smear, cutout edge, or leftover shadow at the old position.

Freeze all invariants from Image 1: Gee-too and the motorcycle must remain pixel-position consistent in identity, pose, scale, limb count, facial expression, bandage location, handlebars, wheels, and shadows. Keep the camera, 9:16 framing, bridge, river, market stalls, awnings, fruit, buildings, lamps, sky, clouds, depth, palette, lighting, and quiet lower road area unchanged. Do not move, resize, redraw, sharpen, restyle, or relight any non-target subject.

Output: native 9:16 vertical 2K image, no text, logo, watermark, border, or UI.

Avoid: a second thief; thief close to the motorcycle; enlarged thief; missing sack; changed escape direction; changed Gee-too; changed motorcycle; extra limbs; fingers; human anatomy; moved bandage; cropped ears; cropped wheels; new props; new residents; altered architecture; altered river; changed camera; changed lighting; changed color grade; blur; motion blur; morphing; duplicated shadows.
