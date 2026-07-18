import './globals.css';
import { LocaleProvider } from './i18n/LocaleProvider';
import { HappySeedsWatermark } from './HappySeedsWatermark';
import { publicPath } from './publicPath';

// HappySeeds watermark: read the platform env SERVER-side (a client bundle can't
// see non-NEXT_PUBLIC_ vars) and pass to the client component as props.
const HS_ORIGIN = (process.env.REACTUS_BASE_URL ?? '').replace(/\/$/, '');
const HS_API_BASE = HS_ORIGIN ? `${HS_ORIGIN}/v1/project` : '';
const HS_PROJECT_ID = typeof process.env.PROJECT_ID === 'string' ? process.env.PROJECT_ID.trim() : '';

export const metadata = {
  title: '动物足球赛 - AI 动物足球模拟器',
  description: '选择你的动物国家队，设置阵型，操控或观看一场完整的 AI 动物足球赛。',
  keywords: ['animal football', 'soccer simulator', 'AI game', 'football match', 'web game', 'pixi.js'],
  openGraph: {
    title: '动物足球赛 - AI 动物足球模拟器',
    description: '选择动物国家队，观看或操控一场完整的 AI 足球模拟赛。',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: '动物足球赛 - AI 动物足球模拟器',
    description: '选择动物国家队，观看或操控一场完整的 AI 足球模拟赛。',
  },
  // PWA: "Add to Home Screen" launches fullscreen (no browser bars). iOS Safari
  // has no in-page fullscreen API, so home-screen install is the only way to
  // drop the address/tool bars there — these tags enable it.
  manifest: publicPath('/manifest.webmanifest'),
  appleWebApp: {
    capable: true,
    title: '动物足球赛',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: publicPath('/icon-192.png'),
    apple: publicPath('/apple-touch-icon.png'),
  },
  // iOS Safari still reads the legacy apple-prefixed tag for home-screen
  // standalone (it doesn't honor the modern mobile-web-app-capable yet).
  other: { 'apple-mobile-web-app-capable': 'yes' },
};

// mobile: the match is a landscape experience; lock scale, cover the notch
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#5d9038',
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* Display fonts. Titan One = chunky cartoon face for the hero logo
            (Latin only); ZCOOL KuaiLe covers the CJK title fallback (动物杯);
            Baloo 2 is the rounded UI display font used across the HUD. Google
            subsets CJK by unicode-range, so only glyphs in view are fetched. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@800&family=Titan+One&family=ZCOOL+KuaiLe&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="loading" suppressHydrationWarning>
        <LocaleProvider>{children}</LocaleProvider>
        <HappySeedsWatermark projectId={HS_PROJECT_ID} apiBase={HS_API_BASE} />
      </body>
    </html>
  );
}
