-- ============================================================================
-- Voizy — 0001 Extensions
-- PostGIS : requêtes de proximité (ST_DWithin / ST_Distance sur geography).
-- pgcrypto : crypt() pour les comptes de démo des seeds (auth.users).
-- ============================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;