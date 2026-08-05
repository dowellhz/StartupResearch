import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PDF_FONT_NAMES = Object.freeze({
  sans: "CJK",
  sansBold: "CJK-Bold",
  serif: "CJK-Serif"
});

const FONT_FILES = Object.freeze({
  sans: "SourceHanSansSC-Regular.otf",
  sansBold: "SourceHanSansSC-Bold.otf",
  serif: "SourceHanSerifSC-Regular.otf"
});

const DEFAULT_FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../assets/fonts");

export function resolveBundledPdfFonts({ fontDir = DEFAULT_FONT_DIR, existsSync = fs.existsSync } = {}) {
  const fonts = Object.fromEntries(Object.entries(FONT_FILES).map(([role, filename]) => [role, path.join(fontDir, filename)]));
  return Object.values(fonts).every((fontPath) => existsSync(fontPath)) ? fonts : null;
}

export function registerPdfFonts(doc, fonts) {
  if (!fonts) throw new Error("PDF 固定中文字体缺失，请检查 assets/fonts 中的思源字体文件");
  doc.registerFont(PDF_FONT_NAMES.sans, fonts.sans);
  doc.registerFont(PDF_FONT_NAMES.sansBold, fonts.sansBold);
  doc.registerFont(PDF_FONT_NAMES.serif, fonts.serif);
}

export function setPdfFont(doc, { role = "body", bold = false } = {}) {
  const name = bold ? PDF_FONT_NAMES.sansBold : role === "body" ? PDF_FONT_NAMES.serif : PDF_FONT_NAMES.sans;
  doc.font(name);
  return name;
}
