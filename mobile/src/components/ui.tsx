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
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, shadow, spacing } from "../theme";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";

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
  const bg =
    variant === "primary"
      ? colors.brand
      : variant === "secondary"
        ? colors.brandSoft
        : variant === "danger"
          ? colors.danger
          : variant === "outline"
            ? colors.card
            : "transparent";
  const fg =
    variant === "primary"
      ? colors.onBrand
      : variant === "danger"
        ? colors.onBrand
        : variant === "outline"
          ? colors.brand
          : variant === "ghost"
            ? colors.textMuted
            : colors.brand;

  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: variant === "outline" ? colors.border : "transparent" },
        pressed && !isDisabled && styles.buttonPressed,
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
// Chip (filtre / choix)
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
// Field (label + TextInput)
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
        placeholderTextColor={colors.textFaint}
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
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Row({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Header de page (grand titre + sous-titre)
// ---------------------------------------------------------------------------
export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Badge de statut
// ---------------------------------------------------------------------------
export function Badge({ label, tone = "brand" }: { label: string; tone?: "brand" | "accent" | "danger" | "warning" | "muted" }) {
  const bg =
    tone === "accent"
      ? colors.accentSoft
      : tone === "danger"
        ? colors.dangerSoft
        : tone === "warning"
          ? colors.warningSoft
          : tone === "muted"
            ? "#F1F1F6"
            : colors.brandSoft;
  const fg =
    tone === "accent"
      ? colors.accent
      : tone === "danger"
        ? colors.danger
        : tone === "warning"
          ? colors.warning
          : tone === "muted"
            ? colors.textMuted
            : colors.brand;
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>{label}</Text>
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
    minHeight: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
  },
  buttonPressed: { opacity: 0.85 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 15, fontWeight: "600" },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipPressed: { opacity: 0.8 },
  chipText: { fontSize: 13, color: colors.textMuted },
  chipTextSelected: { color: colors.onBrand, fontWeight: "600" },
  fieldWrap: { marginBottom: spacing.md },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginBottom: 6 },
  field: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: colors.text,
    minHeight: 46,
  },
  fieldMultiline: { minHeight: 90, textAlignVertical: "top" },
  fieldError: { borderColor: colors.danger },
  fieldErrorText: { color: colors.danger, fontSize: 12, marginTop: 4 },
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
  headerTitle: { fontSize: 26, fontWeight: "800", color: colors.text, letterSpacing: -0.4 },
  headerSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  badgeText: { fontSize: 12, fontWeight: "700" },
  empty: { alignItems: "center", paddingVertical: 48, paddingHorizontal: spacing.lg },
  emptyIcon: { fontSize: 40, marginBottom: spacing.sm },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.text, textAlign: "center" },
  emptyHint: { fontSize: 13, color: colors.textMuted, textAlign: "center", marginTop: 6, lineHeight: 19 },
});