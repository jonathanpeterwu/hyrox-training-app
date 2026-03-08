import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HYROX Training Calendar",
  description: "Adaptive 8-week Hyrox training calendar with AI coaching",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0 }}>{children}</body>
    </html>
  );
}
