INSERT INTO roles (code, label)
VALUES
  ('administrateur', 'Administrateur'),
  ('controleur', 'Controleur'),
  ('controleur_planificateur', 'Controleur + planificateur'),
  ('officier_avia_bph', 'Officier AVIA BPH')
ON CONFLICT (code) DO NOTHING;

INSERT INTO ships (id, code, name, home_port, audit_periodicity_months)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'PHA TON', 'Tonnerre', 'Toulon', 3),
  ('10000000-0000-0000-0000-000000000002', 'PHA MIS', 'Mistral', 'Brest', 6),
  ('10000000-0000-0000-0000-000000000003', 'PHA DIX', 'Dixmude', 'Toulon', 6)
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, username, password_hash, display_name, email, ship_id)
VALUES
  ('20000000-0000-0000-0000-000000000001', 'admin', 'demo-hash-admin', 'Administrateur principal', 'admin@mn.local', NULL),
  ('20000000-0000-0000-0000-000000000002', 'martin', 'demo-hash-martin', 'LCL Martin', 'martin@mn.local', NULL),
  ('20000000-0000-0000-0000-000000000003', 'colin', 'demo-hash-colin', 'MJR Colin', 'colin@mn.local', NULL),
  ('20000000-0000-0000-0000-000000000004', 'planif', 'demo-hash-planif', 'CNE Arnaud', 'arnaud@mn.local', NULL),
  ('20000000-0000-0000-0000-000000000005', 'avia-ton', 'demo-hash-avia-ton', 'Officier AVIA Tonnerre', 'avia.tonnerre@mn.local', '10000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000001', id FROM roles WHERE code = 'administrateur'
ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000002', id FROM roles WHERE code = 'controleur'
ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000003', id FROM roles WHERE code = 'controleur'
ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000004', id FROM roles WHERE code = 'controleur_planificateur'
ON CONFLICT DO NOTHING;
INSERT INTO user_roles (user_id, role_id)
SELECT '20000000-0000-0000-0000-000000000005', id FROM roles WHERE code = 'officier_avia_bph'
ON CONFLICT DO NOTHING;

INSERT INTO controllers (id, user_id, grade, matricule, speciality)
VALUES
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'LCL', 'CTL-017', 'Pont aviation'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'MJR', 'CTL-024', 'Structure'),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', 'CNE', 'CTL-031', 'Planification')
ON CONFLICT (id) DO NOTHING;

INSERT INTO retention_settings (id, auto_delete_delay_days, updated_by_user_id)
VALUES ('40000000-0000-0000-0000-000000000001', 180, '20000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO audits (
  id, ship_id, status, title, controller_departure_at, control_start_at, control_end_at, return_to_mainland_at, validated_at, created_by_user_id
)
VALUES
  (
    '50000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'valide',
    'Controle pont aviation Tonnerre',
    '2026-01-03 07:00+01',
    '2026-01-05 08:00+01',
    '2026-01-05 17:00+01',
    '2026-01-06 18:00+01',
    '2026-01-07 10:00+01',
    '20000000-0000-0000-0000-000000000004'
  ),
  (
    '50000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000002',
    'valide',
    'Controle securite Mistral',
    '2025-11-10 07:00+01',
    '2025-11-12 08:00+01',
    '2025-11-12 16:00+01',
    '2025-11-13 18:00+01',
    '2025-11-14 09:00+01',
    '20000000-0000-0000-0000-000000000004'
  ),
  (
    '50000000-0000-0000-0000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'programme',
    'Controle pont aviation Tonnerre - Avril',
    '2026-04-19 07:00+02',
    '2026-04-20 08:00+02',
    '2026-04-22 17:00+02',
    '2026-04-23 18:00+02',
    NULL,
    '20000000-0000-0000-0000-000000000004'
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO audit_controllers (audit_id, controller_id, role_on_audit)
VALUES
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'chef_de_mission'),
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'adjoint'),
  ('50000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 'chef_de_mission'),
  ('50000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'chef_de_mission'),
  ('50000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 'adjoint')
ON CONFLICT DO NOTHING;

INSERT INTO ship_activities (id, ship_id, activity_type, title, description, start_at, end_at, auto_deletable, created_by_user_id)
VALUES
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'maintenance', 'Arret technique pont', 'Maintenance legere hangar', '2026-03-02 08:00+01', '2026-03-06 18:00+01', TRUE, '20000000-0000-0000-0000-000000000004'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'exercice', 'Exercice amphibie', 'Disponibilite reduite zone aviation', '2026-05-04 08:00+02', '2026-05-10 18:00+02', TRUE, '20000000-0000-0000-0000-000000000004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO controller_activities (id, controller_id, activity_type, title, description, start_at, end_at, visibility_to_planner, auto_deletable, created_by_user_id)
VALUES
  ('70000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'mission', 'Mission externe', 'Indisponible pour replanification courte', '2026-04-23 08:00+02', '2026-04-24 18:00+02', TRUE, TRUE, '20000000-0000-0000-0000-000000000002'),
  ('70000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', 'permission', 'Permission', 'Permission deja validee', '2026-04-28 00:00+02', '2026-04-30 23:55+02', TRUE, TRUE, '20000000-0000-0000-0000-000000000004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO documents (
  id, ship_id, audit_id, document_type, status, title, storage_path, mime_type, checksum, version, document_date, uploaded_by_user_id
)
VALUES
  ('80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'cr', 'diffuse', 'CR-2026-014', '/docs/tonnerre/CR-2026-014.pdf', 'application/pdf', 'sha256-demo-001', 1, '2026-01-05', '20000000-0000-0000-0000-000000000004'),
  ('80000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'cr_chaud', 'diffuse', 'CRH-2026-014', '/docs/tonnerre/CRH-2026-014.pdf', 'application/pdf', 'sha256-demo-002', 1, '2026-01-05', '20000000-0000-0000-0000-000000000004'),
  ('80000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'cr', 'diffuse', 'CR-2025-089', '/docs/mistral/CR-2025-089.pdf', 'application/pdf', 'sha256-demo-003', 1, '2025-11-12', '20000000-0000-0000-0000-000000000004'),
  ('80000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'cr_chaud', 'diffuse', 'CRH-2025-089', '/docs/mistral/CRH-2025-089.pdf', 'application/pdf', 'sha256-demo-004', 1, '2025-11-12', '20000000-0000-0000-0000-000000000004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO document_embeddings (id, document_id, ship_id, audit_id, chunk_index, chunk_text, chunk_metadata)
VALUES
  ('90000000-0000-0000-0000-000000000001', '80000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 0, 'Controle pont aviation Tonnerre valide sans reserve majeure.', '{"document_type":"cr","ship_code":"PHA TON"}'),
  ('90000000-0000-0000-0000-000000000002', '80000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 0, 'Compte-rendu a chaud Tonnerre: attention sur procedure ravitaillement.', '{"document_type":"cr_chaud","ship_code":"PHA TON"}')
ON CONFLICT (document_id, chunk_index) DO NOTHING;

INSERT INTO llm_tokens (id, user_id, token_hash, scope, expires_at)
VALUES
  ('a0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'hash-llm-admin', 'rag:query', NOW() + INTERVAL '365 days'),
  ('a0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'hash-llm-martin', 'rag:query', NOW() + INTERVAL '365 days')
ON CONFLICT (id) DO NOTHING;

INSERT INTO audit_logs (id, actor_user_id, entity_name, entity_id, action_name, payload)
VALUES
  ('b0000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', 'audits', '50000000-0000-0000-0000-000000000003', 'audit_programme', '{"ship":"PHA TON","status":"programme"}'),
  ('b0000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'retention_settings', '40000000-0000-0000-0000-000000000001', 'retention_updated', '{"auto_delete_delay_days":180}')
ON CONFLICT (id) DO NOTHING;
