import { publicPath, routePath } from "./publicPath";

// Web app manifest: lets the game install / "Add to Home Screen" and launch
// fullscreen (no browser chrome) on Android and iOS. display:"fullscreen" gives
// the most immersive view for a landscape game.
export default function manifest() {
  return {
    name: "动物足球赛",
    short_name: "动物足球",
    description: "选择动物国家队，操控或观看一场完整的 AI 足球赛。",
    start_url: routePath("/"),
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#5d9038",
    theme_color: "#5d9038",
    icons: [
      { src: publicPath("/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: publicPath("/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
