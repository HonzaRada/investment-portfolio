import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portfolio | Přehled investic",
  description: "Výpisy, pozice a pohyby investičního portfolia.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="cs"><body>{children}</body></html>;
}
