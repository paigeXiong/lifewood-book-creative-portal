import type { ReferenceCategory } from "@lifewood/domain";

export class PhotoError extends Error {
  constructor(public readonly key: "photoFormat" | "photoSize" | "photoUnreadable" | "photoTimeout") { super(key); }
}

async function photoStep<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PhotoError("photoTimeout")), 30_000);
    })]);
  } finally { clearTimeout(timer); }
}

export async function preparePhoto(file: File, category: ReferenceCategory): Promise<File> {
  // Upload valid JPEG/PNG originals directly when they already satisfy the category.
  // A compressed file's byte size says nothing about the RAM needed to decode it.
  // Inspect only the signature here; full file validation still happens on the server.
  if (file.size > 0 && file.size <= category.maxBytes) {
    const header = new Uint8Array(await photoStep(file.slice(0, 8).arrayBuffer()));
    const originalType = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff ? "image/jpeg"
      : [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte) ? "image/png" : undefined;
    if (originalType && category.accept.includes(originalType)) {
      const name = `${file.name.replace(/\.[^.]*$/, "") || "cover"}.${originalType === "image/jpeg" ? "jpg" : "png"}`;
      return new File([file], name, { type: originalType, lastModified: file.lastModified });
    }
  }
  const type = category.accept.includes("image/jpeg") ? "image/jpeg"
    : category.accept.includes("image/png") ? "image/png" : undefined;
  if (!type) throw new PhotoError("photoFormat");
  // Leave room below category/recognition limits, including multi-photo requests.
  const targetBytes = Math.floor(Math.min(2_000_000, category.maxBytes * .9));
  if (!Number.isFinite(targetBytes) || targetBytes < 1) throw new PhotoError("photoSize");
  const url = URL.createObjectURL(file);
  let image: HTMLImageElement | undefined;
  let bitmap: ImageBitmap | undefined;
  let finished = false;
  let canvas: HTMLCanvasElement | undefined;
  try {
    if (typeof createImageBitmap === "function") {
      // Ask the decoder for a smaller bitmap before retaining pixels in JS.
      // Browser implementations may still allocate temporary decode buffers.
      bitmap = await photoStep(createImageBitmap(file, { resizeWidth: 1600, resizeQuality: "high", imageOrientation: "from-image" })
        .then(result => { if (finished) result.close(); return result; })
        .catch(() => { throw new PhotoError("photoUnreadable"); }));
    } else {
    image = new Image();
    const source = image;
    await photoStep(new Promise<void>((resolve, reject) => {
      source.onload = () => resolve();
      source.onerror = () => reject(new PhotoError("photoUnreadable"));
      source.src = url;
    }));
    if (!image.naturalWidth || !image.naturalHeight) throw new PhotoError("photoUnreadable");
    }
    const pixels = bitmap ?? image!;
    const width = bitmap ? bitmap.width : image!.naturalWidth;
    const height = bitmap ? bitmap.height : image!.naturalHeight;
    canvas = document.createElement("canvas");
    const output = canvas;
    const context = canvas.getContext("2d");
    if (!context) throw new PhotoError("photoUnreadable");
    let scale = Math.min(1, 2400 / Math.max(width, height));
    for (let attempt = 0; attempt < 6; attempt++) {
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(pixels, 0, 0, canvas.width, canvas.height);
      // JPEG quality can preserve small printed text before reducing dimensions.
      // PNG ignores quality, so only resizing can reduce its encoded size.
      for (const quality of type === "image/jpeg" ? [.88, .76, .64, .52] : [1]) {
        const blob = await photoStep(new Promise<Blob | null>(resolve => output.toBlob(resolve, type, quality)));
        if (!blob || blob.type !== type || blob.size === 0) throw new PhotoError("photoUnreadable");
        if (blob.size <= targetBytes && blob.size <= category.maxBytes) {
          const base = file.name.replace(/\.[^.]*$/, "") || "cover";
          return new File([blob], `${base}.${type === "image/jpeg" ? "jpg" : "png"}`, { type });
        }
      }
      scale *= .8;
    }
    throw new PhotoError("photoSize");
  } finally {
    finished = true;
    bitmap?.close();
    if (canvas) { canvas.width = 0; canvas.height = 0; }
    if (image) { image.onload = null; image.onerror = null; image.src = ""; }
    URL.revokeObjectURL(url);
  }
}
