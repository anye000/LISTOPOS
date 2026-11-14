import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ListoPOS — ERP & POS para Venezuela",
    template: "%s · ListoPOS",
  },
  description:
    "ListoPOS es el ERP y Punto de Venta offline-first para Venezuela: ventas sin internet, multimoneda exacto con tasa BCV, IGTF automático y libros SENIAT listos para el contador.",
  applicationName: "ListoPOS",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icons/icon-180.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1d4ed8",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="min-h-dvh bg-white text-pizarra-900 antialiased">
        {children}
      </body>
    </html>
  );
}
