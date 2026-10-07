import { LOGO_HEIGHT_PX, LOGO_JPEG_BASE64, LOGO_WIDTH_PX } from "./logo.ts";
import { base64ToBytes, SimplePdfPage, textWidth, wrapText, type FontName, type ImageMask } from "./simplePdf.ts";

/** Printed in the "Store/Department" field on every form. */
export const STORE_DEPARTMENT = "KZST";

/** Wording copied from the company's Meal Break Waiver Agreement. */
export const FORM_TEXT = {
  title: "MEAL BREAK WAIVER AGREEMENT",
  intro: "I agree to waive my meal periods as follows:",
  first: {
    heading: "First Meal Break:",
    bullets: [
      "I understand that I am entitled to an unpaid meal break of not less than 30 minutes on any day that I work more than five (5) hours. However, I understand that I can waive the meal period and work during such time when my total day’s work will be completed within a work period of not more than six (6) hours.",
      "Accordingly, I agree to waive the meal period whenever my total day’s work will be completed within a work period of not more than six (6) hours.",
    ],
  },
  second: {
    heading: "Second Meal Break:",
    bullets: [
      "I understand that I am entitled to a second unpaid meal break of not less than 30 minutes on any day that I work more than ten (10) hours. However, I understand that I can waive the second meal period and work during such time when my total day’s work will be completed within a work period of not more than twelve (12) hours, as long as I did not waive the first meal period.",
      "Accordingly, I agree to waive the second meal period whenever my total day’s work will be completed within a work period of not more than twelve (12) hours, as long as I did not waive the first meal period.",
    ],
  },
  closing:
    "I enter into this agreement freely and voluntarily. I understand that this agreement can be revoked in writing by either me or the Company at any time.",
};

/** Filled in when the form is signed in the app. */
export interface WaiverSignatures {
  employeeSignature?: ImageMask;
  supervisorName?: string;
  supervisorSignature?: ImageMask;
}

export interface WaiverFormData {
  employeeName: string;
  /** The day the meal break was missed, e.g. "10/4/26". Printed next to both signatures. */
  mealBreakDate: string;
  storeDepartment?: string;
  signatures?: WaiverSignatures;
  /** Stored in the PDF's Keywords property (see waiverMeta.ts). */
  keywords?: string;
}

const INK: [number, number, number] = [0.05, 0.12, 0.45]; // blue-black pen

/** Render one filled-in Meal Break Waiver Agreement as PDF bytes (US Letter). */
export function renderWaiverForm({
  employeeName,
  mealBreakDate,
  storeDepartment = STORE_DEPARTMENT,
  signatures = {},
  keywords,
}: WaiverFormData) {
  const page = new SimplePdfPage(612, 792);
  page.info.Title = `Meal Break Waiver - ${employeeName} - ${mealBreakDate}`;
  if (keywords) page.info.Keywords = keywords;
  const left = 72;
  const right = page.width - 72;

  // Logo
  const logoH = 78;
  const logoW = (logoH * LOGO_WIDTH_PX) / LOGO_HEIGHT_PX;
  page.drawImage(
    { bytes: base64ToBytes(LOGO_JPEG_BASE64), widthPx: LOGO_WIDTH_PX, heightPx: LOGO_HEIGHT_PX },
    (page.width - logoW) / 2,
    792 - 36 - logoH,
    logoW,
    logoH,
  );

  let y = 792 - 36 - logoH - 34;
  page.centeredText(FORM_TEXT.title, y, 14, "bold");

  // Fill-in fields: label, underline, and an optional typed value or drawn signature.
  const field = (
    label: string,
    value: string | ImageMask | undefined,
    x: number,
    lineEnd: number,
    font: FontName = "bold",
  ) => {
    page.text(label, x, y, 11, font);
    const start = x + textWidth(label, font, 11) + 6;
    page.line(start, y - 3, lineEnd, y - 3);
    if (typeof value === "string") {
      if (value) page.text(value, start + 6, y + 1, 12);
    } else if (value) {
      const maxW = lineEnd - start - 12;
      const maxH = 34;
      const scale = Math.min(maxW / value.widthPx, maxH / value.heightPx);
      page.drawMask(value, start + 6, y - 2, value.widthPx * scale, value.heightPx * scale, INK);
    }
  };

  y -= 40;
  field("Employee Name:", employeeName, left, right);
  y -= 26;
  field("Store/Department:", storeDepartment, left, right);

  y -= 30;
  page.text(FORM_TEXT.intro, left, y, 11);

  const section = (heading: string, bullets: string[]) => {
    y -= 26;
    page.text(heading, left, y, 11.5, "bold");
    y -= 8;
    for (const bullet of bullets) {
      const lines = wrapText(bullet, "regular", 10.5, right - (left + 32));
      y -= 15;
      page.text("•", left + 18, y, 10.5);
      lines.forEach((line, i) => page.text(line, left + 32, y - i * 14.5, 10.5));
      y -= (lines.length - 1) * 14.5 + 4;
    }
  };
  section(FORM_TEXT.first.heading, FORM_TEXT.first.bullets);
  section(FORM_TEXT.second.heading, FORM_TEXT.second.bullets);

  y -= 30;
  for (const line of wrapText(FORM_TEXT.closing, "regular", 11, right - left)) {
    page.text(line, left, y, 11);
    y -= 15;
  }

  // Signature block — blank for signing on paper, or filled in when signed in the app.
  // Next to each signature: the date of the missed meal break this waiver covers (pre-filled).
  const dateX = 362;
  y -= 34;
  field("Employee’s Signature:", signatures.employeeSignature, left, dateX - 10);
  field("Meal Break Date:", mealBreakDate, dateX, right);
  y -= 40;
  field("Supervisor Name:", signatures.supervisorName, left, right);
  y -= 40;
  field("Supervisor’s Signature:", signatures.supervisorSignature, left, dateX - 10);
  field("Meal Break Date:", mealBreakDate, dateX, right);

  return page.toBytes();
}
