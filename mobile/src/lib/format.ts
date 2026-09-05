export function formatPrice(v: number | null | undefined): string {
  const n = Number(v ?? 0);
  return `${n.toFixed(2).replace(".", ",")} €`;
}

export function formatDistance(m: number | null | undefined): string {
  const d = Number(m ?? 0);
  if (d < 1000) return `${Math.round(d)} m`;
  return `${(d / 1000).toFixed(1).replace(".", ",")} km`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Compte à rebours « retrait dans 2 j 3 h » (approximatif, convivial). */
export function countdown(iso: string | null | undefined): string {
  if (!iso) return "";
  const target = new Date(iso).getTime();
  const diff = target - Date.now();
  if (diff <= 0) return "maintenant";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `dans ${days} j ${hours} h`;
  if (hours > 0) return `dans ${hours} h ${minutes} min`;
  return `dans ${minutes} min`;
}