import type { ReactNode, SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Stroke({ size = 16, children, ...rest }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const Logo = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <rect x="2" y="9" width="20" height="12" rx="3" fill="var(--k-accent)" />
    <rect x="5" y="5" width="5" height="5" rx="1.5" fill="var(--k-accent)" />
    <rect x="14" y="5" width="5" height="5" rx="1.5" fill="var(--k-accent)" />
  </svg>
);

export const Undo = (p: P) => <Stroke {...p}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></Stroke>;
export const Redo = (p: P) => <Stroke {...p}><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></Stroke>;
export const History = (p: P) => <Stroke {...p}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></Stroke>;
export const Upload = (p: P) => <Stroke {...p}><path d="M12 13v8" /><path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2" /><path d="m8 17 4-4 4 4" /></Stroke>;
export const Moon = (p: P) => <Stroke {...p}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></Stroke>;
export const Sun = (p: P) => <Stroke {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></Stroke>;
export const Download = (p: P) => <Stroke {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" /></Stroke>;
export const Chat = (p: P) => <Stroke {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Stroke>;
export const Library = (p: P) => <Stroke {...p}><path d="m16 6 4 14" /><path d="M12 6v14" /><path d="M8 8v12" /><path d="M4 4v16" /></Stroke>;
export const Cube = (p: P) => <Stroke {...p}><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></Stroke>;
export const Book = (p: P) => <Stroke {...p}><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" /></Stroke>;
export const Bricks = (p: P) => <Stroke {...p}><path d="M4 10h16v10H4zM7 10V7h4v3M13 10V7h4v3" /></Stroke>;
export const Code = (p: P) => <Stroke {...p}><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></Stroke>;
export const Front = (p: P) => <Stroke {...p}><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18" /></Stroke>;
export const Top = (p: P) => <Stroke {...p}><path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M3 15h18M9 3v18M15 3v18" /></Stroke>;
export const Fullscreen = (p: P) => <Stroke {...p}><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></Stroke>;
export const Eye = (p: P) => <Stroke {...p}><path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" /><circle cx="12" cy="12" r="3" /></Stroke>;
export const Sparkle = (p: P) => <Stroke {...p}><path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.13-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.13a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.13 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.13a.5.5 0 0 1-.96 0z" /></Stroke>;
export const Warning = (p: P) => <Stroke {...p}><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path d="M12 17h.01" /></Stroke>;
export const Close = (p: P) => <Stroke {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></Stroke>;
export const Check = (p: P) => <Stroke strokeWidth={3.5} {...p}><path d="M20 6 9 17l-5-5" /></Stroke>;
export const Paperclip = (p: P) => <Stroke {...p}><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" /></Stroke>;
export const ArrowUp = (p: P) => <Stroke strokeWidth={2.4} {...p}><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></Stroke>;
export const ChevronLeft = (p: P) => <Stroke {...p}><path d="m15 18-6-6 6-6" /></Stroke>;
export const ChevronRight = (p: P) => <Stroke {...p}><path d="m9 18 6-6-6-6" /></Stroke>;
export const Pencil = (p: P) => <Stroke {...p}><path d="M21.17 6.81a1 1 0 0 0-3.98-3.98L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z" /></Stroke>;
export const Refresh = (p: P) => <Stroke {...p}><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 16h5v5" /></Stroke>;

export const Play = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ marginLeft: 2 }}>
    <polygon points="6 3 20 12 6 21 6 3" />
  </svg>
);
export const Pause = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);
export const SkipStart = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <polygon points="19 20 9 12 19 4 19 20" />
    <rect x="4" y="5" width="2.5" height="14" />
  </svg>
);
export const SkipEnd = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <polygon points="5 4 15 12 5 20 5 4" />
    <rect x="17.5" y="5" width="2.5" height="14" />
  </svg>
);
