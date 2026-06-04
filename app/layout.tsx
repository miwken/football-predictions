import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Футбольные прогнозы ЧМ-2026",
  description: "Делай прогнозы на матчи ЧМ-2026 и соревнуйся с друзьями",
  manifest: "/manifest.json", // Добавлено
  themeColor: "#3b82f6",       // Добавлено
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover", // Добавлено
  appleWebApp: {               // Добавлено для iOS
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Прогнозы",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Прогнозы" />
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
        <meta name="theme-color" content="#3b82f6" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}