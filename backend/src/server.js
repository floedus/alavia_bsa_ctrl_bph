import express from "express";
import cors from "cors";
import morgan from "morgan";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { pool, query } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const app = express();
const port = Number(process.env.PORT ?? 8081);
const storageRoot = path.resolve(projectRoot, "storage", "documents");

app.use(cors({ origin: true, credentials: false }));
app.use(express.json());
app.use(morgan("dev"));

function toAuditStatus(status) {
  return status === "valide" ? "validated" : "planned";
}

function toActivityStatus() {
  return "warning";
}

function toShipActivityKind(activityType) {
  if (activityType === "audit") {
    return "audit";
  }
  if (activityType === "indisponibilite_navire") {
    return "unavailability";
  }
  return "transit";
}

function formatShipCaption(homePort, deadlineDate) {
  return `${homePort} • echeance ${new Date(deadlineDate).toLocaleDateString("fr-FR")}`;
}

function categoryToActivityType(category) {
  switch (category) {
    case "PERM":
      return "permission";
    case "STAGE":
      return "stage";
    case "MISSION":
      return "mission";
    case "FORM":
      return "stage";
    case "INDISP":
      return "indisponibilite_medicale";
    default:
      return "autre";
  }
}

function categoryToShipActivityType(category) {
  switch (category) {
    case "MAINT":
      return "maintenance";
    case "EXERC":
      return "exercice";
    case "MISSION":
      return "mission";
    case "INDNAV":
      return "indisponibilite_navire";
    default:
      return "autre";
  }
}

function normalizeStorageSegment(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function inferDocumentType(filename) {
  const lower = String(filename ?? "").toLowerCase();
  if (lower.includes("crh") || lower.includes("chaud")) {
    return "cr_chaud";
  }
  if (lower.includes("cr")) {
    return "cr";
  }
  return "annexe";
}

function normalizeDocumentType(value, fallbackName = "") {
  switch (value) {
    case "cr":
    case "cr_chaud":
    case "annexe":
    case "reference":
      return value;
    default:
      return inferDocumentType(fallbackName);
  }
}

function bufferFromBase64(content) {
  const sanitized = String(content ?? "").includes(",") ? String(content).split(",").pop() : String(content ?? "");
  return Buffer.from(sanitized, "base64");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const candidate = String(password ?? "");
  const stored = String(storedHash ?? "");

  if (!stored) {
    return false;
  }

  if (stored.startsWith("scrypt:")) {
    const [, salt, derived] = stored.split(":");
    if (!salt || !derived) {
      return false;
    }
    const candidateHash = crypto.scryptSync(candidate, salt, 64);
    const storedBuffer = Buffer.from(derived, "hex");
    return candidateHash.length === storedBuffer.length && crypto.timingSafeEqual(candidateHash, storedBuffer);
  }

  if (stored.startsWith("plain:")) {
    return candidate === stored.slice("plain:".length);
  }

  if (stored.startsWith("demo-hash-")) {
    return candidate === stored.slice("demo-hash-".length) || candidate === "demo";
  }

  return candidate === stored;
}

function toDbAuditStatus(status) {
  return status === "validated" ? "valide" : "programme";
}

function normalizeControllerIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((entry) => String(entry ?? "").trim()).filter(Boolean))];
}

function normalizeUserRole(value) {
  switch (value) {
    case "administrateur":
    case "controleur":
    case "controleur_planificateur":
    case "officier_avia_bph":
      return value;
    default:
      return "controleur";
  }
}

function canUploadDocuments(role) {
  return role === "administrateur" || role === "controleur" || role === "controleur_planificateur";
}

function canDeleteDocuments(role) {
  return role === "administrateur";
}

function canReadShipDocuments(actor, shipId) {
  if (!actor) {
    return false;
  }

  if (actor.role === "officier_avia_bph") {
    return actor.shipId === shipId;
  }

  return true;
}

async function getActorProfile(userId) {
  if (!userId) {
    return null;
  }

  const normalizedUserId = String(userId);

  const rows = await query(
    `
      SELECT
        u.id,
        r.code::text AS role,
        u.ship_id AS "shipId"
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id
      WHERE u.id = $1 AND u.active = TRUE
      LIMIT 1
    `,
    [normalizedUserId]
  );

  return rows[0] ?? null;
}

function parseAuditDate(value) {
  const date = new Date(value ?? "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function validateAuditChronology({ controllerDepartureAt, controlStartAt, controlEndAt, returnToMainlandAt }) {
  const departure = parseAuditDate(controllerDepartureAt);
  const controlStart = parseAuditDate(controlStartAt);
  const controlEnd = parseAuditDate(controlEndAt);
  const returnToMainland = parseAuditDate(returnToMainlandAt);

  if (!departure || !controlStart || !controlEnd || !returnToMainland) {
    return "Toutes les dates d'audit doivent etre renseignees.";
  }

  if (departure > controlStart) {
    return "La date de mise en route doit etre inferieure ou egale a la date de debut d'audit.";
  }

  if (controlStart > controlEnd) {
    return "La date de debut d'audit doit etre inferieure ou egale a la date de fin d'audit.";
  }

  if (controlEnd > returnToMainland) {
    return "La date de fin d'audit doit etre inferieure ou egale a la date de retour metropole.";
  }

  return null;
}

function recalculateAuditDatesForTimelineRange(auditRow, nextRangeStart, nextRangeEnd) {
  const oldDeparture = new Date(auditRow.controller_departure_at);
  const oldControlStart = new Date(auditRow.control_start_at);
  const oldControlEnd = new Date(auditRow.control_end_at);
  const oldReturn = new Date(auditRow.return_to_mainland_at);
  const nextDeparture = new Date(nextRangeStart);
  const nextReturn = new Date(nextRangeEnd);

  const prepDuration = Math.max(0, oldControlStart.getTime() - oldDeparture.getTime());
  const returnDuration = Math.max(0, oldReturn.getTime() - oldControlEnd.getTime());
  const nextTotalDuration = Math.max(0, nextReturn.getTime() - nextDeparture.getTime());

  let nextControlStart = new Date(nextDeparture.getTime() + prepDuration);
  let nextControlEnd = new Date(nextReturn.getTime() - returnDuration);

  if (nextTotalDuration < prepDuration + returnDuration || nextControlEnd.getTime() < nextControlStart.getTime()) {
    nextControlStart = new Date(nextDeparture);
    nextControlEnd = new Date(nextReturn);
  }

  return {
    controllerDepartureAt: nextDeparture.toISOString(),
    controlStartAt: nextControlStart.toISOString(),
    controlEndAt: nextControlEnd.toISOString(),
    returnToMainlandAt: nextReturn.toISOString()
  };
}

async function replaceAuditControllers(client, auditId, controllerIds) {
  await client.query("DELETE FROM audit_controllers WHERE audit_id = $1", [auditId]);

  for (let index = 0; index < controllerIds.length; index += 1) {
    await client.query(
      `
        INSERT INTO audit_controllers (audit_id, controller_id, role_on_audit)
        VALUES ($1, $2, $3)
      `,
      [auditId, controllerIds[index], index === 0 ? "chef_de_mission" : "adjoint"]
    );
  }
}

async function assignUserRole(client, userId, roleCode) {
  const normalizedRole = normalizeUserRole(roleCode);
  const roleRows = await client.query("SELECT id FROM roles WHERE code = $1::user_role_code LIMIT 1", [normalizedRole]);
  await client.query("DELETE FROM user_roles WHERE user_id = $1", [userId]);
  if (roleRows.rowCount > 0) {
    await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [userId, roleRows.rows[0].id]);
  }
}

async function bindUserAssociations(client, userId, roleCode, controllerId, shipId) {
  const normalizedRole = normalizeUserRole(roleCode);
  const nextShipId = normalizedRole === "officier_avia_bph" ? shipId ?? null : null;

  await client.query("UPDATE users SET ship_id = $2, updated_at = NOW() WHERE id = $1", [userId, nextShipId]);

  if (normalizedRole === "controleur" || normalizedRole === "controleur_planificateur") {
    if (controllerId) {
      const existingRows = await client.query("SELECT user_id FROM controllers WHERE id = $1", [controllerId]);
      const previousUserId = existingRows.rows[0]?.user_id ?? null;
      await client.query("UPDATE controllers SET user_id = $2, updated_at = NOW() WHERE id = $1", [controllerId, userId]);
      if (previousUserId && previousUserId !== userId) {
        await client.query(
          `
            UPDATE users
            SET active = FALSE, updated_at = NOW()
            WHERE id = $1 AND password_hash = 'pending-setup'
          `,
          [previousUserId]
        );
      }
    }
  } else {
    await client.query("UPDATE controllers SET updated_at = NOW() WHERE user_id = $1", [userId]);
  }
}

function buildAuditDates(lastAuditDate) {
  const base = new Date(`${lastAuditDate}T00:00:00`);
  const departure = new Date(base);
  departure.setHours(7, 0, 0, 0);
  const controlStart = new Date(base);
  controlStart.setHours(8, 0, 0, 0);
  const controlEnd = new Date(base);
  controlEnd.setHours(17, 0, 0, 0);
  const returnToMainland = new Date(base);
  returnToMainland.setDate(returnToMainland.getDate() + 1);
  returnToMainland.setHours(18, 0, 0, 0);
  const validatedAt = new Date(returnToMainland);
  validatedAt.setMinutes(validatedAt.getMinutes() + 15);

  return {
    departure: departure.toISOString(),
    controlStart: controlStart.toISOString(),
    controlEnd: controlEnd.toISOString(),
    returnToMainland: returnToMainland.toISOString(),
    validatedAt: validatedAt.toISOString()
  };
}

async function storeArchiveDocuments({ shipId, shipCode, auditId, documents, documentDate, uploadedByUserId }) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return;
  }

  const shipFolder = normalizeStorageSegment(shipCode || shipId);
  const archiveDirectory = path.join(storageRoot, shipFolder, "archives");
  await mkdir(archiveDirectory, { recursive: true });

  for (const document of documents) {
    const safeName = String(document.name ?? "document")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .trim() || "document";
    const fileBuffer = bufferFromBase64(document.base64);
    const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const storedFilename = `${Date.now()}-${safeName}`;
    const absolutePath = path.join(archiveDirectory, storedFilename);
    const relativePath = path.join("storage", "documents", shipFolder, "archives", storedFilename).replace(/\\/g, "/");

    await writeFile(absolutePath, fileBuffer);

    await query(
      `
        INSERT INTO documents (
          ship_id, audit_id, document_type, status, title, storage_path, mime_type, checksum, version, document_date, uploaded_by_user_id
        ) VALUES ($1, $2, $3::document_type_code, 'archive', $4, $5, $6, $7, 1, $8, $9)
      `,
      [
        shipId,
        auditId,
        inferDocumentType(document.name),
        document.title ?? safeName,
        relativePath,
        document.mimeType ?? "application/octet-stream",
        checksum,
        documentDate,
        uploadedByUserId ?? null
      ]
    );
  }
}

async function storeAuditDocuments({ shipId, shipCode, auditId, auditDate, documents, uploadedByUserId }) {
  if (!Array.isArray(documents) || documents.length === 0) {
    return;
  }

  const shipFolder = normalizeStorageSegment(shipCode || shipId);
  const auditFolder = normalizeStorageSegment(`${auditDate || "audit"}_${String(auditId).slice(-8)}`);
  const auditDirectory = path.join(storageRoot, shipFolder, "audits", auditFolder);
  await mkdir(auditDirectory, { recursive: true });

  for (const document of documents) {
    const safeName = String(document.name ?? "document")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
      .trim() || "document";
    const fileBuffer = bufferFromBase64(document.base64);
    const checksum = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const storedFilename = `${Date.now()}-${safeName}`;
    const absolutePath = path.join(auditDirectory, storedFilename);
    const relativePath = path.join("storage", "documents", shipFolder, "audits", auditFolder, storedFilename).replace(/\\/g, "/");

    await writeFile(absolutePath, fileBuffer);

    await query(
      `
        INSERT INTO documents (
          ship_id, audit_id, document_type, status, title, storage_path, mime_type, checksum, version, document_date, uploaded_by_user_id
        ) VALUES ($1, $2, $3::document_type_code, 'brouillon', $4, $5, $6, $7, 1, $8, $9)
      `,
      [
        shipId,
        auditId,
        normalizeDocumentType(document.documentType, document.name),
        document.title ?? safeName,
        relativePath,
        document.mimeType ?? "application/octet-stream",
        checksum,
        auditDate,
        uploadedByUserId ?? null
      ]
    );
  }
}

async function getUsers() {
  return query(`
    SELECT
      u.id,
      u.username,
      u.display_name AS "displayName",
      r.code::text AS role,
      c.id AS "controllerId",
      s.id AS "shipId",
      s.name AS "shipName",
      s.code AS "shipCode",
      c.matricule AS "controllerCode"
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    LEFT JOIN ships s ON s.id = u.ship_id
    LEFT JOIN controllers c ON c.user_id = u.id
    WHERE u.active = TRUE
      AND u.password_hash <> 'pending-setup'
    ORDER BY u.display_name
  `);
}

async function getShipResources() {
  const ships = await query(`
    SELECT
      s.id,
      s.code,
      s.name,
      s.home_port,
      s.audit_periodicity_months AS "periodicityMonths",
      vv.validity_deadline::timestamp AS "deadlineDate",
      vv.last_valid_audit_end_at AS "lastAuditDate",
      latest_cr.title AS "latestReport",
      latest_hot.title AS "latestHotReport"
    FROM ships s
    LEFT JOIN v_ship_validity vv ON vv.ship_id = s.id
    LEFT JOIN LATERAL (
      SELECT d.title
      FROM documents d
      WHERE d.ship_id = s.id AND d.document_type = 'cr'
      ORDER BY d.document_date DESC, d.created_at DESC
      LIMIT 1
    ) latest_cr ON TRUE
    LEFT JOIN LATERAL (
      SELECT d.title
      FROM documents d
      WHERE d.ship_id = s.id AND d.document_type = 'cr_chaud'
      ORDER BY d.document_date DESC, d.created_at DESC
      LIMIT 1
    ) latest_hot ON TRUE
    WHERE s.active = TRUE
    ORDER BY s.name
  `);

  const auditBlocks = await query(`
    SELECT
      a.id,
      a.ship_id AS "resourceId",
      'AUD-' || right(replace(a.id::text, '-', ''), 4) AS code,
      a.title,
      a.controller_departure_at AS "controllerDepartureAt",
      a.control_start_at AS start,
      a.control_start_at AS "controlStartAt",
      a.control_end_at AS "end",
      a.control_end_at AS "controlEndAt",
      a.return_to_mainland_at AS "returnToMainlandAt",
      a.status,
      array_remove(array_agg(c.id ORDER BY u.display_name), NULL) AS "assignedControllerIds",
      string_agg(u.display_name, ' - ' ORDER BY u.display_name) AS crew,
      a.notes AS detail
    FROM audits a
    LEFT JOIN audit_controllers ac ON ac.audit_id = a.id
    LEFT JOIN controllers c ON c.id = ac.controller_id
    LEFT JOIN users u ON u.id = c.user_id
    GROUP BY a.id
  `);

  const activityBlocks = await query(`
    SELECT
      sa.id,
      sa.ship_id AS "resourceId",
      upper(left(sa.activity_type::text, 6)) AS code,
      sa.title,
      sa.start_at AS start,
      sa.end_at AS "end",
      sa.activity_type::text AS "activityCategory",
      sa.description AS detail
    FROM ship_activities sa
  `);

  return ships.map((ship) => ({
    id: ship.id,
    code: ship.code,
    label: ship.name,
    caption: ship.deadlineDate ? formatShipCaption(ship.home_port, ship.deadlineDate) : ship.home_port,
    lastAuditDate: ship.lastAuditDate,
    periodicityMonths: ship.periodicityMonths,
    deadlineDate: ship.deadlineDate,
    latestReport: ship.latestReport,
    latestHotReport: ship.latestHotReport,
    blocks: [
      ...auditBlocks
        .filter((block) => block.resourceId === ship.id)
        .map((block) => ({
          id: block.id,
          code: block.code,
          title: block.title,
          controllerDepartureAt: new Date(block.controllerDepartureAt).toISOString(),
          start: new Date(block.start).toISOString(),
          controlStartAt: new Date(block.controlStartAt).toISOString(),
          end: new Date(block.end).toISOString(),
          controlEndAt: new Date(block.controlEndAt).toISOString(),
          returnToMainlandAt: new Date(block.returnToMainlandAt).toISOString(),
          assignedControllerIds: block.assignedControllerIds ?? [],
          status: toAuditStatus(block.status),
          kind: "audit",
          crew: block.crew ? String(block.crew).split(" - ") : [],
          detail: block.detail ?? undefined
        })),
      ...activityBlocks
        .filter((block) => block.resourceId === ship.id)
        .map((block) => ({
          id: block.id,
          code: block.code,
          title: block.title,
          start: new Date(block.start).toISOString(),
          end: new Date(block.end).toISOString(),
          status: toActivityStatus(),
          kind: toShipActivityKind(block.activityCategory),
          activityCategory: block.activityCategory,
          detail: block.detail ?? undefined
        }))
    ]
  }));
}

async function getControllerResources() {
  const controllers = await query(`
    SELECT
      c.id,
      c.matricule AS code,
      u.display_name AS label,
      coalesce(c.speciality, 'Controleur') AS caption
    FROM controllers c
    JOIN users u ON u.id = c.user_id
    WHERE u.active = TRUE
    ORDER BY u.display_name
  `);

  const activityBlocks = await query(`
    SELECT
      ca.id,
      ca.controller_id AS "resourceId",
      upper(left(ca.activity_type::text, 6)) AS code,
      ca.title,
      ca.start_at AS start,
      ca.end_at AS "end",
      ca.activity_type::text AS "activityCategory",
      ca.description AS detail
    FROM controller_activities ca
  `);

  const auditBlocks = await query(`
    SELECT
      a.id,
      c.id AS "resourceId",
      'AUD-' || right(replace(a.id::text, '-', ''), 4) AS code,
      s.name AS title,
      a.controller_departure_at AS "controllerDepartureAt",
      a.control_start_at AS start,
      a.control_start_at AS "controlStartAt",
      a.control_end_at AS "end",
      a.control_end_at AS "controlEndAt",
      a.return_to_mainland_at AS "returnToMainlandAt",
      a.status,
      array_remove(array_agg(c2.id ORDER BY u.display_name), NULL) AS "assignedControllerIds",
      string_agg(u.display_name, ' - ' ORDER BY u.display_name) AS crew,
      ac.role_on_audit AS detail
    FROM audits a
    JOIN audit_controllers ac ON ac.audit_id = a.id
    JOIN controllers c ON c.id = ac.controller_id
    JOIN ships s ON s.id = a.ship_id
    LEFT JOIN audit_controllers ac2 ON ac2.audit_id = a.id
    LEFT JOIN controllers c2 ON c2.id = ac2.controller_id
    LEFT JOIN users u ON u.id = c2.user_id
    GROUP BY a.id, c.id, s.name, ac.role_on_audit
  `);

  return controllers.map((controller) => ({
    id: controller.id,
    code: controller.code,
    label: controller.label,
    caption: controller.caption,
    blocks: [
      ...activityBlocks
        .filter((block) => block.resourceId === controller.id)
        .map((block) => ({
          id: block.id,
          code: block.code,
          title: block.title,
          start: new Date(block.start).toISOString(),
          end: new Date(block.end).toISOString(),
          status: "warning",
          kind: "unavailability",
          activityCategory: block.activityCategory,
          constraintStatus: "blocking",
          detail: block.detail ?? undefined
        })),
      ...auditBlocks
        .filter((block) => block.resourceId === controller.id)
        .map((block) => ({
          id: block.id,
          code: block.code,
          title: block.title,
          controllerDepartureAt: new Date(block.controllerDepartureAt).toISOString(),
          start: new Date(block.start).toISOString(),
          controlStartAt: new Date(block.controlStartAt).toISOString(),
          end: new Date(block.end).toISOString(),
          controlEndAt: new Date(block.controlEndAt).toISOString(),
          returnToMainlandAt: new Date(block.returnToMainlandAt).toISOString(),
          assignedControllerIds: block.assignedControllerIds ?? [],
          status: toAuditStatus(block.status),
          kind: "audit",
          crew: block.crew ? String(block.crew).split(" - ") : [],
          detail: block.detail ?? undefined
        }))
    ]
  }));
}

async function getFleetRecords() {
  return query(`
    SELECT
      s.id,
      s.name AS platform,
      s.code AS "platformCode",
      to_char(v.last_valid_audit_end_at::date, 'DD/MM/YYYY') AS "lastAudit",
      to_char(v.validity_deadline::date, 'DD/MM/YYYY') AS "nextAudit",
      s.audit_periodicity_months AS "periodicityMonths",
      coalesce(planned.controllers, '-') AS "controllerLead",
      CASE WHEN planned.audit_id IS NULL THEN 'validated' ELSE 'planned' END AS status,
      latest_cr.title AS "latestReport",
      latest_hot.title AS "latestHotReport"
    FROM ships s
    LEFT JOIN v_ship_validity v ON v.ship_id = s.id
    LEFT JOIN LATERAL (
      SELECT
        a.id AS audit_id,
        string_agg(u.display_name, ' - ' ORDER BY u.display_name) AS controllers
      FROM audits a
      LEFT JOIN audit_controllers ac ON ac.audit_id = a.id
      LEFT JOIN controllers c ON c.id = ac.controller_id
      LEFT JOIN users u ON u.id = c.user_id
      WHERE a.ship_id = s.id AND a.status = 'programme'
      GROUP BY a.id
      ORDER BY a.control_start_at ASC
      LIMIT 1
    ) planned ON TRUE
    LEFT JOIN LATERAL (
      SELECT d.title
      FROM documents d
      WHERE d.ship_id = s.id AND d.document_type = 'cr'
      ORDER BY d.document_date DESC, d.created_at DESC
      LIMIT 1
    ) latest_cr ON TRUE
    LEFT JOIN LATERAL (
      SELECT d.title
      FROM documents d
      WHERE d.ship_id = s.id AND d.document_type = 'cr_chaud'
      ORDER BY d.document_date DESC, d.created_at DESC
      LIMIT 1
    ) latest_hot ON TRUE
    WHERE s.active = TRUE
    ORDER BY s.name
  `);
}

async function getDocumentGroups() {
  const ships = await query(`
    SELECT
      s.id AS "shipId",
      s.name AS "shipName",
      s.code AS "shipCode",
      latest_cr.title AS "latestReport",
      latest_hot.title AS "latestHotReport"
    FROM ships s
    LEFT JOIN LATERAL (
      SELECT d.title
      FROM documents d
      WHERE d.ship_id = s.id AND d.document_type = 'cr'
      ORDER BY d.document_date DESC, d.created_at DESC
      LIMIT 1
    ) latest_cr ON TRUE
    LEFT JOIN LATERAL (
      SELECT d.title
      FROM documents d
      WHERE d.ship_id = s.id AND d.document_type = 'cr_chaud'
      ORDER BY d.document_date DESC, d.created_at DESC
      LIMIT 1
    ) latest_hot ON TRUE
    WHERE s.active = TRUE
    ORDER BY s.name
  `);

  const audits = await query(`
    SELECT
      a.id AS "auditId",
      a.ship_id AS "shipId",
      a.title AS "auditTitle",
      a.status::text AS "auditStatus",
      a.control_end_at::date::text AS "auditDate"
    FROM audits a
    JOIN ships s ON s.id = a.ship_id
    WHERE s.active = TRUE
    ORDER BY a.ship_id, a.control_end_at DESC NULLS LAST, a.control_start_at DESC NULLS LAST, a.created_at DESC
  `);

  const docs = await query(`
    SELECT
      d.id,
      d.ship_id AS "shipId",
      d.audit_id AS "auditId",
      d.title,
      d.document_type::text AS kind,
      d.document_date::text AS date,
      d.status::text AS status
    FROM documents d
    ORDER BY d.document_date DESC, d.created_at DESC
  `);

  return ships.map((ship) => ({
    ...ship,
    audits: audits
      .filter((audit) => audit.shipId === ship.shipId)
      .map((audit) => ({
        auditId: audit.auditId,
        auditTitle: audit.auditTitle,
        auditStatus: toAuditStatus(audit.auditStatus),
        auditDate: audit.auditDate,
        documents: docs.filter((doc) => doc.shipId === ship.shipId && doc.auditId === audit.auditId)
      }))
  }));
}

async function getRetentionSettings() {
  const rows = await query(`
    SELECT id, auto_delete_delay_days AS "autoDeleteDelayDays"
    FROM retention_settings
    ORDER BY created_at DESC
    LIMIT 1
  `);
  return rows[0] ?? null;
}

async function bootstrap(userId) {
  const [users, ships, controllers, fleetRecords, documentGroups, retentionSettings] = await Promise.all([
    getUsers(),
    getShipResources(),
    getControllerResources(),
    getFleetRecords(),
    getDocumentGroups(),
    getRetentionSettings()
  ]);

  const currentUser = users.find((user) => user.id === userId) ?? users[0] ?? null;

  return {
    currentUser,
    users,
    ships,
    controllers,
    fleetRecords,
    documentGroups,
    retentionSettings
  };
}

app.get("/api/health", async (_req, res) => {
  const [{ now }] = await query("SELECT NOW() AS now");
  res.json({ ok: true, now });
});

app.get("/api/bootstrap", async (req, res, next) => {
  try {
    res.json(await bootstrap(req.query.userId));
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const username = String(req.body.username ?? "").trim();
    const password = String(req.body.password ?? "");
    const rows = await query(
      `
        SELECT u.id, u.password_hash AS "passwordHash"
        FROM users u
        WHERE u.active = TRUE AND lower(u.username) = lower($1)
        LIMIT 1
      `,
      [username]
    );

    if (!rows[0] || !verifyPassword(password, rows[0].passwordHash)) {
      res.status(401).json({ error: "Identifiants invalides" });
      return;
    }

    await query("UPDATE users SET last_login_at = NOW(), updated_at = NOW() WHERE id = $1", [rows[0].id]);
    res.json(await bootstrap(rows[0].id));
  } catch (error) {
    next(error);
  }
});

app.post("/api/ships", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { code, label, caption, periodicityMonths, lastAuditDate, archiveDocuments, currentUserId } = req.body;
    const shipCode = String(code ?? "").trim();
    const shipLabel = String(label ?? "").trim();
    const homePort = String(caption ?? "").trim();
    const months = Math.max(1, Number(periodicityMonths ?? 1));

    await client.query("BEGIN");
    const existingRows = await client.query(
      `
        SELECT id, active
        FROM ships
        WHERE code = $1
        LIMIT 1
      `,
      [shipCode]
    );

    let shipId;
    if (existingRows.rowCount > 0) {
      if (existingRows.rows[0].active) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Un batiment avec ce code existe deja." });
        return;
      }

      shipId = existingRows.rows[0].id;
      await client.query(
        `
          UPDATE ships
          SET
            name = $2,
            home_port = $3,
            audit_periodicity_months = $4,
            active = TRUE,
            updated_at = NOW()
          WHERE id = $1
        `,
        [shipId, shipLabel, homePort, months]
      );
    } else {
      const shipRows = await client.query(
        `
          INSERT INTO ships (code, name, home_port, audit_periodicity_months)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `,
        [shipCode, shipLabel, homePort, months]
      );
      shipId = shipRows.rows[0].id;
    }

    let auditId = null;

    await mkdir(path.join(storageRoot, normalizeStorageSegment(shipCode || shipId)), { recursive: true });

    if (lastAuditDate) {
      const auditDates = buildAuditDates(lastAuditDate);
      const auditRows = await client.query(
        `
          INSERT INTO audits (
            ship_id, status, title, controller_departure_at, control_start_at, control_end_at, return_to_mainland_at, validated_at, created_by_user_id
          ) VALUES ($1, 'valide', $2, $3, $4, $5, $6, $7, $8)
          RETURNING id
        `,
        [
          shipId,
          `Audit d'archive ${shipLabel}`,
          auditDates.departure,
          auditDates.controlStart,
          auditDates.controlEnd,
          auditDates.returnToMainland,
          auditDates.validatedAt,
          currentUserId ?? null
        ]
      );
      auditId = auditRows.rows[0].id;
    }

    await client.query("COMMIT");

    await storeArchiveDocuments({
      shipId,
      shipCode,
      auditId,
      documents: archiveDocuments,
      documentDate: lastAuditDate || new Date().toISOString().slice(0, 10),
      uploadedByUserId: currentUserId ?? null
    });

    res.status(201).json({ ok: true, id: shipId });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.patch("/api/ships/:id", async (req, res, next) => {
  try {
    const { code, label, caption, periodicityMonths } = req.body;
    await query(
      `
        UPDATE ships
        SET
          code = COALESCE($2, code),
          name = COALESCE($3, name),
          home_port = COALESCE($4, home_port),
          audit_periodicity_months = COALESCE($5, audit_periodicity_months),
          updated_at = NOW()
        WHERE id = $1
      `,
      [req.params.id, code ?? null, label ?? null, caption ? caption.split("•")[0].trim() : null, periodicityMonths ?? null]
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/ships/:id", async (req, res, next) => {
  try {
    await query("UPDATE ships SET active = FALSE, updated_at = NOW() WHERE id = $1", [req.params.id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/ships/:id/activities", async (req, res, next) => {
  try {
    const block = req.body;
    await query(
      `
        INSERT INTO ship_activities (
          ship_id, activity_type, title, description, start_at, end_at, auto_deletable, created_by_user_id
        ) VALUES ($1, $2::activity_type_code, $3, $4, $5, $6, TRUE, $7)
      `,
      [
        req.params.id,
        categoryToShipActivityType(block.activityCategory ?? block.code),
        block.title,
        block.detail ?? null,
        block.start,
        block.end,
        block.createdByUserId ?? null
      ]
    );
    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/ships/:resourceId/activities/:blockId", async (req, res, next) => {
  try {
    await query(
      `
        DELETE FROM ship_activities
        WHERE id = $2 AND ship_id = $1
      `,
      [req.params.resourceId, req.params.blockId]
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/ships/:id/audits", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const block = req.body;
    const start = new Date(block.controlStartAt ?? block.start);
    const end = new Date(block.controlEndAt ?? block.end);
    const departure = new Date(block.controllerDepartureAt ?? block.start ?? start);
    const controlStart = new Date(block.controlStartAt ?? block.start ?? start);
    const controlEnd = new Date(block.controlEndAt ?? block.end ?? end);
    const returnToMainland = new Date(block.returnToMainlandAt ?? block.end ?? end);
    const controllerIds = normalizeControllerIds(block.assignedControllerIds);
    const chronologyError = validateAuditChronology({
      controllerDepartureAt: departure.toISOString(),
      controlStartAt: controlStart.toISOString(),
      controlEndAt: controlEnd.toISOString(),
      returnToMainlandAt: returnToMainland.toISOString()
    });

    if (chronologyError) {
      res.status(400).json({ error: chronologyError });
      return;
    }

    await client.query("BEGIN");
    const rows = await client.query(
      `
        INSERT INTO audits (
          ship_id, status, title, controller_departure_at, control_start_at, control_end_at, return_to_mainland_at, notes, created_by_user_id, validated_at
        ) VALUES ($1, $2::audit_status, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `,
      [
        req.params.id,
        toDbAuditStatus(block.status),
        block.title,
        departure.toISOString(),
        controlStart.toISOString(),
        controlEnd.toISOString(),
        returnToMainland.toISOString(),
        block.detail ?? null,
        block.createdByUserId ?? null,
        block.status === "validated" ? returnToMainland.toISOString() : null
      ]
    );
    await replaceAuditControllers(client, rows.rows[0].id, controllerIds);
    await client.query("COMMIT");
    res.status(201).json({ ok: true, id: rows.rows[0]?.id ?? null });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.patch("/api/audits/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      title,
      detail,
      controllerDepartureAt,
      controlStartAt,
      controlEndAt,
      returnToMainlandAt,
      status,
      assignedControllerIds
    } = req.body;
    const chronologyError = validateAuditChronology({
      controllerDepartureAt,
      controlStartAt,
      controlEndAt,
      returnToMainlandAt
    });

    if (chronologyError) {
      res.status(400).json({ error: chronologyError });
      return;
    }

    await client.query("BEGIN");
    await client.query(
      `
        UPDATE audits
        SET
          title = COALESCE($2, title),
          notes = COALESCE($3, notes),
          controller_departure_at = COALESCE($4, controller_departure_at),
          control_start_at = COALESCE($5, control_start_at),
          control_end_at = COALESCE($6, control_end_at),
          return_to_mainland_at = COALESCE($7, return_to_mainland_at),
          status = COALESCE($8::audit_status, status),
          validated_at = CASE
            WHEN COALESCE($8::audit_status, status) = 'valide' THEN COALESCE($7, return_to_mainland_at, NOW())
            ELSE NULL
          END,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        req.params.id,
        title ?? null,
        detail ?? null,
        controllerDepartureAt ?? null,
        controlStartAt ?? null,
        controlEndAt ?? null,
        returnToMainlandAt ?? null,
        status ? toDbAuditStatus(status) : null
      ]
    );
    if (assignedControllerIds) {
      await replaceAuditControllers(client, req.params.id, normalizeControllerIds(assignedControllerIds));
    }
    await client.query("COMMIT");

    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.delete("/api/audits/:id", async (req, res, next) => {
  try {
    const rows = await query(
      `
        DELETE FROM audits
        WHERE id = $1
          AND status = 'programme'
        RETURNING id
      `,
      [req.params.id]
    );

    if (rows.length === 0) {
      res.status(409).json({ error: "Seuls les audits planifies peuvent etre supprimes." });
      return;
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/controllers", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { code, label, caption } = req.body;
    const controllerCode = String(code ?? "").trim();
    const displayName = String(label ?? "").trim();
    const speciality = String(caption ?? "").trim() || "Controleur";
    const usernameBase = controllerCode.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "controleur";
    const username = `placeholder_${usernameBase}_${Date.now().toString().slice(-6)}`;

    await client.query("BEGIN");
    const userRows = await client.query(
      `
        INSERT INTO users (username, password_hash, display_name, active)
        VALUES ($1, $2, $3, TRUE)
        RETURNING id
      `,
      [username, "pending-setup", displayName]
    );
    const userId = userRows.rows[0].id;

    await client.query(
      `
        INSERT INTO controllers (user_id, grade, matricule, speciality)
        VALUES ($1, $2, $3, $4)
      `,
      [userId, "A definir", controllerCode, speciality]
    );

    await client.query("COMMIT");
    res.status(201).json({ ok: true, id: userId });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.patch("/api/controllers/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const controllerRows = await client.query("SELECT user_id FROM controllers WHERE id = $1", [req.params.id]);
    if (controllerRows.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Controleur introuvable" });
      return;
    }
    const userId = controllerRows.rows[0].user_id;
    const { code, label, caption } = req.body;

    await client.query(
      "UPDATE controllers SET matricule = COALESCE($2, matricule), speciality = COALESCE($3, speciality), updated_at = NOW() WHERE id = $1",
      [req.params.id, code ?? null, caption ?? null]
    );
    await client.query(
      "UPDATE users SET display_name = COALESCE($2, display_name), updated_at = NOW() WHERE id = $1",
      [userId, label ?? null]
    );

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.delete("/api/controllers/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const controllerRows = await client.query("SELECT user_id FROM controllers WHERE id = $1", [req.params.id]);
    if (controllerRows.rowCount === 0) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Controleur introuvable" });
      return;
    }

    await client.query("DELETE FROM audit_controllers WHERE controller_id = $1", [req.params.id]);
    await client.query("UPDATE users SET active = FALSE, updated_at = NOW() WHERE id = $1", [controllerRows.rows[0].user_id]);
    await client.query("COMMIT");
    res.status(204).send();
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.patch("/api/fleet/:id/periodicity", async (req, res, next) => {
  try {
    await query("UPDATE ships SET audit_periodicity_months = $2, updated_at = NOW() WHERE id = $1", [
      req.params.id,
      Math.max(1, Number(req.body.periodicityMonths ?? 1))
    ]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/retention-settings", async (req, res, next) => {
  try {
    await query(
      "UPDATE retention_settings SET auto_delete_delay_days = $1, updated_at = NOW() WHERE id = (SELECT id FROM retention_settings ORDER BY created_at DESC LIMIT 1)",
      [Math.max(1, Number(req.body.autoDeleteDelayDays ?? 180))]
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/audits/:id/documents", async (req, res, next) => {
  try {
    const actor = await getActorProfile(req.body.currentUserId);

    if (!actor || !canUploadDocuments(actor.role)) {
      res.status(403).json({ error: "Le profil courant ne peut pas televerser de documents." });
      return;
    }

    const auditRows = await query(
      `
        SELECT
          a.id,
          a.ship_id AS "shipId",
          s.code AS "shipCode",
          a.control_end_at::date::text AS "auditDate"
        FROM audits a
        JOIN ships s ON s.id = a.ship_id
        WHERE a.id = $1
        LIMIT 1
      `,
      [req.params.id]
    );

    if (!auditRows[0]) {
      res.status(404).json({ error: "Audit introuvable." });
      return;
    }

    if (!canReadShipDocuments(actor, auditRows[0].shipId)) {
      res.status(403).json({ error: "Acces refuse a cet espace documentaire." });
      return;
    }

    await storeAuditDocuments({
      shipId: auditRows[0].shipId,
      shipCode: auditRows[0].shipCode,
      auditId: req.params.id,
      auditDate: auditRows[0].auditDate ?? new Date().toISOString().slice(0, 10),
      documents: req.body.documents,
      uploadedByUserId: actor.id
    });

    res.status(201).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/documents/:id/download", async (req, res, next) => {
  try {
    const actor = await getActorProfile(req.query.userId);

    if (!actor) {
      res.status(403).json({ error: "Acces refuse." });
      return;
    }

    const rows = await query(
      `
        SELECT
          d.id,
          d.ship_id AS "shipId",
          d.title,
          d.storage_path AS "storagePath",
          d.mime_type AS "mimeType"
        FROM documents d
        WHERE d.id = $1
        LIMIT 1
      `,
      [req.params.id]
    );

    if (!rows[0]) {
      res.status(404).json({ error: "Document introuvable." });
      return;
    }

    if (!canReadShipDocuments(actor, rows[0].shipId)) {
      res.status(403).json({ error: "Acces refuse a ce document." });
      return;
    }

    const absolutePath = path.resolve(projectRoot, rows[0].storagePath);
    if (!absolutePath.startsWith(storageRoot)) {
      res.status(400).json({ error: "Chemin de stockage invalide." });
      return;
    }

    res.type(rows[0].mimeType || "application/octet-stream");
    res.download(absolutePath, rows[0].title);
  } catch (error) {
    next(error);
  }
});

app.delete("/api/documents/:id", async (req, res, next) => {
  try {
    const actor = await getActorProfile(req.query.userId);

    if (!actor || !canDeleteDocuments(actor.role)) {
      res.status(403).json({ error: "Seul un administrateur peut supprimer un document." });
      return;
    }

    const rows = await query(
      `
        DELETE FROM documents
        WHERE id = $1
        RETURNING storage_path AS "storagePath"
      `,
      [req.params.id]
    );

    if (!rows[0]) {
      res.status(404).json({ error: "Document introuvable." });
      return;
    }

    const absolutePath = path.resolve(projectRoot, rows[0].storagePath);
    if (absolutePath.startsWith(storageRoot)) {
      await unlink(absolutePath).catch(() => undefined);
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/users", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      username,
      displayName,
      role,
      password,
      controllerId,
      shipId
    } = req.body;

    await client.query("BEGIN");
    const userRows = await client.query(
      `
        INSERT INTO users (username, password_hash, display_name, ship_id, active)
        VALUES ($1, $2, $3, NULL, TRUE)
        RETURNING id
      `,
      [
        String(username ?? "").trim(),
        hashPassword(String(password ?? "").trim() || String(username ?? "").trim()),
        String(displayName ?? "").trim()
      ]
    );

    const userId = userRows.rows[0].id;
    await assignUserRole(client, userId, role);
    await bindUserAssociations(client, userId, role, controllerId ?? null, shipId ?? null);
    await client.query("COMMIT");
    res.status(201).json({ ok: true, id: userId });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.patch("/api/users/:id", async (req, res, next) => {
  const client = await pool.connect();
  try {
    const {
      username,
      displayName,
      role,
      password,
      controllerId,
      shipId
    } = req.body;

    await client.query("BEGIN");
    await client.query(
      `
        UPDATE users
        SET
          username = COALESCE($2, username),
          display_name = COALESCE($3, display_name),
          password_hash = COALESCE($4, password_hash),
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        req.params.id,
        username ? String(username).trim() : null,
        displayName ? String(displayName).trim() : null,
        password ? hashPassword(String(password).trim()) : null
      ]
    );

    if (role) {
      await assignUserRole(client, req.params.id, role);
      await bindUserAssociations(client, req.params.id, role, controllerId ?? null, shipId ?? null);
    }

    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    next(error);
  } finally {
    client.release();
  }
});

app.delete("/api/users/:id", async (req, res, next) => {
  try {
    await query("UPDATE users SET active = FALSE, updated_at = NOW() WHERE id = $1", [req.params.id]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.post("/api/controllers/:id/activities", async (req, res, next) => {
  try {
    const block = req.body;
    await query(
      `
        INSERT INTO controller_activities (
          controller_id, activity_type, title, description, start_at, end_at, visibility_to_planner, auto_deletable
        ) VALUES ($1, $2::activity_type_code, $3, $4, $5, $6, TRUE, TRUE)
      `,
      [
        req.params.id,
        categoryToActivityType(block.activityCategory ?? block.code),
        block.title,
        block.detail ?? null,
        block.start,
        block.end
      ]
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/controllers/:resourceId/activities/:blockId", async (req, res, next) => {
  try {
    await query(
      `
        DELETE FROM controller_activities
        WHERE id = $2 AND controller_id = $1
      `,
      [req.params.resourceId, req.params.blockId]
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

app.patch("/api/timeline/ships/:resourceId/blocks/:blockId", async (req, res, next) => {
  try {
    const { start, end } = req.body;
    const auditRows = await query(
      `
        SELECT controller_departure_at, control_start_at, control_end_at, return_to_mainland_at
        FROM audits
        WHERE id = $2 AND ship_id = $1
      `,
      [req.params.resourceId, req.params.blockId]
    );

    if (auditRows.length > 0) {
      const nextDates = recalculateAuditDatesForTimelineRange(auditRows[0], start, end);
      await query(
        `
          UPDATE audits
          SET
            controller_departure_at = $3,
            control_start_at = $4,
            control_end_at = $5,
            return_to_mainland_at = $6,
            updated_at = NOW()
          WHERE id = $2 AND ship_id = $1
        `,
        [
          req.params.resourceId,
          req.params.blockId,
          nextDates.controllerDepartureAt,
          nextDates.controlStartAt,
          nextDates.controlEndAt,
          nextDates.returnToMainlandAt
        ]
      );
      res.json({ ok: true });
      return;
    }

    const updatedAudit = await query(
      `
        UPDATE audits
        SET
          control_start_at = $3,
          control_end_at = $4,
          controller_departure_at = LEAST(controller_departure_at, $3),
          return_to_mainland_at = GREATEST(return_to_mainland_at, $4),
          updated_at = NOW()
        WHERE id = $2 AND ship_id = $1
        RETURNING id
      `,
      [req.params.resourceId, req.params.blockId, start, end]
    );

    if (updatedAudit.length === 0) {
      await query(
        `
          UPDATE ship_activities
          SET start_at = $3, end_at = $4, updated_at = NOW()
          WHERE id = $2 AND ship_id = $1
        `,
        [req.params.resourceId, req.params.blockId, start, end]
      );
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.patch("/api/timeline/controllers/:resourceId/blocks/:blockId", async (req, res, next) => {
  try {
    const { start, end } = req.body;
    const updatedActivity = await query(
      `
        UPDATE controller_activities
        SET start_at = $3, end_at = $4, updated_at = NOW()
        WHERE id = $2 AND controller_id = $1
        RETURNING id
      `,
      [req.params.resourceId, req.params.blockId, start, end]
    );

    if (updatedActivity.length === 0) {
      res.status(403).json({ error: "Les audits ne sont pas modifiables depuis la frise controleur" });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: "Erreur serveur",
    detail: error instanceof Error ? error.message : String(error)
  });
});

app.listen(port, () => {
  console.log(`API backend disponible sur http://127.0.0.1:${port}`);
});
