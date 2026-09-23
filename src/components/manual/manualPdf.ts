import type { BrickModel } from "@/lib/model/schema";
import type { BuildStep } from "@/lib/steps/steps";
import { manualPages, type CalloutItem } from "@/lib/manual/pages";
import { renderPartIcon, renderStep, STEP_SIZE } from "./stepRenderer";

/**
 * Builds the instruction manual as a PDF: one A4-landscape page per build step,
 * laid out like the on-screen page (design units are px on a 980-wide page,
 * converted to mm). Step renders come from the same cache as the Manual tab and
 * are embedded as transparent PNGs.
 */

const PAGE_W = 297;
const PAGE_H = 210;
const U = PAGE_W / 980; // mm per design px
const PT_PER_MM = 72 / 25.4;

const CREAM = "#fdf7ea";
const PANEL = "#f8ecd2";
const PANEL_LINE = "#eedcb4";
const CALLOUT = "#e2e7ec";
const INK = "#2a2622";
const FOOT = "#6d6252";
const ACCENT = "#dd4b25";

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/**
 * Step render with a soft floor shadow, kept on a transparent background (PNG)
 * so it blends into the panel with no visible box around it.
 */
async function stepPng(url: string): Promise<Uint8Array> {
  const img = await loadImage(url);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d")!;
  const cx = c.width / 2, cy = c.height * 0.9, rx = c.width * 0.31, ry = c.height * 0.035;
  const grad = g.createRadialGradient(cx, cy, 0, cx, cy, rx);
  grad.addColorStop(0, "rgba(90,60,20,0.22)");
  grad.addColorStop(1, "rgba(90,60,20,0)");
  g.save();
  g.translate(cx, cy);
  g.scale(1, ry / rx);
  g.translate(-cx, -cy);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, rx, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.drawImage(img, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
  if (!blob) throw new Error("Couldn't encode the step image");
  return new Uint8Array(await blob.arrayBuffer());
}

async function iconPng(url: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(url)).arrayBuffer());
}

export async function buildManualPdf(model: BrickModel, steps: BuildStep[], onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const pages = manualPages(model, steps);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: `${model.name} – building instructions`, subject: model.description, creator: "BrickForge" });

  const iconCache = new Map<string, { data: Uint8Array; w: number; h: number }>();
  const pad = PAGE_W * 0.034;
  const footerH = 12;
  const panel = { x: pad, y: pad, w: PAGE_W - 2 * pad, h: PAGE_H - pad - footerH };

  for (const [i, page] of pages.entries()) {
    onProgress?.(i, pages.length);
    if (i > 0) doc.addPage("a4", "landscape");

    // Page and panel
    doc.setFillColor(CREAM);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");
    doc.setFillColor(PANEL);
    doc.setDrawColor(PANEL_LINE);
    doc.setLineWidth(0.3);
    doc.roundedRect(panel.x, panel.y, panel.w, panel.h, 14 * U, 14 * U, "FD");

    // Render (drawn first so the callout and step number sit on top of it)
    const url = await renderStep(model, steps, page.n);
    const area = { x: panel.x + panel.w * 0.27, y: panel.y + panel.h * 0.04, w: panel.w * 0.69, h: panel.h * 0.9 };
    const aspect = STEP_SIZE.w / STEP_SIZE.h;
    const iw = Math.min(area.w, area.h * aspect), ih = iw / aspect;
    doc.addImage(await stepPng(url), "PNG", area.x + (area.w - iw) / 2, area.y + (area.h - ih) / 2, iw, ih, `step${page.n}`, "FAST");

    // Step number
    doc.setTextColor(INK);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(56 * U * PT_PER_MM * 0.95);
    doc.text(String(page.n), panel.x + 18 * U, panel.y + 10 * U, { baseline: "top" });

    // Parts callout: 2 columns of icon + "qty× size"
    const items: { c: CalloutItem; icon: { data: Uint8Array; w: number; h: number }; iw: number; ih: number; qty: string; qtyW: number; colW: number }[] = [];
    for (const c of page.callout) {
      const key = `${c.part}|${c.color}`;
      let icon = iconCache.get(key);
      if (!icon) {
        const r = await renderPartIcon(c.part, c.color);
        icon = { data: await iconPng(r.url), w: r.w, h: r.h };
        iconCache.set(key, icon);
      }
      const ih2 = Math.min(icon.h, 48) * U;
      const iw2 = ih2 * (icon.w / icon.h);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14 * U * PT_PER_MM);
      const qty = `${c.qty}×`;
      const qtyW = doc.getTextWidth(qty);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10 * U * PT_PER_MM);
      const labelW = qtyW + 5 * U + doc.getTextWidth(c.size);
      items.push({ c, icon, iw: iw2, ih: ih2, qty, qtyW, colW: Math.max(iw2, labelW) });
    }
    const cols = 2, gapX = 20 * U, gapY = 14 * U, padC = 14 * U, slotH = 48 * U, labelH = 5;
    const colW = [0, 1].map((k) => Math.max(0, ...items.filter((_, j) => j % cols === k).map((it) => it.colW)));
    const rows = Math.ceil(items.length / cols);
    const boxW = padC * 2 + colW[0] + (items.length > 1 ? gapX + colW[1] : 0);
    const boxH = padC * 2 + rows * (slotH + labelH) + (rows - 1) * gapY;
    const bx = panel.x + 18 * U, by = panel.y + 82 * U;
    doc.setFillColor(CALLOUT);
    doc.roundedRect(bx, by, boxW, boxH, 10 * U, 10 * U, "F");
    items.forEach((it, j) => {
      const col = j % cols, row = Math.floor(j / cols);
      const x = bx + padC + (col === 0 ? 0 : colW[0] + gapX);
      const y = by + padC + row * (slotH + labelH + gapY);
      doc.addImage(it.icon.data, "PNG", x, y + slotH - it.ih, it.iw, it.ih, `icon-${it.c.part}-${it.c.color}`, "FAST");
      doc.setTextColor(INK);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14 * U * PT_PER_MM);
      doc.text(it.qty, x, y + slotH + labelH - 1);
      doc.setTextColor("#4b4f55");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10 * U * PT_PER_MM);
      doc.text(it.c.size, x + it.qtyW + 5 * U, y + slotH + labelH - 1);
    });

    // Footer: breadcrumb left, page count right
    const fy = panel.y + panel.h + 7.2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12 * U * PT_PER_MM);
    doc.setTextColor(FOOT);
    doc.text(`${model.name}  ·  Layer ${page.layer} of ${page.layers}`, panel.x + 1, fy);
    const total = ` / ${pages.length}`;
    const totalW = doc.getTextWidth(total);
    doc.text(total, panel.x + panel.w - 1 - totalW, fy);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14 * U * PT_PER_MM);
    doc.setTextColor(INK);
    doc.text(String(page.n), panel.x + panel.w - 1 - totalW, fy, { align: "right" });

    // Progress line
    doc.setFillColor(ACCENT);
    doc.rect(0, PAGE_H - 3 * U, PAGE_W * (page.n / pages.length), 3 * U, "F");
  }
  onProgress?.(pages.length, pages.length);
  return doc.output("blob");
}
