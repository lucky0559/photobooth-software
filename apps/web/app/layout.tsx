import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '@fontsource/outfit/400.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/bungee/400.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Photobooth admin',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
