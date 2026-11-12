/**
 * "Match my logo colors" (Store Themes): the main colours of the owner's logo, read in their own
 * browser from the image they chose. Only the resulting hex values go to the server, never the
 * picture, so no image is sent to the AI.
 *
 * `dominantColours` is pure (pixels in, colours out) so it can be tested on its own; `logoColours`
 * draws a file or an image onto a small canvas to get the pixels.
 */

const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/** Up to `max` clearly different colours, most common first, from RGBA pixel data. Transparent pixels are ignored. */
export function dominantColours(pixels: ArrayLike<number>, max = 4): string[] {
  const buckets = new Map<number, { count: number; sum: [number, number, number] }>()
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key) ?? { count: 0, sum: [0, 0, 0] }
    bucket.count += 1
    bucket.sum[0] += r
    bucket.sum[1] += g
    bucket.sum[2] += b
    buckets.set(key, bucket)
  }
  const ranked = [...buckets.values()]
    .sort((x, y) => y.count - x.count)
    .map((b) => b.sum.map((s) => Math.round(s / b.count)))
  const picked: number[][] = []
  for (const colour of ranked) {
    if (picked.every((p) => distance(p, colour) > 48)) picked.push(colour)
    if (picked.length === max) break
  }
  return picked.map(([r, g, b]) => toHex(r, g, b))
}

/** The main colours of an image file or an already loaded image; empty if the browser cannot read it. */
export async function logoColours(source: Blob | HTMLImageElement): Promise<string[]> {
  try {
    const bitmap = source instanceof Blob ? await createImageBitmap(source) : source
    const canvas = document.createElement('canvas')
    canvas.width = 48
    canvas.height = 48
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return []
    ctx.drawImage(bitmap, 0, 0, 48, 48)
    return dominantColours(ctx.getImageData(0, 0, 48, 48).data)
  } catch {
    // A picture from another site that does not allow reading (a tainted canvas), or not an image.
    return []
  }
}
