import Landing from "./Landing";

// Pre-match landing (owner 2026-06-11): pick teams + formations, then kick
// off into /match. Replaces the old instant-play server redirect.
export const metadata = {
  title: "动物足球赛",
};

export default function Home() {
  return <Landing />;
}
