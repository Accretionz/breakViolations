/**
 * A tiny, dependency-free PDF writer: one page, Helvetica text, lines, grayscale JPEGs and 1-bit masks.
 * Enough to render the meal-break waiver form without pulling in a PDF library.
 * Coordinates are PDF points (1/72 inch) with the origin at the BOTTOM-left of the page.
 */

export type FontName = "regular" | "bold";

// Character widths (1/1000 em) for ASCII 32-126, from the standard Helvetica AFM files.
// prettier-ignore
const HELVETICA = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
// prettier-ignore
const HELVETICA_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/** Unicode characters outside ASCII that WinAnsi (the font's encoding) can show. */
const WIN_ANSI_EXTRA: Record<string, { code: number; regular: number; bold: number }> = {
  "’": { code: 0x92, regular: 222, bold: 278 }, // ’
  "•": { code: 0x95, regular: 350, bold: 350 }, // •
  "–": { code: 0x96, regular: 556, bold: 556 }, // –
};

function charWidth(ch: string, font: FontName): number {
  const extra = WIN_ANSI_EXTRA[ch];
  if (extra) return font === "bold" ? extra.bold : extra.regular;
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return (font === "bold" ? HELVETICA_BOLD : HELVETICA)[code - 32];
  return 556; // accented letters etc. — close enough for layout
}

export function textWidth(text: string, font: FontName, size: number): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch, font);
  return (w * size) / 1000;
}

/** Split text into lines that fit within maxWidth. */
export function wrapText(text: string, font: FontName, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && textWidth(candidate, font, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Encode text as a PDF string literal in WinAnsi; unsupported characters become "?". */
function pdfString(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const extra = WIN_ANSI_EXTRA[ch];
    let code = extra ? extra.code : ch.charCodeAt(0);
    if (!extra && (code > 255 || code < 32 || (code >= 127 && code < 160))) code = 63; // "?"
    const c = String.fromCharCode(code);
    out += c === "(" || c === ")" || c === "\\" ? `\\${c}` : c;
  }
  return `(${out})`;
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();

export interface JpegImage {
  bytes: Uint8Array;
  widthPx: number;
  heightPx: number;
}

/** 1-bit stencil (e.g. a signature): rows padded to whole bytes, bit 0 = ink, 1 = transparent. */
export interface ImageMask {
  bits: Uint8Array;
  widthPx: number;
  heightPx: number;
}

export class SimplePdfPage {
  readonly width: number;
  readonly height: number;
  private ops: string[] = [];
  private images: { dict: string; bytes: Uint8Array }[] = [];
  /** Document properties (Title, Keywords...). Keywords are used to tag waivers as blank/signed. */
  info: Record<string, string> = {};

  constructor(width = 612, height = 792) {
    this.width = width;
    this.height = height;
  }

  text(text: string, x: number, y: number, size: number, font: FontName = "regular") {
    const f = font === "bold" ? "/F2" : "/F1";
    this.ops.push(`BT ${f} ${num(size)} Tf ${num(x)} ${num(y)} Td ${pdfString(text)} Tj ET`);
  }

  centeredText(text: string, y: number, size: number, font: FontName = "regular") {
    this.text(text, (this.width - textWidth(text, font, size)) / 2, y, size, font);
  }

  line(x1: number, y1: number, x2: number, y2: number, thickness = 0.75) {
    this.ops.push(`${num(thickness)} w ${num(x1)} ${num(y1)} m ${num(x2)} ${num(y2)} l S`);
  }

  /** Draw a grayscale JPEG with its bottom-left corner at x, y. */
  drawImage(img: JpegImage, x: number, y: number, w: number, h: number) {
    const name = this.addImage(
      `/Width ${img.widthPx} /Height ${img.heightPx} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /DCTDecode`,
      img.bytes,
    );
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /${name} Do Q`);
  }

  /** Paint a 1-bit stencil (only the "ink" pixels) in the given RGB color (0-1 each). */
  drawMask(mask: ImageMask, x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
    const name = this.addImage(`/Width ${mask.widthPx} /Height ${mask.heightPx} /ImageMask true /BitsPerComponent 1`, mask.bits);
    this.ops.push(`q ${rgb.map(num).join(" ")} rg ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(y)} cm /${name} Do Q`);
  }

  private addImage(dict: string, bytes: Uint8Array): string {
    this.images.push({ dict, bytes });
    return `Im${this.images.length}`;
  }

  toBytes(): Uint8Array<ArrayBuffer> {
    const content = this.ops.join("\n");
    // Images are objects 7, 8, ...
    const xobjects = this.images.length
      ? ` /XObject << ${this.images.map((_, i) => `/Im${i + 1} ${7 + i} 0 R`).join(" ")} >>`
      : "";
    const objects: (string | Uint8Array)[][] = [
      ["<< /Type /Catalog /Pages 2 0 R >>"],
      ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
      [
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(this.width)} ${num(this.height)}] ` +
          `/Resources << /Font << /F1 5 0 R /F2 6 0 R >>${xobjects} >> ` +
          "/Contents 4 0 R >>",
      ],
      [`<< /Length ${latin1(content).length} >>\nstream\n`, content, "\nendstream"],
      ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"],
      ["<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"],
    ];
    for (const img of this.images) {
      objects.push([
        `<< /Type /XObject /Subtype /Image ${img.dict} /Length ${img.bytes.length} >>\nstream\n`,
        img.bytes,
        "\nendstream",
      ]);
    }
    const infoEntries = Object.entries(this.info);
    if (infoEntries.length) {
      objects.push([`<< ${infoEntries.map(([k, v]) => `/${k} ${pdfString(v)}`).join(" ")} >>`]);
    }
    const infoRef = infoEntries.length ? ` /Info ${objects.length} 0 R` : "";

    const chunks: Uint8Array[] = [];
    let offset = 0;
    const push = (part: string | Uint8Array) => {
      const bytes = typeof part === "string" ? latin1(part) : part;
      chunks.push(bytes);
      offset += bytes.length;
    };

    push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    const offsets: number[] = [];
    objects.forEach((parts, i) => {
      offsets.push(offset);
      push(`${i + 1} 0 obj\n`);
      parts.forEach(push);
      push("\nendobj\n");
    });
    const xrefStart = offset;
    push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    offsets.forEach((o) => push(`${String(o).padStart(10, "0")} 00000 n \n`));
    push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${infoRef} >>\nstartxref\n${xrefStart}\n%%EOF\n`);

    const out = new Uint8Array(offset);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return latin1(bin);
}
