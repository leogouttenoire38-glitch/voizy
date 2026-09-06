import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, fonts, fontSizes, lineHeights, radius, shadow, spacing, touch } from "../theme";

// ---------------------------------------------------------------------------
// BackButton — flèche « ← Retour » en haut à gauche, jamais d'icône seule
// ---------------------------------------------------------------------------
export function BackButton() {
  const router = useRouter();
  return (
    <Pressable
      onPress={() => {
        if (router.canGoBack()) router.back();
        else router.replace("/");
      }}
      accessibilityRole="button"
      accessibilityLabel="Revenir à l'écran précédent"
      hitSlop={8}
      style={({ pressed }) => [styles.backBtn, pressed && styles.backBtnPressed]}
    >
      <Text style={styles.backBtnText}>← Retour</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Button — zones tactiles ≥ 56 dp (primaire) / 48 dp (secondaire)
// ---------------------------------------------------------------------------
type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger" | "outline";

const VARIANT_BG: Record<ButtonVariant, string> = {
  primary: colors.brand,
  accent: colors.accent,
  secondary: colors.brandSoft,
  ghost: "transparent",
  danger: colors.danger,
  outline: colors.card,
};

const VARIANT_FG: Record<ButtonVariant, string> = {
  primary: colors.onBrand,
  accent: colors.onAccent, // jamais de blanc sur Ocre (2,7:1) — encre (5,1:1)
  secondary: colors.brand,
  ghost: colors.inkMuted,
  danger: colors.onBrand,
  outline: colors.brand,
};

export function Button({
  title,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled || loading;
  const fg = VARIANT_FG[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && styles.buttonPrimary,
        variant === "accent" && styles.buttonAccent,
        variant === "danger" && styles.buttonDanger,
        variant === "outline" && styles.buttonOutline,
        { backgroundColor: VARIANT_BG[variant] },
        pressed && !isDisabled && variant === "primary" && styles.buttonPrimaryPressed,
        pressed && !isDisabled && { opacity: 0.88 },
        isDisabled && styles.buttonDisabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Chip (filtre / choix) — ≥ 48 dp de hauteur
// ---------------------------------------------------------------------------
export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && !disabled && styles.chipPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Field — label toujours visible au-dessus du champ
// ---------------------------------------------------------------------------
export function Field({
  label,
  multiline,
  error,
  ...props
}: TextInputProps & { label?: string; error?: string | null }) {
  return (
    <View style={styles.fieldWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.inkMuted}
        style={[styles.field, multiline && styles.fieldMultiline, error && styles.fieldError]}
        multiline={multiline}
        {...props}
      />
      {error ? <Text style={styles.fieldErrorText}>{error}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({ children, style, tone }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; tone?: "plain" | "success" }) {
  return (
    <View
      style={[
        styles.card,
        tone === "success" && { backgroundColor: colors.success, borderColor: colors.success },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Header de page (grand titre + sous-titre + flèche retour optionnelle)
// ---------------------------------------------------------------------------
export function ScreenHeader({ title, subtitle, right, back }: { title: string; subtitle?: string; right?: React.ReactNode; back?: boolean }) {
  return (
    <View style={styles.header}>
      {back ? <BackButton /> : null}
      <View style={{ flex: 1, marginLeft: back ? spacing.sm : 0 }}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Indicateur d'étape (« Étape 2 sur 3 ») — une seule décision par écran
// ---------------------------------------------------------------------------
export function ProgressSteps({ current, total }: { current: number; total: number }) {
  return (
    <View style={styles.stepsWrap} accessibilityLabel={`Étape ${current} sur ${total}`}>
      <Text style={styles.stepsLabel}>
        Étape {current} sur {total}
      </Text>
      <View style={styles.stepsTrack}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={[styles.stepDot, i < current && styles.stepDotDone]} />
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Badge de statut
// ---------------------------------------------------------------------------
export type BadgeTone = "brand" | "accent" | "danger" | "success" | "muted";

const BADGE_BG: Record<BadgeTone, string> = {
  brand: colors.brandSoft,
  accent: colors.accentSoft,
  danger: colors.dangerSoft,
  success: colors.success,
  muted: "#E7E2D8",
};

const BADGE_FG: Record<BadgeTone, string> = {
  brand: colors.brand,
  accent: "#7A4E0E",
  danger: colors.danger,
  success: colors.ink,
  muted: colors.inkMuted,
};

export function Badge({ label, tone = "brand" }: { label: string; tone?: BadgeTone }) {
  return (
    <View style={[styles.badge, { backgroundColor: BADGE_BG[tone] }]}>
      <Text style={[styles.badgeText, { color: BADGE_FG[tone] }]}>{label}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// État vide
// ---------------------------------------------------------------------------
export function EmptyState({ icon, title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyIcon}>{icon ?? "🔎"}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      {hint ? <Text style={styles.emptyHint}>{hint}</Text> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Écran sûr avec scroll (défaut)
// ---------------------------------------------------------------------------
export function Screen({
  children,
  scroll,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const Wrapper = scroll ? ScrollView : View;
  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <Wrapper style={[styles.screen, style]} contentContainerStyle={scroll ? { paddingBottom: 60 } : undefined}>
        {children}
      </Wrapper>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.sm },

  button: {
    minHeight: touch.primary,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "transparent",
  },
  buttonPrimary: { borderColor: colors.brand },
  buttonPrimaryPressed: { backgroundColor: colors.brandPressed },
  buttonAccent: { borderColor: colors.accent },
  buttonDanger: { borderColor: colors.danger },
  buttonOutline: { borderColor: colors.borderStrong },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { fontSize: fontSizes.body, fontWeight: "700", fontFamily: fonts.bold, lineHeight: fontSizes.body + 4 },

  chip: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    justifyContent: "center",
  },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipPressed: { opacity: 0.8 },
  chipText: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, fontFamily: fonts.medium },
  chipTextSelected: { color: colors.onBrand, fontWeight: "700", fontFamily: fonts.bold },

  fieldWrap: { marginBottom: spacing.md },
  fieldLabel: { fontSize: fontSizes.body, fontWeight: "600", color: colors.ink, marginBottom: 6, fontFamily: fonts.semiBold },
  field: {
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: fontSizes.body,
    color: colors.ink,
    minHeight: 56,
    fontFamily: fonts.regular,
  },
  fieldMultiline: { minHeight: 110, textAlignVertical: "top" },
  fieldError: { borderColor: colors.danger },
  fieldErrorText: { color: colors.danger, fontSize: fontSizes.bodySmall, marginTop: 4, fontFamily: fonts.medium },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    ...shadow,
  },

  row: { flexDirection: "row", alignItems: "center" },

  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md, marginTop: spacing.sm },
  headerTitle: { fontSize: fontSizes.display, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold, lineHeight: lineHeights.display },
  headerSubtitle: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 2, fontFamily: fonts.regular },

  backBtn: {
    minHeight: touch.icon,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
  },
  backBtnPressed: { opacity: 0.75 },
  backBtnText: { fontSize: fontSizes.body, fontWeight: "700", color: colors.brand, fontFamily: fonts.bold },

  stepsWrap: { marginBottom: spacing.md },
  stepsLabel: { fontSize: fontSizes.bodySmall, fontWeight: "700", color: colors.brand, fontFamily: fonts.bold, marginBottom: 6 },
  stepsTrack: { flexDirection: "row", gap: 6 },
  stepDot: { flex: 1, height: 6, borderRadius: radius.full, backgroundColor: colors.border },
  stepDotDone: { backgroundColor: colors.brand },

  badge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.full, alignSelf: "flex-start" },
  badgeText: { fontSize: fontSizes.bodySmall, fontWeight: "700", fontFamily: fonts.bold },

  empty: { alignItems: "center", paddingVertical: 48, paddingHorizontal: spacing.lg },
  emptyIcon: { fontSize: 44, marginBottom: spacing.sm },
  emptyTitle: { fontSize: fontSizes.heading, fontWeight: "700", color: colors.ink, textAlign: "center", fontFamily: fonts.bold },
  emptyHint: { fontSize: fontSizes.body, color: colors.inkMuted, textAlign: "center", marginTop: 8, lineHeight: lineHeights.body, fontFamily: fonts.regular },
});