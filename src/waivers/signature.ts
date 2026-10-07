import type { ImageMask } from "./simplePdf.ts";

/**
 * Turn a drawn signature (RGBA pixels from a transparent canvas) into a 1-bit PDF mask,
 * cropped to the ink with a little padding. Returns null if nothing was drawn.
 */
export function signatureToMask(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): ImageMask | null {
  const inkAt = (x: number, y: number) => rgba[(y * width + x) * 4 + 3] >= 96;

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (inkAt(x, y)) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;

  const pad = 4;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const rowBytes = Math.ceil(w / 8);
  const bits = new Uint8Array(rowBytes * h).fill(0xff); // 1 = transparent
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (inkAt(minX + x, minY + y)) bits[y * rowBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  }
  return { bits, widthPx: w, heightPx: h };
}
