"use client";

import dynamic from "next/dynamic";

/** three.js viewer, loaded client-side only. */
export const Viewer = dynamic(() => import("./Viewer"), {
  ssr: false,
  loading: () => (
    <div className="stage-empty">
      <span>Loading 3D viewer…</span>
    </div>
  ),
});
