# Visual style example assets

Generated 2026-09-03 with the built-in `image_gen` tool. Six independent prompts produce representative style images of the same general subject. These are built-in style examples, not customer-uploaded references or project production outputs. The motion-graphics image is a still keyframe, not a motion preview.

## Delivery

- Website files: `apps/task-entry-web/public/style-previews/<id>-v1.jpg`.
- Each delivery image is 960 × 540, JPEG quality 87, made from the generated PNG solely by resizing and encoding. Total is approximately 700 KB.
- Original generated PNGs are preserved in the tool output folder and locally copied to ignored `artifacts/style-preview-originals/`; originals are not needed to run the website.
- Asset URLs are supplied by the server for the six stable built-in IDs. The client does not infer URLs from labels or concatenate arbitrary option IDs.
- No database migration or rewrite of existing choices, labels, sorting or colors. Unknown/custom styles receive no arbitrary built-in image and show the localized unavailable state.
- Vite copies `public/style-previews` into `dist`; existing Windows and Linux release scripts copy the complete customer `dist` into `server/web/customer`.
- This change does not add an administrator image upload/editor. Generated default images are maintained as versioned application assets.

## Exact generation prompts

### cinematic

```text
Use case: photorealistic-natural. Primary request: demonstrate CINEMATIC REALISM. Style: believable live-action movie still, natural human proportions, weathered stone, real foliage and fabric textures, atmospheric distance, warm dawn sunlight over cool mountains, sophisticated film color grading, wide-angle cinematography. Avoid illustration, painting, toy-like 3D and artificial neon. Asset type: production website visual-style selector thumbnail, one standalone landscape image, 16:9 composition (1536 by 864 preferred). Scene: a lone traveler with a small backpack on a curved stone footbridge above a quiet river in a mountain valley, a few village rooftops in the distance. Keep the traveler and bridge legible at thumbnail size, with all important details in the central area. This is a generic illustrative example, not a customer's final generated project. No words, letters, logos, watermark, UI, border, collage, split panels or captions.
```

### storybook

```text
Use case: illustration-story. Primary request: demonstrate STORYBOOK ILLUSTRATION. Style: charming hand-drawn narrative book illustration with expressive ink contours, opaque gouache, textured colored-pencil accents, warm ochre and sage foliage, simplified slightly whimsical traveler and scenery. Clearly illustrated, rich organic storytelling detail, confident shapes. Avoid photorealism, CGI, translucent watercolor washes or generic flat business icons. Asset type: production website visual-style selector thumbnail, one standalone landscape image, 16:9 composition (1536 by 864 preferred). Scene: a lone traveler with a small backpack on a curved stone footbridge above a quiet river in a mountain valley, a few village rooftops in the distance. Keep the traveler and bridge legible at thumbnail size, with all important details in the central area. This is a generic illustrative example, not a customer's final generated project. No words, letters, logos, watermark, UI, border, collage, split panels or captions.
```

### editorial

```text
Use case: stylized-concept. Primary request: demonstrate MINIMAL EDITORIAL illustration. Style: sophisticated printed literary magazine illustration, boldly reduced flat geometric silhouettes, bridge as one simple arch and traveler as a small iconic figure, clean negative space, cream paper background, restricted charcoal, terracotta and muted teal palette. Sparse intelligent composition, subtle risograph grain, completely flat. Avoid realism, 3D, elaborate foliage, gradients or motion trails. Asset type: production website visual-style selector thumbnail, one standalone landscape image, 16:9 composition (1536 by 864 preferred). Scene: a lone traveler with a small backpack on a curved stone footbridge above a quiet river in a mountain valley, a few village rooftops in the distance. Keep the traveler and bridge legible at thumbnail size, with all important details in the central area. This is a generic illustrative example, not a customer's final generated project. No words, letters, logos, watermark, UI, border, collage, split panels or captions.
```

### watercolor

```text
Use case: illustration-story. Primary request: demonstrate WATERCOLOR. Style: luminous traditional transparent watercolor on cold-pressed cotton paper, diluted mineral pigments, visible paper grain, wet-on-wet blooms, soft lost edges, airy pale teal river and mauve distant mountains, warm golden light. Traveler loosely painted but recognizable. Avoid opaque gouache, ink outlines, hard vector edges, photographic detail or CGI. Asset type: production website visual-style selector thumbnail, one standalone landscape image, 16:9 composition (1536 by 864 preferred). Scene: a lone traveler with a small backpack on a curved stone footbridge above a quiet river in a mountain valley, a few village rooftops in the distance. Keep the traveler and bridge legible at thumbnail size, with all important details in the central area. This is a generic illustrative example, not a customer's final generated project. No words, letters, logos, watermark, UI, border, collage, split panels or captions.
```

### animation-3d

```text
Use case: stylized-concept. Primary request: demonstrate 3D ANIMATION. Style: high-quality stylized animated-film still with a friendly original rounded traveler, simplified facial features, convincingly modeled chunky stone bridge and sculpted landscape, tactile matte materials, soft global illumination, dimensional soft shadows and depth of field. Visibly three-dimensional and charming, like an original animated feature, not live action. Avoid named franchises, flat illustration or painterly paper texture. Asset type: production website visual-style selector thumbnail, one standalone landscape image, 16:9 composition (1536 by 864 preferred). Scene: a lone traveler with a small backpack on a curved stone footbridge above a quiet river in a mountain valley, a few village rooftops in the distance. Keep the traveler and bridge legible at thumbnail size, with all important details in the central area. This is a generic illustrative example, not a customer's final generated project. No words, letters, logos, watermark, UI, border, collage, split panels or captions.
```

### motion-graphics

```text
Use case: stylized-concept. Primary request: demonstrate PREMIUM MOTION GRAPHICS as a single representative still keyframe. Reinterpret the scene into a kinetic graphic composition: clean layered geometric mountain shapes and bridge arch, small traveler silhouette, fluid river ribbon, orbiting arcs and offset shape echoes implying motion, precise lines, sophisticated dark ink background with warm amber, coral and turquoise accent shapes. Crisp digital shapes, dynamic diagonal rhythm and controlled depth through overlapping planes. Avoid photorealism, painted landscapes, cartoon 3D characters, dashboards, letters and numbers. Asset type: production website visual-style selector thumbnail, one standalone landscape image, 16:9 composition (1536 by 864 preferred). Scene: a lone traveler with a small backpack on a curved stone footbridge above a quiet river in a mountain valley, a few village rooftops in the distance. Keep the traveler and bridge legible at thumbnail size, with all important details in the central area. This is a generic illustrative example, not a customer's final generated project. No words, letters, logos, watermark, UI, border, collage, split panels or captions.
```
