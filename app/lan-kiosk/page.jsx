import { redirect } from "next/navigation";

export const metadata = {
  title: "Animal Cup · LAN Challenge Station",
};

export default function LanKioskPage() {
  redirect("/match?red=argentina&blue=portugal&side=home&time=6&ai=0&attract=1&kiosk=1");
}
