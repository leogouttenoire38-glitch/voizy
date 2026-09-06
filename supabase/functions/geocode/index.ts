// geocode — adresse → lat/lng (gratuit, sans clé).
// Volumes MVP uniquement : 1 requête par onboarding / changement de quartier.
// Chaîne de repli : Nominatim (OSM) → Photon (Komoot) → Open-Meteo.
// Certaines IP (dont Supabase Cloud) sont bloquées par Nominatim/Photon,
// d'où le troisième fournisseur pensé pour les usages serveur.
import { handleOptions, json } from "../_shared/cors.ts";

interface ProviderHit {
  lat: number;
  lng: number;
  label: string;
}

const UA = "Voizy/1.0 (group buying - dev)"; // ASCII uniquement : les headers rejettent le non-ASCII

Deno.serve(async (req: Request) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  if (req.method === "GET") return json({ ok: true, service: "geocode" });

  if (req.method !== "POST") return json({ error: "Méthode non autorisée" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as { address?: string };
    const query = body.address?.trim();
    if (!query || query.length < 4 || query.length > 200) {
      return json({ ok: false, error: "Adresse invalide" }, 400);
    }

    const providers: Array<() => Promise<ProviderHit | null>> = [
      () => nominatim(query),
      () => photon(query),
      () => openMeteo(query),
    ];

    for (const provider of providers) {
      const hit = await provider().catch((err) => {
        console.error("geocode/provider", err instanceof Error ? err.message : err);
        return null;
      });
      if (hit) {
        return json({ ok: true, lat: hit.lat, lng: hit.lng, label: hit.label });
      }
    }

    return json(
      { ok: false, error: "Adresse introuvable. Précisez la ville ou le code postal." },
      404,
    );
  } catch (err) {
    console.error("geocode", err);
    return json({ ok: false, error: "Erreur de géocodage." }, 500);
  }
});

async function nominatim(query: string): Promise<ProviderHit | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");
  url.searchParams.set("accept-language", "fr");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA, "Accept-Language": "fr,fr-FR;q=0.9" },
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) return null;

  const results = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  const hit = results[0];
  return hit
    ? { lat: parseFloat(hit.lat), lng: parseFloat(hit.lon), label: hit.display_name }
    : null;
}

async function photon(query: string): Promise<ProviderHit | null> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("lang", "fr");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    features?: Array<{ geometry?: { coordinates?: number[] }; properties?: { name?: string } }>;
  };
  const hit = data.features?.[0];
  const coords = hit?.geometry?.coordinates;
  return hit && coords && coords.length >= 2
    ? { lat: coords[1], lng: coords[0], label: hit.properties?.name ?? query }
    : null;
}

async function openMeteo(query: string): Promise<ProviderHit | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "fr");
  url.searchParams.set("format", "json");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(6_000),
  });
  if (!res.ok) return null;

  const data = (await res.json()) as {
    results?: Array<{
      latitude?: number;
      longitude?: number;
      name?: string;
      admin1?: string;
      country?: string;
    }>;
  };
  const hit = data.results?.[0];
  if (!hit || hit.latitude == null || hit.longitude == null) return null;
  const parts = [hit.name, hit.admin1, hit.country].filter(Boolean);
  return { lat: hit.latitude, lng: hit.longitude, label: parts.join(", ") };
}