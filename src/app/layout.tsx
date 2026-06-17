import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth";
import { PersonalStoreProvider } from "@/lib/personalStore";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vans Warped Tour — Long Beach 2026",
  description: "Band explorer for Vans Warped Tour, Long Beach 2026.",
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
      <body className="min-h-full flex flex-col">
        {/* Optional auth + cloud sync (PRD §12). Both providers are SSR-safe and
            degrade to the logged-out localStorage app if Firebase is unavailable,
            so wrapping here never changes the default (logged-out) experience. */}
        <AuthProvider>
          <PersonalStoreProvider>{children}</PersonalStoreProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
