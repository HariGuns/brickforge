"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BrickModel } from "@/lib/model/schema";
import type { BuildStep } from "@/lib/steps/steps";
import { manualPages, type CalloutItem, type ManualPage } from "@/lib/manual/pages";
import type { CopyItem, StepSection } from "@/lib/design/steps";
import { peekStep, renderModelIcon, renderPartIcon, renderStep, STEP_SIZE, THUMB_SIZE, type PartIcon } from "./manual/stepRenderer";
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

/** A sub-build copy in the callout: a small render of the whole sub-build and "×count". */
function CopyCallout({ item, model }: { item: CopyItem; model: BrickModel | undefined }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!model) return;
    let live = true;
    renderModelIcon(model).then((u) => live && setUrl(u), () => {});
    return () => {
      live = false;
    };
  }, [model]);
  return (
    <div className="man-callout-item man-copy" title={`${item.count}× ${item.name} (sub-build)`}>
      <div className="man-icon-slot man-copy-slot">{url && <img src={url} alt={item.name} />}</div>
      <span className="man-qty">
        <b>{item.count}×</b>
        <span>{item.name}</span>
      </span>
    </div>
  );
}

function Page({ sections, modelName, page, total }: { sections: StepSection[]; modelName: string; page: ManualPage; total: number }) {
  const sec = sections[page.section];
  const url = useStepImage(sec.model, sec.steps, page.local, STEP_SIZE, "high");
  const subModel = (id: string) => sections.find((x) => x.sub === id)?.model;
  return (
    <div className="man-page" data-screen-label="Manual page">
      {page.label && (
        <span className="man-tab">
          <I.Bricks size={14} />
          {sec.sub ? (
            <>
              <b>Sub-build</b>
              <span className="sep">·</span>
              <span>
                {sec.name}
                {sec.copies > 1 ? ` ×${sec.copies}` : ""}
              </span>
            </>
          ) : (
            <b>Main build</b>
          )}
        </span>
      )}
      <div className={`man-panel ${page.label ? "tabbed" : ""}`}>
        <span className="man-step">{page.n}</span>
        <div className="man-callout" aria-label={`Parts for step ${page.n}`}>
          {page.copies.map((c) => (
            <CopyCallout key={c.sub} item={c} model={subModel(c.sub)} />
          ))}
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
          {modelName}
          <span className="sep">·</span>
          {sec.sub ? `${sec.name} · step ${page.local} of ${page.localTotal}` : `${page.label ? "Main build · " : ""}Layer ${page.layer} of ${page.layers}`}
        </span>
        <span>
          <b>{page.n}</b> / {total}
        </span>
      </div>
      <div className="man-progress" style={{ width: `${(page.n / total) * 100}%` }} />
    </div>
  );
}

function Thumb({ model, steps, local, n, current, ready, onPick }: { model: BrickModel; steps: BuildStep[]; local: number; n: number; current: boolean; ready: boolean; onPick: () => void }) {
  const url = useStepImage(model, steps, local, THUMB_SIZE, "low", ready);
  return (
    <button className={`man-thumb ${current ? "on" : ""}`} onClick={onPick} aria-label={`Page ${n}`} aria-current={current ? "page" : undefined}>
      <span className="man-thumb-page">{url && <img src={url} alt="" />}</span>
      <span className="man-thumb-n">{n}</span>
    </button>
  );
}

export function ManualTab(props: { sections: StepSection[]; modelName: string; step: number; onStep: (n: number) => void }) {
  const { sections, modelName, onStep } = props;
  const pages = useMemo(() => manualPages(sections), [sections]);
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
    const render = (p: ManualPage | undefined) => (p ? renderStep(sections[p.section].model, sections[p.section].steps, p.local) : Promise.resolve(""));
    render(pages[n - 1]).then(() => {
      if (!live) return;
      render(pages[n]).catch(() => {});
      render(pages[n - 2]).catch(() => {});
      setReady(true);
    }, () => {});
    return () => {
      live = false;
    };
  }, [sections, pages, n]);

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
      const blob = await buildManualPdf(sections, modelName, (done, all) => setPdf({ busy: done < all ? `Page ${done + 1} of ${all}…` : "Saving…", error: null }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileNames({ name: modelName, description: "", parts: [] }).ldr.replace(/\.ldr$/, "_manual.pdf");
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
            {sections.length > 1
              ? sections.map((sec, si) => (
                  <optgroup key={si} label={sec.sub ? `${sec.name}${sec.copies > 1 ? ` ×${sec.copies}` : ""}` : "Main build"}>
                    {pages
                      .filter((p) => p.section === si)
                      .map((p) => (
                        <option key={p.n} value={p.n}>
                          {p.n}. {sec.sub ? sec.name : "Main build"} · step {p.local}
                        </option>
                      ))}
                  </optgroup>
                ))
              : pages.map((p) => (
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
          <Page sections={sections} modelName={modelName} page={page} total={total} />
        </div>
      </div>

      <div className="man-thumbs" ref={stripRef} aria-label="Pages">
        {pages.map((p) => (
          <Thumb key={p.n} model={sections[p.section].model} steps={sections[p.section].steps} local={p.local} n={p.n} current={p.n === n} ready={ready} onPick={() => onStep(p.n)} />
        ))}
      </div>
    </div>
  );
}
