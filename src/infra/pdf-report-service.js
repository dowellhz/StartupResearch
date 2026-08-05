import PDFDocument from "pdfkit";
import { registerPdfFonts, resolveBundledPdfFonts, setPdfFont } from "./pdf-font-service.js";

export function createPdfReportService({
  now = () => new Date().toISOString(),
  fontConfig = resolveBundledPdfFonts()
} = {}) {
  async function render({ title, markdown }) {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: 54, bottom: 54, left: 58, right: 58 }, info: { Title: title } });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      registerPdfFonts(doc, fontConfig);
      setPdfFont(doc, { role: "body" });
      renderHeader(doc, title, now());
      renderMarkdownDocument(doc, markdown, title);
      renderFooters(doc);
      doc.end();
    });
  }

  return { render };
}

function renderMarkdownDocument(doc, markdown, title) {
  const lines = String(markdown || "").split(/\r?\n/);
  let skippedDocumentTitle = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!skippedDocumentTitle && line.trim() === `# ${title}`) {
      skippedDocumentTitle = true;
      continue;
    }
    if (/^\|.*\|$/.test(line.trim())) {
      const tableLines = [];
      while (index < lines.length && /^\|.*\|$/.test(lines[index].trim())) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      index -= 1;
      renderTable(doc, tableLines);
      continue;
    }
    renderLine(doc, line);
  }
}

function renderHeader(doc, title, generatedAt) {
  setPdfFont(doc, { role: "sans", bold: true });
  doc.fillColor("#111827").fontSize(22).text(title, { lineGap: 5 });
  setPdfFont(doc, { role: "sans" });
  doc.moveDown(0.35).fillColor("#6b7280").fontSize(9).text(`VentureLens · 生成于 ${formatDate(generatedAt)}`);
  doc.moveDown(0.6).strokeColor("#d97757").lineWidth(2).moveTo(58, doc.y).lineTo(150, doc.y).stroke();
  doc.moveDown(1.2);
}

function renderLine(doc, raw) {
  const line = String(raw || "").trimEnd();
  if (!line) return void doc.moveDown(0.45);
  const heading = line.match(/^(#{1,3})\s+(.+)$/);
  if (heading) {
    const level = heading[1].length;
    ensureSpace(doc, level === 1 ? 80 : 52);
    setPdfFont(doc, { role: "sans", bold: true });
    doc.moveDown(level === 1 ? 0.8 : 0.55)
      .fillColor(level === 1 ? "#9a432d" : "#1f2937")
      .fontSize(level === 1 ? 19 : level === 2 ? 14 : 11.5)
      .text(cleanMarkdown(heading[2]), { lineGap: 3 });
    return void doc.moveDown(0.35);
  }
  const bullet = line.match(/^[-*+]\s+(.+)$/);
  if (bullet) {
    setPdfFont(doc, { role: "body" });
    doc.fillColor("#303946").fontSize(9.6).text(`•  ${cleanMarkdown(bullet[1])}`, { indent: 10, lineGap: 3 });
    return void doc.moveDown(0.16);
  }
  if (line.startsWith(">")) {
    setPdfFont(doc, { role: "body" });
    doc.fillColor("#6b7280").fontSize(9.2).text(cleanMarkdown(line.slice(1).trim()), { indent: 12, lineGap: 3 });
    return void doc.moveDown(0.25);
  }
  setPdfFont(doc, { role: "body" });
  doc.fillColor("#303946").fontSize(9.8).text(cleanMarkdown(line), { align: "justify", lineGap: 4 });
  doc.moveDown(0.22);
}

function renderTable(doc, tableLines) {
  const rows = tableLines
    .filter((line) => !/^\|?\s*:?-{3,}/.test(line))
    .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cleanMarkdown(cell)));
  if (!rows.length) return;
  const columnCount = Math.max(...rows.map((row) => row.length));
  const left = doc.page.margins.left;
  const totalWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const ratios = columnRatios(columnCount);
  const widths = ratios.map((ratio) => ratio * totalWidth);
  doc.moveDown(0.35);
  rows.forEach((row, rowIndex) => {
    const height = tableRowHeight(doc, row, widths, rowIndex === 0);
    if (doc.y + height > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      if (rowIndex > 0) drawTableRow(doc, rows[0], widths, left, true);
    }
    drawTableRow(doc, row, widths, left, rowIndex === 0);
  });
  doc.moveDown(0.7);
}

function drawTableRow(doc, row, widths, left, header) {
  const height = tableRowHeight(doc, row, widths, header);
  const top = doc.y;
  let x = left;
  widths.forEach((width, index) => {
    doc.save();
    doc.rect(x, top, width, height).fillAndStroke(header ? "#ede8df" : "#fffefb", "#d9d4cb");
    doc.restore();
    setPdfFont(doc, { role: "sans", bold: header });
    doc.fillColor(header ? "#20201d" : "#3f3e39")
      .fontSize(header ? 7.1 : 6.8)
      .text(row[index] || "", x + 4, top + 4, { width: width - 8, height: height - 8, lineGap: 1, ellipsis: true });
    x += width;
  });
  doc.y = top + height;
  doc.x = left;
}

function tableRowHeight(doc, row, widths, header) {
  setPdfFont(doc, { role: "sans", bold: header });
  doc.fontSize(header ? 7.1 : 6.8);
  return Math.max(20, ...widths.map((width, index) => (
    doc.heightOfString(row[index] || "", { width: width - 8, lineGap: 1 }) + 8
  )));
}

function columnRatios(count) {
  if (count === 6) return [0.17, 0.15, 0.16, 0.13, 0.1, 0.29];
  if (count === 5) return [0.22, 0.2, 0.2, 0.14, 0.24];
  return Array.from({ length: count }, () => 1 / count);
}

function ensureSpace(doc, points) {
  if (doc.y + points > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function renderFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    setPdfFont(doc, { role: "sans" });
    doc.fillColor("#9ca3af").fontSize(8).text(
      `VentureLens BP 核查  ·  ${index + 1} / ${range.count}`,
      58,
      doc.page.height - 30,
      { width: doc.page.width - 116, align: "center", lineBreak: false }
    );
    doc.page.margins.bottom = originalBottomMargin;
  }
}

function cleanMarkdown(value) {
  return String(value || "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 ($2)")
    .replace(/[*_`]/g, "")
    .trim();
}

function formatDate(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value));
  } catch {
    return String(value || "");
  }
}
