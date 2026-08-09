import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: { default: "Derya Deal Desk", template: "%s · Derya Deal Desk" },
  applicationName: "Derya",
  description: "Lead-to-quote freight desk for RFQ qualification, pricing, and customer follow-up"
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
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=IBM+Plex+Sans:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
