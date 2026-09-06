import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fonts, fontSizes, radius, THRESHOLD_HIGHLIGHT } from "../theme";

/** Barre de progression du seuil (ex. 3/6 participants).
 *  - proche du seuil (≥ 75 %) : passe en Ocre + « Encore X participant(s) » —
 *    une commande sur le point d'être confirmée doit se voir immédiatement ;
 *  - seuil atteint : fond Sauge + « Seuil atteint ✓ ». */
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
  const hot = !done && ratio >= THRESHOLD_HIGHLIGHT;
  const pct = Math.round(ratio * 100);
  const missing = Math.max(0, threshold - current);

  return (
    <View>
      <View style={styles.row}>
        <Text style={[styles.counter, done && styles.counterDone, hot && styles.counterHot]}>
          {current}/{threshold} participant{threshold > 1 ? "s" : ""}
        </Text>
        <Text style={[styles.pct, done && styles.pctDone, hot && styles.pctHot]}>
          {done ? "Seuil atteint ✓" : hot ? `Encore ${missing} participant${missing > 1 ? "s" : ""} !` : `${pct}%`}
        </Text>
      </View>
      <View style={[styles.track, (done || hot) && styles.trackHot]}>
        <View
          style={[
            styles.fill,
            { width: `${Math.max(4, pct)}%` },
            done && styles.fillDone,
            hot && styles.fillHot,
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  counter: { fontSize: fontSizes.bodySmall, fontWeight: "700", color: colors.ink, fontFamily: fonts.bold },
  counterDone: { color: colors.ink },
  counterHot: { color: "#7A4E0E" },
  pct: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, fontFamily: fonts.medium },
  pctDone: { color: colors.ink, fontWeight: "700", fontFamily: fonts.bold },
  pctHot: { color: "#7A4E0E", fontWeight: "700", fontFamily: fonts.bold },
  track: {
    height: 10,
    borderRadius: radius.full,
    backgroundColor: "#E9E4D8",
    overflow: "hidden",
  },
  trackHot: { backgroundColor: colors.accentSoft },
  fill: { height: "100%", borderRadius: radius.full, backgroundColor: colors.brand },
  fillDone: { backgroundColor: colors.brand },
  fillHot: { backgroundColor: colors.accent },
});