import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import "./design-system.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Derya Supply OS", template: "%s · Derya Supply OS" },
  applicationName: "Derya",
  description: "Freight operations."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{localStorage.setItem("derya-theme","notebook");document.documentElement.removeAttribute("data-theme")}catch(e){}`,
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Instrument+Sans:wdth,wght@75..100,400..700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
