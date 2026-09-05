# Cahier des Charges — Application "Voizy"
### Achat groupé hyperlocal entre voisins, chez les commerçants de proximité

**Version :** 1.0 — Post-réunion de cadrage
**Statut :** Validé pour lancement MVP
**Équipe projet :** Fondateur, Product Owner, Lead Dev, UX/UI Designer, Marketing Manager, Business Developer, Juriste/Compliance, Data & Growth Analyst

---

## 1. Contexte et origine du projet

### 1.1 Constat de départ
L'inflation sur les produits du quotidien pousse les consommateurs à chercher des solutions d'économies, mais les initiatives d'achat groupé existent aujourd'hui de façon totalement artisanale (groupes Facebook, WhatsApp de quartier) sans outil dédié, sans garantie de paiement, et sans structuration logistique.

### 1.2 Inspirations internationales
- **Chine** : mécanisme du *tuangou* (团购), popularisé par Pinduoduo — des groupes d'acheteurs débloquent des tarifs de gros.
- **États-Unis** : plateformes hyperlocales (Nextdoor, Buy Nothing Project) démontrant un fort appétit pour l'entraide de voisinage, mais sans mécanisme d'achat groupé structuré.
- **Constat marché** : aucun acteur n'a importé un modèle de group buying structuré et localisé pour les commerces physiques de proximité en France/Europe.

### 1.3 Étude de marché synthétique
| Élément | Constat |
|---|---|
| Concurrence directe | Quasi inexistante sur le créneau précis (group buying + commerçants physiques de quartier) |
| Concurrence indirecte | Groupes Facebook/WhatsApp non structurés (preuve de demande) |
| Tendance de fond | Retour au commerce de proximité post-Covid + recherche de pouvoir d'achat |
| Scalabilité | Modèle réplicable ville par ville, sans besoin de levée de fonds massive au démarrage |

---

## 2. Décisions actées en réunion de cadrage

| # | Sujet | Décision |
|---|---|---|
| 1 | Nom de marque | Abandon de "Groupi" (confusion avec Groupon) → **"Voizy"** |
| 2 | Positionnement | Bascule de "économiser" vers "acheter ensemble entre voisins, en circuit court" |
| 3 | Système anti-no-show | Suppression du système d'étoiles complexe → **caution remboursable** via pré-autorisation Stripe |
| 4 | Rôle utilisateur | Ajout du statut **Organisateur** identifié (responsable de la commande groupée) |
| 5 | Paiement | **Stripe Connect (mode Express)** obligatoire pour éviter le statut d'établissement de paiement |
| 6 | Catalogue V1 | Restriction aux produits secs, épicerie, fruits/légumes non périssables (exclusion viande/poisson/frais) |
| 7 | Stratégie commerçants | Mode "concierge" manuel sur 3-4 commerçants le premier mois |
| 8 | Acquisition utilisateurs | Priorité aux partenariats mairies/associations + programme de parrainage |
| 9 | Pilotage | 4 KPIs prioritaires définis dès le MVP |

---

## 3. Objectifs du produit

### 3.1 Objectif principal
Permettre à des habitants d'un même quartier de se regrouper pour commander chez un commerçant local et débloquer un tarif préférentiel, tout en renforçant le lien de voisinage et le commerce de circuit court.

### 3.2 Objectifs secondaires
- Offrir aux commerçants de proximité un volume de commande garanti et prévisible.
- Réduire le gaspillage lié aux invendus (le commerçant produit/prépare sur commande groupée validée).
- Créer un outil communautaire qui fidélise sur le long terme (au-delà de la simple recherche de promo).

### 3.3 Non-objectifs (hors périmètre V1)
- Pas de livraison à domicile (retrait uniquement sur point unique).
- Pas de produits périssables/frais nécessitant chaîne du froid.
- Pas de marketplace e-commerce classique (produits d'usine, import).
- Pas de chat intégré en V1.

---

## 4. Cible utilisateur

### 4.1 Personae

**Persona 1 — "L'Organisateur" (Camille, 34 ans)**
Habitant impliqué dans la vie de son quartier, sensible au pouvoir d'achat, à l'aise avec les apps mobiles, souvent déjà actif dans un groupe de quartier informel (Facebook/WhatsApp). Crée les commandes groupées et recrute ses voisins.

**Persona 2 — "Le Participant" (Marc, 45 ans)**
Veut économiser sans effort d'organisation. Rejoint une commande déjà créée, paie sa part, récupère au point de retrait.

**Persona 3 — "Le Commerçant" (Fatima, gérante d'épicerie)**
Cherche à augmenter son volume de vente sans risque d'invendus, veut un outil simple qui ne demande pas de gestion technique lourde.

---

## 5. Parcours utilisateurs (User Flows)

### 5.1 Parcours Organisateur
1. Inscription / création de profil (nom, quartier, téléphone vérifié).
2. Sélection d'un commerçant partenaire proche (géolocalisation).
3. Création d'une commande groupée : produit(s), seuil de participants requis, date/heure de retrait.
4. Partage du lien de la commande (réseaux sociaux, WhatsApp, SMS).
5. Suivi en temps réel du remplissage (ex : 6/10 participants).
6. Validation automatique dès seuil atteint → notification à tous les participants et au commerçant.
7. Le jour J : présence obligatoire au point de retrait pour coordonner (badge "Organisateur" visible).

### 5.2 Parcours Participant
1. Réception d'un lien de commande groupée (via partage).
2. Consultation des détails : produit, prix normal vs prix groupé, seuil actuel, date/heure/lieu de retrait.
3. Engagement : paiement du montant + caution remboursable (pré-autorisation).
4. Notification lorsque le seuil est atteint (commande confirmée) ou non atteint (remboursement automatique).
5. Retrait au point/heure convenu → caution libérée automatiquement (géolocalisation ou validation manuelle par l'organisateur/commerçant).

### 5.3 Parcours Commerçant
1. Inscription encadrée en mode "concierge" (accompagnement manuel par l'équipe Voizy au lancement).
2. Définition des offres éligibles au group buying (produit, palier de remise selon nombre de participants).
3. Réception des commandes groupées confirmées via back-office simplifié.
4. Préparation de la commande pour le créneau de retrait fixé.
5. Consultation de statistiques simples (volume généré, nouveaux clients).

---

## 6. Fonctionnalités détaillées

### 6.1 MVP (Version 1 — Lancement)

| Module | Fonctionnalités |
|---|---|
| **Authentification** | Inscription email/téléphone, vérification SMS, profil quartier |
| **Géolocalisation** | Affichage des commerçants partenaires à proximité |
| **Commande groupée** | Création, partage de lien, suivi de seuil en temps réel, verrouillage automatique à échéance |
| **Paiement** | Stripe Connect Express, pré-autorisation de caution, remboursement automatique si seuil non atteint |
| **Rôles** | Statut "Organisateur" vs "Participant" visible dans l'interface |
| **Notifications push** | Seuil atteint / non atteint, rappel de retrait, confirmation de caution libérée |
| **Back-office commerçant** | Vue simplifiée des commandes confirmées, créneaux de retrait, statistiques de base |
| **Catalogue produits** | Restreint aux produits secs, épicerie, fruits/légumes non périssables |

### 6.2 V2 (Post-validation MVP)

- Système de messagerie entre organisateur et participants.
- Système de réputation/avis (au-delà de la simple caution).
- Extension aux produits frais avec partenaires respectant la chaîne du froid.
- Back-office commerçant self-service (sans accompagnement manuel).
- Programme de fidélité inter-commerçants.
- Ouverture multi-villes avec dashboard de pilotage centralisé.

### 6.3 V3 (Vision long terme)

- Algorithme de suggestion de commandes groupées selon habitude d'achat.
- Intégration de paiement fractionné / financement participatif pour achats groupés plus importants (électroménager, etc.).
- Marketplace de commerçants avec mise en avant sponsorisée (monétisation B2B).

---

## 7. Spécifications techniques

### 7.1 Stack technique recommandé
- **Frontend mobile** : React Native (cross-platform iOS/Android) — compatible génération assistée via Cursor.
- **Backend / BDD** : Supabase (PostgreSQL managé, auth intégrée, temps réel) ou Firebase.
- **Paiement** : Stripe Connect (mode Express) — gestion native du split de paiement et des pré-autorisations.
- **Notifications** : Firebase Cloud Messaging (FCM).
- **Géolocalisation** : API de géocodage standard (Google Maps Platform ou Mapbox).
- **Hébergement backend** : infrastructure managée (Supabase Cloud / Firebase), pas de serveur dédié en V1.

### 7.2 Points d'attention technique (remontés par la Lead Dev)
- Gestion de la **concurrence d'accès** lors de la validation du seuil de commande (transactions atomiques en base pour éviter les doubles validations).
- Architecture de **rollback automatique** en cas de seuil non atteint à échéance (annulation + remboursement synchronisés).
- Séparation claire entre logique de pré-autorisation (caution) et logique de paiement définitif (montant produit).

### 7.3 Modèle de données (entités principales)
- `Utilisateur` (id, nom, téléphone, quartier, rôle historique)
- `Commerçant` (id, nom, adresse, catégorie produits, statut onboarding)
- `CommandeGroupée` (id, commerçant_id, organisateur_id, produit, seuil_requis, participants_actuels, statut, date_retrait)
- `Participation` (id, commande_id, utilisateur_id, montant_payé, statut_caution)
- `Transaction` (id, participation_id, montant, statut_stripe)

---

## 8. Aspects légaux et conformité (validés par le Juriste)

- **Paiement** : usage obligatoire de Stripe Connect Express pour ne pas endosser le statut d'établissement de paiement (conformité PSD2 déléguée à Stripe).
- **Produits alimentaires** : restriction V1 aux produits non périssables pour éviter les obligations de traçabilité/chaîne du froid (HACCP) tant que le process de retrait n'est pas encadré.
- **CGU/CGV** : nécessité de clauses spécifiques sur la responsabilité en cas de non-retrait, de caution non remboursée, et de rôle de l'Organisateur (statut non-salarié, bénévole).
- **RGPD** : géolocalisation et données de quartier à traiter avec consentement explicite et minimisation des données.
- **Vente à distance** : vérifier l'applicabilité du droit de rétractation selon la nature du produit (généralement exclu pour les denrées alimentaires périssables/sur-mesure, à confirmer au cas par cas).

---

## 9. Modèle économique

| Source de revenu | Description |
|---|---|
| Commission commerçant | 2 à 5% prélevés sur chaque commande groupée confirmée |
| Abonnement premium commerçant (V2) | Mise en avant dans l'app, statistiques avancées de demande |
| Programme de parrainage | Coût d'acquisition maîtrisé, financé par la commission |

---

## 10. Stratégie de lancement et marketing

### 10.1 Phase 1 — Concierge (Mois 1)
- Sélection manuelle de 3-4 commerçants dans un seul quartier pilote.
- Accompagnement personnalisé de l'équipe pour la mise en place des offres.
- Recrutement des 20-30 premiers utilisateurs via réseau direct et associations de quartier.

### 10.2 Phase 2 — Validation (Mois 2-3)
- Ouverture à l'ensemble du quartier pilote.
- Activation du programme de parrainage (bonus pour les organisateurs recrutant 3+ voisins).
- Partenariats avec mairie et associations de quartier locales (dispositifs de soutien au commerce de proximité).

### 10.3 Phase 3 — Extension (Mois 4+)
- Réplication du modèle sur un second quartier/ville selon résultats des KPIs.
- Ouverture progressive du back-office self-service commerçant.

---

## 11. KPIs de pilotage (définis par la Data & Growth Analyst)

| KPI | Objectif cible (phase pilote) |
|---|---|
| Taux de conversion "commande créée → seuil atteint" | ≥ 60% |
| Taux de no-show au retrait | ≤ 10% |
| Panier moyen par participant | À définir après premières données |
| Rétention à J30 (utilisateur ayant re-participé) | ≥ 25% |

---

## 12. Risques identifiés et mitigation

| Risque | Mitigation |
|---|---|
| Chicken-and-egg (pas de commerçants sans utilisateurs, et inversement) | Mode concierge manuel + recrutement direct des 2 côtés simultanément |
| No-show impactant la confiance commerçant | Caution remboursable + rôle Organisateur responsabilisé |
| Confusion de marque avec Groupon | Choix du nom "Voizy" + positionnement différencié sur le lien de voisinage |
| Risque sanitaire sur produits frais | Exclusion des produits périssables en V1 |
| Statut réglementaire de paiement | Usage exclusif de Stripe Connect Express |

---

## 13. Prochaines étapes

1. Validation finale du nom "Voizy" (vérification disponibilité marque/nom de domaine).
2. Design des maquettes UX/UI (parcours Organisateur, Participant, Commerçant).
3. Développement du MVP technique (stack React Native + Supabase + Stripe Connect).
4. Recrutement des 3-4 premiers commerçants pilotes.
5. Lancement en mode concierge sur un quartier pilote unique.

---

*Document rédigé à l'issue de la réunion de cadrage produit — à faire évoluer selon les retours terrain post-MVP.*
