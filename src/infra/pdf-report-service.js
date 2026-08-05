import PDFDocument from "pdfkit";
import { registerPdfFonts, resolveBundledPdfFonts, setPdfFont } from "./pdf-font-service.js";

export function createPdfReportService({
  now = () => new Date().toISOString(),
  fontConfig = resolveBundledPdfFonts()
} = {}) {
  async function render({ title, markdown }) {
    return renderPdf({ title, fontConfig, draw: (doc) => {
      renderHeader(doc, title, now());
      renderMarkdownDocument(doc, markdown, title);
      renderFooters(doc, "VentureLens BP 核查");
    } });
  }

  async function renderConversation(conversation) {
    const title = conversation?.title || "VentureLens 完整对话";
    return renderPdf({ title, fontConfig, draw: (doc) => {
      renderConversationHeader(doc, conversation, now());
      renderConversationRequest(doc, conversation);
      renderStageSummary(doc, conversation.stages);
      if (conversation.report) renderConversationReport(doc, conversation);
      if (conversation.evidenceRefresh?.report) renderEvidenceRefresh(doc, conversation.evidenceRefresh);
      for (const message of conversation.messages || []) renderConversationMessage(doc, message);
      renderFooters(doc, "VentureLens 完整对话");
    } });
  }

  return { render, renderConversation };
}

function renderPdf({ title, fontConfig, draw }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", bufferPages: true, margins: { top: 54, bottom: 54, left: 58, right: 58 }, info: { Title: title } });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    registerPdfFonts(doc, fontConfig);
    setPdfFont(doc, { role: "body" });
    draw(doc);
    doc.end();
  });
}

function renderConversationHeader(doc, conversation, generatedAt) {
  setPdfFont(doc, { role: "sans", bold: true });
  doc.fillColor("#b9573d").fontSize(8.5).text("VENTURELENS · CONVERSATION EXPORT", { characterSpacing: 1.1 });
  doc.moveDown(0.65).fillColor("#20201d").fontSize(21).text(conversation.title, { lineGap: 4 });
  setPdfFont(doc, { role: "sans" });
  doc.moveDown(0.35).fillColor("#76736d").fontSize(8.5).text(
    `${conversation.taskType === "company_pre_research" ? "公司预研" : "附件核查"} · ${statusText(conversation.status)} · 导出于 ${formatDate(generatedAt)}`
  );
  doc.moveDown(1.1);
}

function renderConversationRequest(doc, conversation) {
  renderRoleLabel(doc, "你", "你的请求");
  const lines = [
    conversation.companyName,
    conversation.request?.instruction || "",
    conversation.request?.attachment ? `附件 · ${conversation.request.attachment.filename}${formatFileSize(conversation.request.attachment.size)}` : "公司预研 · 公开信息"
  ].filter(Boolean);
  renderBubble(doc, lines.join("\n"), { fill: "#e9e5dd", textColor: "#33332f", widthRatio: 0.78 });
  doc.moveDown(1.15);
}

function renderStageSummary(doc, stages = []) {
  if (!stages.length) return;
  renderRoleLabel(doc, "VL", "研究代理");
  ensureSpace(doc, 70);
  const left = doc.page.margins.left + 31;
  const width = pageContentWidth(doc) - 31;
  const top = doc.y;
  const completed = stages.filter((stage) => ["completed", "restored"].includes(stage.status)).length;
  doc.save().roundedRect(left, top, width, 38, 8).fillAndStroke("#fffefb", "#dedad1").restore();
  setPdfFont(doc, { role: "sans", bold: true });
  doc.fillColor("#20201d").fontSize(10.5).text("研究执行记录", left + 13, top + 10, { width: width - 100 });
  setPdfFont(doc, { role: "sans" });
  doc.fillColor("#417a62").fontSize(8).text(`${completed}/${stages.length} 阶段完成`, left + width - 90, top + 12, { width: 75, align: "right" });
  doc.x = doc.page.margins.left;
  doc.y = top + 38;
  doc.moveDown(1.1);
}

function renderConversationReport(doc, conversation) {
  renderRoleLabel(doc, "VL", conversation.reportLabel || "研究报告");
  ensureSpace(doc, 72);
  const left = doc.page.margins.left + 31;
  const width = pageContentWidth(doc) - 31;
  const top = doc.y;
  doc.save().roundedRect(left, top, width, 46, 8).fillAndStroke("#f2eee7", "#dedad1").restore();
  setPdfFont(doc, { role: "sans", bold: true });
  doc.fillColor("#b9573d").fontSize(7.5).text(
    conversation.taskType === "company_pre_research" ? "COMPANY RESEARCH REPORT" : "BP REVIEW REPORT",
    left + 14,
    top + 9,
    { characterSpacing: 0.8 }
  );
  doc.fillColor("#20201d").fontSize(12).text(conversation.reportLabel || "研究报告", left + 14, top + 24);
  if (conversation.quality?.score !== undefined) {
    setPdfFont(doc, { role: "sans" });
    doc.fillColor(conversation.quality.ok === false ? "#8f3e2a" : "#417a62").fontSize(8.5)
      .text(`质量 ${conversation.quality.score}`, left + width - 80, top + 18, { width: 62, align: "right" });
  }
  doc.x = doc.page.margins.left;
  doc.y = top + 55;
  renderMarkdownDocument(doc, conversation.report, "");
  doc.moveDown(0.9);
}

function renderEvidenceRefresh(doc, refresh) {
  renderRoleLabel(doc, "VL", refresh.title || "公开资料刷新");
  ensureSpace(doc, 56);
  const left = doc.page.margins.left + 31;
  doc.save().rect(left, doc.y, 4, 30).fill("#b9573d").restore();
  doc.x = left + 13;
  doc.y += 3;
  renderMarkdownDocument(doc, refresh.report, "");
  doc.x = doc.page.margins.left;
  doc.moveDown(0.9);
}

function renderConversationMessage(doc, message) {
  if (message.role === "user") {
    renderRoleLabel(doc, "你", "你的追问", message.at);
    renderBubble(doc, message.content, { fill: "#e9e5dd", textColor: "#33332f", widthRatio: 0.78 });
  } else {
    renderRoleLabel(doc, "VL", "研究代理", message.at);
    ensureSpace(doc, 46);
    const left = doc.page.margins.left + 31;
    doc.save().rect(left, doc.y, 3, 28).fill("#b9573d").restore();
    doc.x = left + 13;
    renderMarkdownDocument(doc, message.content, "");
    doc.x = doc.page.margins.left;
  }
  doc.moveDown(1.05);
}

function renderRoleLabel(doc, avatar, label, at = "") {
  ensureSpace(doc, 38);
  const top = doc.y;
  doc.save().roundedRect(doc.page.margins.left, top, 24, 24, 6).fill("#20201d").restore();
  setPdfFont(doc, { role: "sans", bold: true });
  doc.fillColor("#ffffff").fontSize(7.5).text(avatar, doc.page.margins.left, top + 7, { width: 24, align: "center" });
  doc.fillColor("#76736d").fontSize(8).text(label, doc.page.margins.left + 33, top + 7, { characterSpacing: 0.7 });
  if (at) {
    setPdfFont(doc, { role: "sans" });
    doc.fillColor("#99958e").fontSize(7).text(formatDate(at), doc.page.width - doc.page.margins.right - 130, top + 7, { width: 130, align: "right" });
  }
  doc.x = doc.page.margins.left;
  doc.y = top + 33;
}

function renderBubble(doc, text, { fill, textColor, widthRatio }) {
  const left = doc.page.margins.left + 33;
  const width = pageContentWidth(doc) * widthRatio;
  setPdfFont(doc, { role: "body" });
  doc.fontSize(9.6);
  const height = doc.heightOfString(cleanMarkdown(text), { width: width - 24, lineGap: 4 }) + 20;
  if (height > doc.page.height - doc.page.margins.top - doc.page.margins.bottom) {
    doc.save().rect(left, doc.y, 3, 28).fill("#b7afa4").restore();
    doc.fillColor(textColor).text(cleanMarkdown(text), left + 12, doc.y, { width: width - 24, lineGap: 4 });
    doc.x = doc.page.margins.left;
    return;
  }
  ensureSpace(doc, height + 8);
  const top = doc.y;
  doc.save().roundedRect(left, top, width, height, 5).fill(fill).restore();
  doc.fillColor(textColor).text(cleanMarkdown(text), left + 12, top + 10, { width: width - 24, lineGap: 4 });
  doc.x = doc.page.margins.left;
  doc.y = top + height;
}

function pageContentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right;
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
  const ordered = line.match(/^\d+[.)]\s+(.+)$/);
  if (ordered) {
    setPdfFont(doc, { role: "body" });
    doc.fillColor("#303946").fontSize(9.6).text(`${line.match(/^\d+/)[0]}.  ${cleanMarkdown(ordered[1])}`, { indent: 10, lineGap: 3 });
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

function renderFooters(doc, label = "VentureLens") {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    setPdfFont(doc, { role: "sans" });
    doc.fillColor("#9ca3af").fontSize(8).text(
      `${label}  ·  ${index + 1} / ${range.count}`,
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

function statusText(status) {
  return ({ queued: "排队中", running: "进行中", completed: "已完成", needs_attention: "需关注", failed: "失败" })[status] || status || "未知状态";
}

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024) return ` · ${bytes} B`;
  if (bytes < 1024 * 1024) return ` · ${(bytes / 1024).toFixed(1)} KB`;
  return ` · ${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
