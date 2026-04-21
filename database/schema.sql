CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role_code') THEN
    CREATE TYPE user_role_code AS ENUM (
      'administrateur',
      'controleur',
      'controleur_planificateur',
      'officier_avia_bph'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'audit_status') THEN
    CREATE TYPE audit_status AS ENUM ('programme', 'valide');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_scope') THEN
    CREATE TYPE activity_scope AS ENUM ('ship', 'controller');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_type_code') THEN
    CREATE TYPE activity_type_code AS ENUM (
      'audit',
      'maintenance',
      'indisponibilite_navire',
      'exercice',
      'mission',
      'permission',
      'indisponibilite_medicale',
      'stage',
      'autre'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_type_code') THEN
    CREATE TYPE document_type_code AS ENUM ('cr', 'cr_chaud', 'annexe', 'reference');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_status_code') THEN
    CREATE TYPE document_status_code AS ENUM ('brouillon', 'validation', 'diffuse', 'archive');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code user_role_code NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  home_port TEXT NOT NULL,
  audit_periodicity_months INTEGER NOT NULL CHECK (audit_periodicity_months > 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT,
  ship_id UUID REFERENCES ships(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS controllers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,
  matricule TEXT NOT NULL UNIQUE,
  speciality TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retention_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auto_delete_delay_days INTEGER NOT NULL DEFAULT 180 CHECK (auto_delete_delay_days > 0),
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_id UUID NOT NULL REFERENCES ships(id) ON DELETE RESTRICT,
  status audit_status NOT NULL,
  title TEXT NOT NULL,
  controller_departure_at TIMESTAMPTZ NOT NULL,
  control_start_at TIMESTAMPTZ NOT NULL,
  control_end_at TIMESTAMPTZ NOT NULL,
  return_to_mainland_at TIMESTAMPTZ NOT NULL,
  notes TEXT,
  validated_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (control_start_at >= controller_departure_at),
  CHECK (control_end_at >= control_start_at),
  CHECK (return_to_mainland_at >= control_end_at),
  CHECK ((status = 'valide' AND validated_at IS NOT NULL) OR status = 'programme')
);

CREATE TABLE IF NOT EXISTS audit_controllers (
  audit_id UUID NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  controller_id UUID NOT NULL REFERENCES controllers(id) ON DELETE RESTRICT,
  role_on_audit TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (audit_id, controller_id)
);

CREATE TABLE IF NOT EXISTS ship_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_id UUID NOT NULL REFERENCES ships(id) ON DELETE CASCADE,
  activity_type activity_type_code NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  auto_deletable BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_at >= start_at)
);

CREATE TABLE IF NOT EXISTS controller_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  controller_id UUID NOT NULL REFERENCES controllers(id) ON DELETE CASCADE,
  activity_type activity_type_code NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  visibility_to_planner BOOLEAN NOT NULL DEFAULT TRUE,
  auto_deletable BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_at >= start_at)
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ship_id UUID NOT NULL REFERENCES ships(id) ON DELETE CASCADE,
  audit_id UUID REFERENCES audits(id) ON DELETE SET NULL,
  document_type document_type_code NOT NULL,
  status document_status_code NOT NULL DEFAULT 'brouillon',
  title TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  checksum TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  document_date DATE NOT NULL,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ship_id UUID NOT NULL REFERENCES ships(id) ON DELETE CASCADE,
  audit_id UUID REFERENCES audits(id) ON DELETE SET NULL,
  chunk_index INTEGER NOT NULL,
  chunk_text TEXT NOT NULL,
  chunk_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS llm_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'rag:query',
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_name TEXT NOT NULL,
  entity_id UUID,
  action_name TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audits_ship_status ON audits(ship_id, status, control_end_at DESC);
CREATE INDEX IF NOT EXISTS idx_ship_activities_ship_dates ON ship_activities(ship_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_controller_activities_controller_dates ON controller_activities(controller_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_documents_ship_type_date ON documents(ship_id, document_type, document_date DESC);
CREATE INDEX IF NOT EXISTS idx_document_embeddings_ship ON document_embeddings(ship_id, document_id);
CREATE INDEX IF NOT EXISTS idx_llm_tokens_user_active ON llm_tokens(user_id, revoked_at, expires_at);

CREATE OR REPLACE VIEW v_last_valid_audit_per_ship AS
SELECT DISTINCT ON (a.ship_id)
  a.ship_id,
  a.id AS audit_id,
  a.control_end_at,
  a.validated_at
FROM audits a
WHERE a.status = 'valide'
ORDER BY a.ship_id, a.control_end_at DESC, a.validated_at DESC NULLS LAST;

CREATE OR REPLACE VIEW v_ship_validity AS
SELECT
  s.id AS ship_id,
  s.code AS ship_code,
  s.name AS ship_name,
  s.audit_periodicity_months,
  l.audit_id AS last_valid_audit_id,
  l.control_end_at AS last_valid_audit_end_at,
  (
    date_trunc('month', l.control_end_at)
    + make_interval(months => s.audit_periodicity_months + 1)
    - interval '1 day'
  )::date AS validity_deadline
FROM ships s
LEFT JOIN v_last_valid_audit_per_ship l ON l.ship_id = s.id;

CREATE OR REPLACE VIEW v_ship_document_summary AS
SELECT
  s.id AS ship_id,
  MAX(d.document_date) FILTER (WHERE d.document_type = 'cr') AS latest_cr_date,
  MAX(d.document_date) FILTER (WHERE d.document_type = 'cr_chaud') AS latest_hot_cr_date
FROM ships s
LEFT JOIN documents d ON d.ship_id = s.id
GROUP BY s.id;
