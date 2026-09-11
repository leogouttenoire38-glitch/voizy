-- ============================================================================
-- Voizy — 0014 correctif : parcours de paiement inatteignable
--
-- PROBLÈME : join_group_order réservait une participation « pending_payment »
-- puis join-order vérifiait la carte. Quand l'utilisateur n'avait pas encore
-- enregistré sa carte, l'Edge Function renvoyait « setup_required » SANS
-- annuler la réservation. Au retour de l'enregistrement de carte, tout nouvel
-- essai échouait en « Vous participez déjà à cette commande. » : impossible de
-- rejoindre, donc de payer. Le même blocage se produisait après un abandon
-- (app fermée, 3-D Secure abandonné) ou si le processus Edge était interrompu
-- entre la réservation et l'appel Stripe.
--
-- CORRECTIF : une participation qui n'a jamais été payée (statut
-- « pending_payment » ou « cancelled ») n'a par définition aucun PaymentIntent
-- actif — elle est réutilisable. join_group_order la RÉINITIALISE (même ligne,
-- même id : l'historique et les clés étrangères sont préservés) au lieu de
-- refuser. Seuls les statuts engageants (paid / completed / no_show) bloquent.
-- (L'Edge Function join-order libère par ailleurs la réservation sur le chemin
-- « setup_required », ceinture et bretelles.)
-- ============================================================================

create or replace function public.join_group_order(
  p_group_order_id uuid,
  p_user_id        uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.group_orders;
  v_part  public.participations;
begin
  if p_user_id is null then
    raise exception 'Identifiant utilisateur manquant.';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'Accès refusé.';
  end if;

  select * into v_order
  from public.group_orders
  where id = p_group_order_id
  for update;  -- verrou : un seul participant passe le seuil à la fois

  if not found then
    raise exception 'Commande introuvable.';
  end if;

  if v_order.status <> 'open' then
    raise exception 'Cette commande n''est plus ouverte.';
  end if;
  if v_order.pickup_at <= now() then
    raise exception 'Le délai de participation est dépassé.';
  end if;
  if v_order.organizer_id = p_user_id then
    raise exception 'Vous organisez cette commande : impossible d''y participer.';
  end if;

  -- Participation existante ?
  select * into v_part
  from public.participations
  where group_order_id = p_group_order_id
    and user_id = p_user_id
  for update;

  if found then
    if v_part.status in ('pending_payment', 'cancelled') then
      -- Jamais payée : on réinitialise la réservation à montants courants et on
      -- repart (le participant peut enregistrer sa carte puis réessayer).
      update public.participations
         set status           = 'pending_payment',
             amount           = v_order.group_price,
             deposit_amount   = v_order.deposit_amount,
             deposit_status   = 'pending',
             product_pi_id    = null,
             deposit_pi_id    = null,
             product_captured_at = null,
             picked_up_at     = null,
             cancelled_at     = null
       where id = v_part.id
      returning * into v_part;

      return jsonb_build_object('ok', true, 'participation', to_jsonb(v_part),
                                'order', to_jsonb(v_order));
    end if;

    -- Participation engagée (payée / retirée / no-show) : on refuse.
    raise exception 'Vous participez déjà à cette commande.';
  end if;

  insert into public.participations
    (group_order_id, user_id, amount, deposit_amount)
  values
    (p_group_order_id, p_user_id, v_order.group_price, v_order.deposit_amount)
  returning * into v_part;

  return jsonb_build_object('ok', true, 'participation', to_jsonb(v_part),
                            'order', to_jsonb(v_order));
end;
$$;
