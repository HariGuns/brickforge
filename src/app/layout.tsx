import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "Brick Builder", description: "Turn a description or photo into a buildable brick model" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
