"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BrickModel } from "@/lib/model/schema";
import type { BuildStep } from "@/lib/steps/steps";
import { manualPages, type CalloutItem, type ManualPage } from "@/lib/manual/pages";
import { peekStep, renderPartIcon, renderStep, STEP_SIZE, THUMB_SIZE, type PartIcon } from "./manual/stepRenderer";
import { exportFileNames } from "@/lib/ldraw/export";
import * as I from "./icons";

const ZOOMS = [0.6, 0.8, 1, 1.25, 1.5] as const;
/** Width/height of a manual page (A4 landscape is 1.414). */
export const PAGE_RATIO = 1.42;
/** Design reference width in px; page type is sized relative to it. */
const DESIGN_W = 980;

function useStepImage(model: BrickModel, steps: BuildStep[], n: number, size: { w: number; h: number }, priority: "high" | "low", enabled = true) {
  const [state, setState] = useState<{ key: string; url: string } | null>(null);
  const key = `${n}|${size.w}`;
  // A cached render is used on the very first paint of a page, with no loading flash.
  const cached = peekStep(model, n, size);
  useEffect(() => {
    if (!enabled || cached) return;
    let live = true;
    renderStep(model, steps, n, size, priority).then((u) => live && setState({ key, url: u }), () => {});
    return () => {
      live = false;
    };
  }, [model, steps, n, size, priority, enabled, cached, key]);
  return cached ?? (state?.key === key ? state.url : null);
}

function CalloutPart({ item }: { item: CalloutItem }) {
  const [icon, setIcon] = useState<PartIcon | null>(null);
  useEffect(() => {
    let live = true;
    renderPartIcon(item.part, item.color).then((i) => live && setIcon(i), () => {});
    return () => {
      live = false;
    };
  }, [item.part, item.color]);
  const cq = (px: number) => `${(px / DESIGN_W) * 100}cqw`;
  return (
    <div className="man-callout-item" title={`${item.qty}× ${item.name}, ${item.colorName}`}>
      <div className="man-icon-slot">{icon && <img src={icon.url} alt={`${item.name}, ${item.colorName}`} style={{ height: cq(Math.min(icon.h, 48)) }} />}</div>
      <span className="man-qty">
        <b>{item.qty}×</b>
        <span>{item.size}</span>
      </span>
    </div>
  );
}

function Page({ model, steps, page, total }: { model: BrickModel; steps: BuildStep[]; page: ManualPage; total: number }) {
  const url = useStepImage(model, steps, page.n, STEP_SIZE, "high");
  return (
    <div className="man-page" data-screen-label="Manual page">
      <div className="man-panel">
        <span className="man-step">{page.n}</span>
        <div className="man-callout" aria-label={`Parts for step ${page.n}`}>
          {page.callout.map((c) => (
            <CalloutPart key={`${c.part}|${c.color}`} item={c} />
          ))}
        </div>
        <div className="man-render">
          {url ? <img src={url} alt={`Model after step ${page.n}; new parts outlined in orange`} /> : <span className="man-spinner" aria-label="Rendering" />}
          <div className="man-shadow" />
        </div>
      </div>
      <div className="man-footer">
        <span>
          {model.name}
          <span className="sep">·</span>Layer {page.layer} of {page.layers}
        </span>
        <span>
          <b>{page.n}</b> / {total}
        </span>
      </div>
      <div className="man-progress" style={{ width: `${(page.n / total) * 100}%` }} />
    </div>
  );
}

function Thumb({ model, steps, n, current, ready, onPick }: { model: BrickModel; steps: BuildStep[]; n: number; current: boolean; ready: boolean; onPick: () => void }) {
  const url = useStepImage(model, steps, n, THUMB_SIZE, "low", ready);
  return (
    <button className={`man-thumb ${current ? "on" : ""}`} onClick={onPick} aria-label={`Page ${n}`} aria-current={current ? "page" : undefined}>
      <span className="man-thumb-page">{url && <img src={url} alt="" />}</span>
      <span className="man-thumb-n">{n}</span>
    </button>
  );
}

export function ManualTab(props: { model: BrickModel; steps: BuildStep[]; step: number; onStep: (n: number) => void }) {
  const { model, steps, onStep } = props;
  const pages = useMemo(() => manualPages(model, steps), [model, steps]);
  const total = pages.length;
  const n = Math.min(Math.max(1, props.step), total);
  const page = pages[n - 1];
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(1);
  const [fitW, setFitW] = useState(DESIGN_W);
  const [ready, setReady] = useState(false);
  const [pdf, setPdf] = useState<{ busy: string | null; error: string | null }>({ busy: null, error: null });
  const viewportRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  // "Fit" = the largest page that fits the viewport (both width and height).
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const narrow = window.matchMedia("(max-width: 959px)").matches;
      const pad = narrow ? 24 : 44;
      // On narrow screens the viewport grows with the page, so fit to width only.
      setFitW(Math.max(260, narrow ? el.clientWidth - pad : Math.min(el.clientWidth - pad, (el.clientHeight - pad) * PAGE_RATIO)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // After the current page renders: prefetch its neighbours, then let the thumbnail strip fill in.
  useEffect(() => {
    let live = true;
    renderStep(model, steps, n).then(() => {
      if (!live) return;
      if (n < total) renderStep(model, steps, n + 1).catch(() => {});
      if (n > 1) renderStep(model, steps, n - 1).catch(() => {});
      setReady(true);
    }, () => {});
    return () => {
      live = false;
    };
  }, [model, steps, n, total]);

  // Keep the current thumbnail centred in the strip.
  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>(".man-thumb.on");
    if (strip && el) strip.scrollTo({ left: el.offsetLeft - strip.clientWidth / 2 + el.offsetWidth / 2, behavior: "smooth" });
  }, [n]);

  // ← / → page through the manual.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("textarea, input, select")) return;
      if (e.key === "ArrowRight") onStep(Math.min(total, n + 1));
      if (e.key === "ArrowLeft") onStep(Math.max(1, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [n, total, onStep]);

  async function downloadPdf() {
    setPdf({ busy: "Preparing…", error: null });
    try {
      const { buildManualPdf } = await import("./manual/manualPdf");
      const blob = await buildManualPdf(model, steps, (done, all) => setPdf({ busy: done < all ? `Page ${done + 1} of ${all}…` : "Saving…", error: null }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileNames(model).ldr.replace(/\.ldr$/, "_manual.pdf");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setPdf({ busy: null, error: null });
    } catch (e) {
      setPdf({ busy: null, error: `Couldn't create the PDF: ${(e as Error).message}` });
    }
  }

  if (!page) return null;
  const zi = ZOOMS.indexOf(zoom);

  return (
    <div className="manual-v2">
      <div className="man-toolbar">
        <div className="man-group">
          <button className="man-icon" aria-label="Previous page" onClick={() => onStep(n - 1)} disabled={n <= 1}>
            <I.ChevronLeft size={15} />
          </button>
          <span className="man-pageno">
            Page {n} of {total}
          </span>
          <button className="man-icon" aria-label="Next page" onClick={() => onStep(n + 1)} disabled={n >= total}>
            <I.ChevronRight size={15} />
          </button>
        </div>
        <label className="man-goto">
          Go to
          <select value={n} onChange={(e) => onStep(Number(e.target.value))}>
            {pages.map((p) => (
              <option key={p.n} value={p.n}>
                Step {p.n} · {p.pieces} piece{p.pieces === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <div className="man-right">
          <div className="man-group">
            <button className="man-icon" aria-label="Zoom out" onClick={() => setZoom(ZOOMS[Math.max(0, zi - 1)])} disabled={zi === 0}>
              <I.ZoomOut size={15} />
            </button>
            <button className={`man-fit ${zoom === 1 ? "on" : ""}`} onClick={() => setZoom(1)} aria-label="Fit page">
              {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
            </button>
            <button className="man-icon" aria-label="Zoom in" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, zi + 1)])} disabled={zi === ZOOMS.length - 1}>
              <I.ZoomIn size={15} />
            </button>
          </div>
          <button className="text-btn man-pdf" onClick={downloadPdf} disabled={!!pdf.busy} title="Download the manual as a PDF, one page per step" aria-live="polite">
            {pdf.busy ? <span className="man-mini-spin" aria-hidden="true" /> : <I.FileText size={15} />}
            {pdf.busy ?? "Manual PDF"}
          </button>
        </div>
      </div>

      {pdf.error && (
        <p className="man-error" role="alert">
          {pdf.error}
        </p>
      )}
      <div className="man-viewport" ref={viewportRef}>
        <div className="man-page-wrap" style={{ width: Math.round(fitW * zoom) }}>
          <Page model={model} steps={steps} page={page} total={total} />
        </div>
      </div>

      <div className="man-thumbs" ref={stripRef} aria-label="Pages">
        {pages.map((p) => (
          <Thumb key={p.n} model={model} steps={steps} n={p.n} current={p.n === n} ready={ready} onPick={() => onStep(p.n)} />
        ))}
      </div>
    </div>
  );
}
