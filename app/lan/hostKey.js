const PREFIX = "animalCupLanHost:";

export function loadLanHostKey(room) {
  if (!room) return "";
  try {
    return sessionStorage.getItem(`${PREFIX}${room}`) || "";
  } catch {
    return "";
  }
}

export function storeLanHostKey(room, key) {
  if (!room || !key) return;
  try { sessionStorage.setItem(`${PREFIX}${room}`, key); } catch {}
}
