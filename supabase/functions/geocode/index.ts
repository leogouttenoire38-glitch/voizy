// geocode — adresse → lat/lng via Nominatim (OpenStreetMap, gratuit).
// Volumes MVP uniquement : 1 requête par onboarding / changement de quartier.
// https://operations.osmfoundation.org/policies/nominatim/
import { handleOptions, json } from "../_shared/cors.ts";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method === "GET") return json({ ok: true, service: "geocode" });

  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as { address?: string };
    const address = body.address?.trim();
    if (!address || address.length < 4 || address.length > 200) {
      return json({ ok: false, error: "Adresse invalide" }, 400);
    }

    const url = new URL(NOMINATIM);
    url.searchParams.set("q", address);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("addressdetails", "0");
    url.searchParams.set("accept-language", "fr");

    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Voizy/1.0 (achat groupé de quartier — dev)",
        "Accept-Language": "fr,fr-FR;q=0.9",
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      console.error("Nominatim HTTP", res.status);
      return json({ ok: false, error: "Service de géocodage indisponible, réessayez." }, 502);
    }

    const results = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    const hit = results[0];
    if (!hit) {
      return json({ ok: false, error: "Adresse introuvable. Précisez la ville ou le code postal." }, 404);
    }

    return json({
      ok: true,
      lat: parseFloat(hit.lat),
      lng: parseFloat(hit.lon),
      label: hit.display_name,
    });
  } catch (err) {
    console.error("geocode", err);
    return json({ ok: false, error: "Erreur de géocodage." }, 500);
  }
});