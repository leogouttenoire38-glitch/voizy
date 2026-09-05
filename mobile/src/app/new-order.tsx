import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Button, Card, Field, Screen, ScreenHeader } from "../components/ui";
import { colors, radius, spacing } from "../theme";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { orderShareMessage, orderShareUrl } from "../lib/share";
import { formatDateTime, formatPrice } from "../lib/format";
import type { Merchant, Offer } from "../types";

export default function NewOrderScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ merchantId?: string; offerId?: string }>();

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loadingMerchants, setLoadingMerchants] = useState(true);

  const [merchantId, setMerchantId] = useState<string | null>(params.merchantId ?? null);
  const [offerId, setOfferId] = useState<string | null>(params.offerId ?? null);
  const [pickupDate, setPickupDate] = useState<Date | null>(null);
  const [pickupLocation, setPickupLocation] = useState("");
  const [showPicker, setShowPicker] = useState<"date" | "time" | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; share_token: string; title: string; group_price: number; threshold: number; pickup_at: string } | null>(null);

  const lat = profile?.lat ?? null;
  const lng = profile?.lng ?? null;

  // ---- Commerçants à proximité (repli : tous les actifs)
  useEffect(() => {
    (async () => {
      if (lat != null && lng != null) {
        const { data } = await supabase.rpc("nearby_merchants", {
          p_lat: lat, p_lng: lng, p_radius_m: 5000, p_limit: 50,
        });
        if (data && (data as unknown[]).length > 0) {
          setMerchants(data as unknown as Merchant[]);
          setLoadingMerchants(false);
          return;
        }
      }
      const { data } = await supabase
        .from("merchants")
        .select("*")
        .eq("status", "active")
        .order("name");
      setMerchants((data as Merchant[]) ?? []);
      setLoadingMerchants(false);
    })();
  }, [lat, lng]);

  // ---- Offres du commerçant sélectionné
  useEffect(() => {
    if (!merchantId) {
      setOffers([]);
      setOfferId(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("offers")
        .select("*")
        .eq("merchant_id", merchantId)
        .eq("active", true)
        .order("group_price");
      setOffers((data as Offer[]) ?? []);
      // Offre présélectionnée via le deep link merchant/… → new-order
      if (params.offerId && (data as Offer[])?.some((o) => o.id === params.offerId)) {
        setOfferId(params.offerId!);
      } else {
        setOfferId((prev) => (prev && (data as Offer[])?.some((o) => o.id === prev) ? prev : null));
      }
    })();
  }, [merchantId, params.offerId]);

  const offer = useMemo(() => offers.find((o) => o.id === offerId) ?? null, [offers, offerId]);
  const merchant = useMemo(() => merchants.find((m) => m.id === merchantId) ?? null, [merchants, merchantId]);

  // Date de retrait par défaut : demain à 18h (défaut raisonnable du MVP).
  useEffect(() => {
    if (!pickupDate) {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(18, 0, 0, 0);
      setPickupDate(d);
    }
  }, [pickupDate]);

  useEffect(() => {
    if (merchant) setPickupLocation(merchant.address);
  }, [merchant]);

  const minDate = useMemo(() => {
    const d = new Date();
    d.setHours(d.getHours() + 1);
    return d;
  }, []);

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === "android") setShowPicker(null);
    if (event.type === "set" && selected) {
      setPickupDate((prev) => {
        const next = new Date(prev ?? selected);
        if (showPicker === "date") {
          next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
        } else if (showPicker === "time") {
          next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        }
        return next;
      });
    }
  };

  const publish = async () => {
    if (!merchantId || !offerId || !pickupDate) {
      setError("Choisissez un commerçant, une offre et une date de retrait.");
      return;
    }
    setPublishing(true);
    setError(null);
    const { data, error: err } = await supabase.rpc("create_group_order", {
      p_merchant_id: merchantId,
      p_offer_id: offerId,
      p_pickup_at: pickupDate.toISOString(),
      p_pickup_location: pickupLocation.trim() || null,
    });
    setPublishing(false);
    if (err || !data?.ok) {
      setError((data as { error?: string } | null)?.error ?? err?.message ?? "Impossible de créer la commande.");
      return;
    }
    const order = data.order as { id: string; share_token: string; title: string; group_price: number; threshold: number; pickup_at: string };
    setCreated(order);
  };

  const shareCreated = async () => {
    if (!created) return;
    try {
      await Share.share({
        message: orderShareMessage(created.share_token, created.title, created.group_price, created.threshold, created.pickup_at),
        url: orderShareUrl(created.share_token),
      });
    } catch {
      /* partage annulé */
    }
  };

  // ---- Écran de succès : partage du lien
  if (created) {
    return (
      <Screen>
        <ScreenHeader title="Commande publiée 🎉" />
        <Card style={styles.successCard}>
          <Text style={styles.successTitle}>{created.title}</Text>
          <Text style={styles.successLine}>
            Seuil : {created.threshold} participants · Prix groupé : {formatPrice(created.group_price)}
          </Text>
          <Text style={styles.successLine}>Retrait : {formatDateTime(created.pickup_at)}</Text>
          <Text style={styles.successHint}>
            La commande se verrouillera automatiquement à l'heure de retrait :
            si le seuil est atteint, tout le monde est prélevé ; sinon, rien n'est débité.
          </Text>
          <Button title="🔗 Partager à mes voisins" onPress={shareCreated} />
          <View style={{ height: spacing.sm }} />
          <Button title="Voir la commande" variant="secondary" onPress={() => router.replace(`/order/${created.id}`)} />
          <View style={{ height: spacing.sm }} />
          <Button title="Créer une autre commande" variant="ghost" onPress={() => router.replace("/")} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title="Nouvelle commande" subtitle="Achetez groupé chez un commerçant du quartier" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.sectionLabel}>1 · Commerçant</Text>
        {loadingMerchants ? (
          <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} />
        ) : merchants.length === 0 ? (
          <Text style={styles.muted}>Aucun commerçant partenaire actif pour l'instant.</Text>
        ) : (
          <View style={styles.chipWrap}>
            {merchants.map((m) => (
              <ChipRow key={m.id} label={m.name} selected={merchantId === m.id} onPress={() => setMerchantId(m.id)} />
            ))}
          </View>
        )}

        {merchantId && (
          <>
            <Text style={styles.sectionLabel}>2 · Offre</Text>
            {offers.length === 0 ? (
              <Text style={styles.muted}>Ce commerçant n'a pas d'offre active.</Text>
            ) : (
              offers.map((o) => (
                <Pressable key={o.id} onPress={() => setOfferId(o.id)} style={[styles.offerCard, offerId === o.id && styles.offerCardSelected]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.offerTitle}>{o.title}</Text>
                    <Text style={styles.offerDesc} numberOfLines={2}>{o.description}</Text>
                    <Text style={styles.offerMeta}>
                      {formatPrice(o.base_price)} → <Text style={{ color: colors.accent, fontWeight: "800" }}>{formatPrice(o.group_price)}</Text>
                      {" · seuil "}{o.threshold} pers. · caution {formatPrice(o.deposit_amount)}
                    </Text>
                  </View>
                  {offerId === o.id ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              ))
            )}
          </>
        )}

        {offer && (
          <>
            <Text style={styles.sectionLabel}>3 · Retrait</Text>
            <Pressable onPress={() => setShowPicker("date")} style={styles.pickerRow}>
              <Text style={styles.pickerLabel}>Date</Text>
              <Text style={styles.pickerValue}>{pickupDate ? formatDateTime(pickupDate.toISOString()) : ""}</Text>
            </Pressable>
            <Pressable onPress={() => setShowPicker("time")} style={styles.pickerRow}>
              <Text style={styles.pickerLabel}>Heure</Text>
              <Text style={styles.pickerValue}>
                {pickupDate
                  ? pickupDate.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
                  : ""}
              </Text>
            </Pressable>
            <Field
              label="Lieu de retrait"
              value={pickupLocation}
              onChangeText={setPickupLocation}
              placeholder={merchant?.address}
              placeholderTextColor={colors.textFaint}
            />

            {showPicker && pickupDate ? (
              <DateTimePicker
                value={pickupDate}
                mode={showPicker}
                display={Platform.OS === "ios" ? "spinner" : "default"}
                minimumDate={showPicker === "date" ? minDate : undefined}
                onChange={onPickerChange}
              />
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Button
              title={`Publier la commande — ${formatPrice(offer.group_price)} dès ${offer.threshold} participants`}
              onPress={publish}
              loading={publishing}
              style={{ marginTop: spacing.md }}
            />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function ChipRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 60 },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    maxWidth: "100%",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { fontSize: 13, color: colors.textMuted },
  chipTextSelected: { color: colors.onBrand, fontWeight: "600" },
  offerCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  offerCardSelected: { borderColor: colors.brand, borderWidth: 2 },
  offerTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  offerDesc: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  offerMeta: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  check: { fontSize: 20, color: colors.brand, marginLeft: spacing.sm, fontWeight: "800" },
  pickerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    marginBottom: spacing.sm,
  },
  pickerLabel: { fontSize: 14, color: colors.textMuted },
  pickerValue: { fontSize: 14, fontWeight: "700", color: colors.text },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.sm },
  muted: { fontSize: 13, color: colors.textMuted },
  successCard: { marginTop: spacing.md },
  successTitle: { fontSize: 18, fontWeight: "800", color: colors.text },
  successLine: { fontSize: 14, color: colors.textMuted, marginTop: 6 },
  successHint: { fontSize: 13, color: colors.textFaint, lineHeight: 19, marginTop: spacing.md, marginBottom: spacing.md },
});