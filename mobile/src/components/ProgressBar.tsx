import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme";

/** Barre de progression du seuil (ex. 3/6 participants). */
export function ProgressBar({
  current,
  threshold,
  confirmed,
}: {
  current: number;
  threshold: number;
  confirmed?: boolean;
}) {
  const ratio = Math.min(1, threshold > 0 ? current / threshold : 0);
  const done = confirmed || ratio >= 1;
  const pct = Math.round(ratio * 100);

  return (
    <View>
      <View style={styles.row}>
        <Text style={[styles.counter, done && styles.counterDone]}>
          {current}/{threshold} participant{threshold > 1 ? "s" : ""}
        </Text>
        <Text style={[styles.pct, done && styles.pctDone]}>{done ? "Seuil atteint 🎉" : `${pct}%`}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(4, pct)}%` }, done && styles.fillDone]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  counter: { fontSize: 13, fontWeight: "700", color: colors.text },
  counterDone: { color: colors.accent },
  pct: { fontSize: 12, color: colors.textMuted },
  pctDone: { color: colors.accent, fontWeight: "700" },
  track: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.brandSoft,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radius.full, backgroundColor: colors.brand },
  fillDone: { backgroundColor: colors.accent },
});