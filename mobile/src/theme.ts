// ---------------------------------------------------------------------------
// Design system Voizy — palette « marché de quartier »
// Toute couleur / taille d'app provient de ce fichier (jamais codée en dur).
// Contraste texte ≥ 7:1 (WCAG AAA) : les teintes encre/texte sont choisies
// pour ça. Les fonds colorés (Sauge, Ocre…) sont réservés aux actions/accent.
// ---------------------------------------------------------------------------

export const colors = {
  // --- Palette ---
  brand: "#2F6F4F", // Vert Marché — marque, boutons principaux, navigation active
  brandPressed: "#285F44", // état appuyé du Vert Marché
  brandSoft: "#E4EDE0", // fonds sélection / non-lu (teinte de Vert Marché)
  accent: "#D98E2B", // Ocre Blé — actions d'accent (rejoindre, seuil atteint)
  accentSoft: "#F6E7CF", // fonds des accents Ocre
  bg: "#FAF7F0", // Papier — fond général
  card: "#FFFFFF", // cartes sur Papier
  ink: "#24302B", // Encre — texte principal
  inkMuted: "#46544B", // texte secondaire — 7,4:1 sur Papier, 8:1 sur blanc (AAA)
  danger: "#B0472E", // Brique — erreurs, alertes, no-show
  dangerSoft: "#F7E4DE", // fonds d'erreur
  success: "#C9D9C6", // Sauge — fonds succès/confirmation
  onBrand: "#FFFFFF", // texte sur Vert Marché
  onAccent: "#24302B", // texte sur Ocre (5,1:1 — jamais de blanc sur Ocre)
  border: "#C4BBA7", // séparation de cartes (avec ombre)
  borderStrong: "#8D8472", // bordures de champs / éléments interactifs (≥3:1)
} as const;

// --- Typographie : Public Sans partout (accessibilité civique) ---
export const fonts = {
  regular: "PublicSans_400Regular",
  medium: "PublicSans_500Medium",
  semiBold: "PublicSans_600SemiBold",
  bold: "PublicSans_700Bold",
  extraBold: "PublicSans_800ExtraBold",
} as const;

// Échelle : corps ≥ 17 px, titres d'écran 24-28 px, interligne ≥ 1,5.
export const fontSizes = {
  display: 28, // titre d'écran principal
  title: 24, // titre de page
  heading: 19, // sous-titre de section
  body: 17, // corps de texte (minimum)
  bodySmall: 15, // méta secondaire (contraste AAA garanti par inkMuted)
  caption: 14, // légendes (jamais en dessous)
} as const;

export const lineHeights = {
  display: 34,
  title: 30,
  heading: 26,
  body: 26, // 1,53 × 17
  bodySmall: 23, // 1,53 × 15
  caption: 21,
} as const;

// --- Espacement ---
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 40 } as const;

// --- Zones tactiles (règle accessibilité) ---
export const touch = {
  primary: 56, // toute action principale (≥ 56 dp)
  secondary: 48, // actions secondaires (≥ 44 dp)
  icon: 44, // éléments de navigation compacts (≥ 44 dp)
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, full: 999 } as const;

export const shadow = {
  shadowColor: "#3D3A2E",
  shadowOpacity: 0.08,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

/** Progression à partir de laquelle le seuil devient l'élément visuel dominant. */
export const THRESHOLD_HIGHLIGHT = 0.75;