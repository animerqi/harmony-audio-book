import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '图解和声｜叶小胖｜听觉阅读 Demo',
  description: '叶小胖《图解和声》第一、二章的交互式音频阅读 Demo。',
  openGraph: {
    title: '图解和声｜叶小胖｜听觉阅读 Demo',
    description: '翻开书页，让和弦随风响起。',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: '图解和声｜听觉阅读 Demo' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '图解和声｜叶小胖｜听觉阅读 Demo',
    description: '翻开书页，让和弦随风响起。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
