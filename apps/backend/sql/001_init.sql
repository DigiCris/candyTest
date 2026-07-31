CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS token_metadata (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  fallback_symbol TEXT NOT NULL,
  decimals SMALLINT NOT NULL CHECK (decimals BETWEEN 0 AND 77),
  total_supply NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (total_supply >= 0)
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user', 'game_engine')),
  address TEXT NOT NULL,
  address_normalized TEXT NOT NULL UNIQUE,
  wallet_xpub TEXT NOT NULL,
  account_path TEXT NOT NULL,
  address_path TEXT NOT NULL,
  address_index INTEGER NOT NULL DEFAULT 0 CHECK (address_index >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS balances (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS allowances (
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(78, 0) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, spender_id)
);

CREATE TABLE IF NOT EXISTS token_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL CHECK (event_type IN ('MINT', 'BURN', 'TRANSFER', 'APPROVAL')),
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  spender_id UUID REFERENCES users(id) ON DELETE SET NULL,
  amount NUMERIC(78, 0) NOT NULL CHECK (amount >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS token_events_created_idx ON token_events (created_at DESC);
CREATE INDEX IF NOT EXISTS token_events_from_idx ON token_events (from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS token_events_to_idx ON token_events (to_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_engine_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  stake NUMERIC(78, 0) NOT NULL CHECK (stake > 0),
  secret_value TEXT NOT NULL,
  secret_salt TEXT NOT NULL,
  commitment_hash TEXT NOT NULL,
  engine_number BIGINT,
  player_number BIGINT,
  engine_die SMALLINT CHECK (engine_die BETWEEN 1 AND 6),
  player_die SMALLINT CHECK (player_die BETWEEN 1 AND 6),
  winner TEXT CHECK (winner IN ('player', 'game_engine')),
  status TEXT NOT NULL DEFAULT 'committed' CHECK (status IN ('committed', 'resolved')),
  resolved_event_id BIGINT REFERENCES token_events(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS one_open_game_per_player
  ON games (player_id)
  WHERE status = 'committed';
CREATE INDEX IF NOT EXISTS games_created_idx ON games (created_at DESC);
