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
import { Button, Card, Field, ProgressSteps, Screen, ScreenHeader } from "../components/ui";
import { colors, fonts, fontSizes, lineHeights, radius, spacing, touch } from "../theme";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { orderShareMessage, orderShareUrl } from "../lib/share";
import { formatDateTime, formatPrice } from "../lib/format";
import type { Merchant, Offer } from "../types";

// Création d'une commande en 3 étapes : une seule décision par écran.
//   Étape 1 : quel commerçant ?   Étape 2 : quelle offre ?   Étape 3 : quand ?
export default function NewOrderScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const params = useLocalSearchParams<{ merchantId?: string; offerId?: string }>();

  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loadingMerchants, setLoadingMerchants] = useState(true);

  const [step, setStep] = useState(1);
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

  // Deep link avec commerçant/offre : on avance directement aux étapes suivantes.
  useEffect(() => {
    if (params.merchantId && merchantId) setStep((s) => Math.max(s, 2));
    if (params.offerId && offerId) setStep(3);
  }, [params.merchantId, params.offerId, merchantId, offerId]);

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

  const goNext = () => {
    setError(null);
    if (step === 1) {
      if (!merchantId) return setError("Choisissez d'abord un commerçant.");
      setStep(2);
    } else if (step === 2) {
      if (!offerId) return setError("Choisissez d'abord une offre.");
      setStep(3);
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
        <Card style={styles.successCard} tone="success">
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
      <ScreenHeader title="Nouvelle commande" subtitle="Achetez groupé chez un commerçant du quartier" back />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <ProgressSteps current={step} total={3} />

        {step === 1 ? (
          <View>
            <Text style={styles.stepQuestion}>Chez quel commerçant ?</Text>
            {loadingMerchants ? (
              <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} />
            ) : merchants.length === 0 ? (
              <Text style={styles.muted}>Aucun commerçant partenaire actif pour l'instant.</Text>
            ) : (
              merchants.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setMerchantId(m.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: merchantId === m.id }}
                  style={[styles.choiceCard, merchantId === m.id && styles.choiceCardSelected]}
                >
                  <Text style={styles.choiceTitle}>🏪 {m.name}</Text>
                  <Text style={styles.choiceMeta}>{m.address}</Text>
                  {merchantId === m.id ? <Text style={styles.check}>✓ Choisi</Text> : null}
                </Pressable>
              ))
            )}
          </View>
        ) : step === 2 ? (
          <View>
            <Text style={styles.stepQuestion}>Quelle offre choisir ?</Text>
            {offers.length === 0 ? (
              <Text style={styles.muted}>Ce commerçant n'a pas d'offre active.</Text>
            ) : (
              offers.map((o) => (
                <Pressable
                  key={o.id}
                  onPress={() => setOfferId(o.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: offerId === o.id }}
                  style={[styles.choiceCard, offerId === o.id && styles.choiceCardSelected]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.choiceTitle}>{o.title}</Text>
                    <Text style={styles.offerDesc} numberOfLines={2}>{o.description}</Text>
                    <Text style={styles.offerMeta}>
                      {formatPrice(o.base_price)} → <Text style={styles.offerPrice}>{formatPrice(o.group_price)}</Text>
                      {" · seuil "}{o.threshold} pers. · caution {formatPrice(o.deposit_amount)}
                    </Text>
                  </View>
                  {offerId === o.id ? <Text style={styles.check}>✓</Text> : null}
                </Pressable>
              ))
            )}
          </View>
        ) : (
          <View>
            <Text style={styles.stepQuestion}>Quand venez-vous la chercher ?</Text>
            <Pressable onPress={() => setShowPicker("date")} accessibilityRole="button" style={styles.pickerRow}>
              <Text style={styles.pickerLabel}>Date</Text>
              <Text style={styles.pickerValue}>{pickupDate ? formatDateTime(pickupDate.toISOString()) : ""}</Text>
            </Pressable>
            <Pressable onPress={() => setShowPicker("time")} accessibilityRole="button" style={styles.pickerRow}>
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
              placeholderTextColor={colors.inkMuted}
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

            {offer ? (
              <Card style={styles.recapCard}>
                <Text style={styles.recapTitle}>Récapitulatif</Text>
                <Text style={styles.recapLine}>{merchant?.name} — {offer.title}</Text>
                <Text style={styles.recapLine}>
                  {formatPrice(offer.group_price)} dès {offer.threshold} participants
                  {" · caution "}{formatPrice(offer.deposit_amount)}
                </Text>
              </Card>
            ) : null}
          </View>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/* Navigation d'étape : une seule action principale par écran */}
        {step < 3 ? (
          <View style={styles.stepNav}>
            {step > 1 ? <Button title="Retour" variant="ghost" onPress={() => setStep(step - 1)} /> : null}
            <Button title="Continuer" onPress={goNext} style={step === 1 ? styles.stepNavFull : undefined} />
          </View>
        ) : (
          <View style={styles.stepNav}>
            <Button title="Retour" variant="ghost" onPress={() => setStep(2)} />
            <Button
              title={`Publier la commande — ${offer ? formatPrice(offer.group_price) : ""}`}
              onPress={publish}
              loading={publishing}
              variant="accent"
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 60 },
  stepQuestion: { fontSize: fontSizes.heading, fontWeight: "700", color: colors.ink, marginBottom: spacing.md, fontFamily: fonts.bold },
  choiceCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    minHeight: 72,
  },
  choiceCardSelected: { borderColor: colors.brand, borderWidth: 2.5, backgroundColor: colors.brandSoft },
  choiceTitle: { fontSize: fontSizes.body, fontWeight: "700", color: colors.ink, fontFamily: fonts.bold },
  choiceMeta: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 3, fontFamily: fonts.regular },
  offerDesc: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 3, fontFamily: fonts.regular },
  offerMeta: { fontSize: fontSizes.bodySmall, color: colors.inkMuted, marginTop: 6, fontFamily: fonts.regular },
  offerPrice: { color: colors.brand, fontWeight: "800", fontFamily: fonts.bold },
  check: { fontSize: fontSizes.body, color: colors.brand, marginLeft: spacing.sm, fontWeight: "800", fontFamily: fonts.bold },
  pickerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: touch.secondary,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    marginBottom: spacing.sm,
  },
  pickerLabel: { fontSize: fontSizes.body, color: colors.inkMuted, fontFamily: fonts.regular },
  pickerValue: { fontSize: fontSizes.body, fontWeight: "700", color: colors.ink, fontFamily: fonts.bold },
  recapCard: { marginTop: spacing.md },
  recapTitle: { fontSize: fontSizes.heading, fontWeight: "700", color: colors.ink, marginBottom: 6, fontFamily: fonts.bold },
  recapLine: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 3, lineHeight: lineHeights.body, fontFamily: fonts.regular },
  error: { color: colors.danger, fontSize: fontSizes.body, marginTop: spacing.sm, fontFamily: fonts.medium },
  muted: { fontSize: fontSizes.body, color: colors.inkMuted, fontFamily: fonts.regular },
  stepNav: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  stepNavFull: { flex: 1 },
  successCard: { marginTop: spacing.md },
  successTitle: { fontSize: fontSizes.title, fontWeight: "800", color: colors.ink, fontFamily: fonts.extraBold },
  successLine: { fontSize: fontSizes.body, color: colors.inkMuted, marginTop: 6, fontFamily: fonts.regular },
  successHint: { fontSize: fontSizes.body, color: colors.ink, lineHeight: lineHeights.body, marginTop: spacing.md, marginBottom: spacing.md, fontFamily: fonts.regular },
});