import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '图解和声｜叶小胖｜完整听觉阅读',
  description: '叶小胖《图解和声》基础篇与高级篇的交互式音频阅读版。',
  openGraph: {
    title: '图解和声｜叶小胖｜完整听觉阅读',
    description: '翻开书页，让和弦随风响起。',
    images: [{ url: '/og.png', width: 1731, height: 909, alt: '图解和声｜基础篇与高级篇完整听觉阅读' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '图解和声｜叶小胖｜完整听觉阅读',
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
