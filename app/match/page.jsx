import GameClient from "../GameClient";
import MatchChrome from "./MatchChrome";
import MatchAudio from "./MatchAudio";
import LanHostBridge from "./LanHostBridge";
import LanKioskBridge from "./LanKioskBridge";
import OnlineMatchBridge from "./OnlineMatchBridge";
import "../ui/kit.css";
import "./match.css";

export const metadata = {
  title: "Animal Cup",
};

export default function MatchPage() {
  return (
    <>
      <GameClient />
      <MatchChrome />
      <MatchAudio />
      {/* No-op unless ?lan=<ROOM> is present: folds phone input into the engine */}
      <LanHostBridge />
      {/* No-op unless ?attract=1 or ?kiosk=1: LAN challenge-station flow. */}
      <LanKioskBridge />
      {/* No-op unless ?online=<ROOM> is present. */}
      <OnlineMatchBridge />
    </>
  );
}
