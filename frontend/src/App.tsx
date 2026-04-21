import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { DateTimeStepper } from "./components/DateTimeStepper";
import { TimelineBoard } from "./components/TimelineBoard";
import { TopNav, appNavItems, type AppNavigationItem } from "./components/TopNav";
import {
  createController as apiCreateController,
  createControllerActivity as apiCreateControllerActivity,
  createShip as apiCreateShip,
  createShipActivity as apiCreateShipActivity,
  createShipAudit as apiCreateShipAudit,
  createUser as apiCreateUser,
  deleteAudit as apiDeleteAudit,
  deleteControllerActivity as apiDeleteControllerActivity,
  deleteController as apiDeleteController,
  deleteDocument as apiDeleteDocument,
  deleteShipActivity as apiDeleteShipActivity,
  deleteShip as apiDeleteShip,
  deleteUser as apiDeleteUser,
  fetchBootstrap,
  getDocumentDownloadUrl,
  login as apiLogin,
  moveControllerTimelineBlock,
  moveShipTimelineBlock,
  uploadAuditDocuments as apiUploadAuditDocuments,
  updateAudit,
  updateController,
  updateFleetPeriodicity,
  updateRetentionSettings,
  updateShip,
  updateUser as apiUpdateUser
} from "./api";
import { auditTable, controllerPlanning, documentGroups, mockUsers, platformPlanning } from "./data/mockData";
import type { AppUserProfile, AuditRecord, ShipDocument, ShipDocumentGroup, TimelineBlock, TimelineResource, UserRole } from "./types";

const controllerCreationCategories = [
  { code: "PERM", label: "Permission", kind: "unavailability", status: "warning" },
  { code: "STAGE", label: "Stage", kind: "unavailability", status: "warning" },
  { code: "MISSION", label: "Mission", kind: "unavailability", status: "warning" },
  { code: "FORM", label: "Formation", kind: "unavailability", status: "warning" },
  { code: "INDISP", label: "Indisponibilite", kind: "unavailability", status: "warning" },
  { code: "AUTRE", label: "Autre", kind: "unavailability", status: "warning" }
] as const;

const shipCreationCategories = [
  { code: "MAINT", label: "Maintenance", kind: "transit", status: "warning" },
  { code: "EXERC", label: "Exercice", kind: "transit", status: "warning" },
  { code: "MISSION", label: "Mission navire", kind: "transit", status: "warning" },
  { code: "INDNAV", label: "Indisponibilite navire", kind: "unavailability", status: "warning" },
  { code: "AUTRE", label: "Autre activite", kind: "transit", status: "warning" }
] as const;

const auditCreationCategories = [
  { code: "AUDIT", label: "Audit programme", kind: "audit", status: "planned" }
] as const;

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Lecture impossible"));
    reader.readAsDataURL(file);
  });
}

function toDateValue(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateValue(value: string) {
  if (!value) {
    return undefined;
  }

  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function validateAuditChronology(block: TimelineBlock) {
  const departure = new Date(block.controllerDepartureAt ?? "");
  const controlStart = new Date(block.controlStartAt ?? block.start ?? "");
  const controlEnd = new Date(block.controlEndAt ?? block.end ?? "");
  const returnToMainland = new Date(block.returnToMainlandAt ?? "");

  if (
    Number.isNaN(departure.getTime()) ||
    Number.isNaN(controlStart.getTime()) ||
    Number.isNaN(controlEnd.getTime()) ||
    Number.isNaN(returnToMainland.getTime())
  ) {
    return "Toutes les dates de l'audit doivent etre renseignees.";
  }

  if (departure > controlStart) {
    return "La mise en route doit etre inferieure ou egale au debut d'audit.";
  }

  if (controlStart > controlEnd) {
    return "Le debut d'audit doit etre inferieur ou egal a la fin d'audit.";
  }

  if (controlEnd > returnToMainland) {
    return "La fin d'audit doit etre inferieure ou egale au retour metropole.";
  }

  return null;
}

function recalculateAuditBlockFromTimelineRange(block: TimelineBlock, nextRangeStart: string, nextRangeEnd: string): TimelineBlock {
  if (block.kind !== "audit") {
    return { ...block, start: nextRangeStart, end: nextRangeEnd };
  }

  const oldDeparture = new Date(block.controllerDepartureAt ?? block.start);
  const oldControlStart = new Date(block.controlStartAt ?? block.start);
  const oldControlEnd = new Date(block.controlEndAt ?? block.end);
  const oldReturn = new Date(block.returnToMainlandAt ?? block.end);
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
    ...block,
    controllerDepartureAt: nextDeparture.toISOString(),
    start: nextControlStart.toISOString(),
    controlStartAt: nextControlStart.toISOString(),
    end: nextControlEnd.toISOString(),
    controlEndAt: nextControlEnd.toISOString(),
    returnToMainlandAt: nextReturn.toISOString()
  };
}

function cloneResources(resources: TimelineResource[]) {
  return resources.map((resource) => ({
    ...resource,
    blocks: resource.blocks.map((block) => ({ ...block, crew: block.crew ? [...block.crew] : undefined }))
  })) as TimelineResource[];
}

function cloneRecords(records: AuditRecord[]) {
  return records.map((record) => ({ ...record }));
}

function cloneDocumentGroups(groups: ShipDocumentGroup[]) {
  return groups.map((group) => ({
    ...group,
    audits: group.audits.map((audit) => ({
      ...audit,
      documents: audit.documents.map((document) => ({ ...document }))
    }))
  }));
}

function formatDisplayDateFromIso(value: string) {
  return new Date(value).toLocaleDateString("fr-FR");
}

function endOfDeadlineMonth(lastAuditDisplay: string, periodicityMonths: number) {
  const [, month, year] = lastAuditDisplay.split("/").map(Number);
  return new Date(year || 1970, (month || 1) - 1 + periodicityMonths + 1, 0, 23, 59, 0, 0);
}

function buildPlatformCaption(resource: TimelineResource) {
  if (!resource.deadlineDate) {
    return resource.caption;
  }

  const location = resource.caption.split("•")[0]?.trim() ?? resource.caption;
  return `${location} • echeance ${formatDisplayDateFromIso(resource.deadlineDate)}`;
}

function editableShipDescription(caption: string) {
  return caption.split("â€¢")[0]?.trim() ?? caption;
}

function documentKindLabel(kind: ShipDocument["kind"]) {
  switch (kind) {
    case "cr":
      return "CR";
    case "cr_chaud":
      return "CR a chaud";
    default:
      return "Annexe";
  }
}

function uploadDocumentTypeLabel(kind: UploadDocumentType) {
  switch (kind) {
    case "cr_chaud":
      return "Compte-rendu a chaud";
    case "cr":
      return "Compte-rendu d'audit";
    default:
      return "Autre document";
  }
}

function roleLabel(role: UserRole) {
  switch (role) {
    case "administrateur":
      return "Administrateur";
    case "controleur":
      return "Controleur";
    case "controleur_planificateur":
      return "Controleur + planificateur";
    case "officier_avia_bph":
      return "Officier AVIA BPH";
  }
}

function availableNavItemsForRole(role: UserRole): readonly AppNavigationItem[] {
  switch (role) {
    case "administrateur":
      return appNavItems;
    case "controleur":
      return ["Planification BPH", "Controleurs", "Documents"];
    case "controleur_planificateur":
      return ["Planification BPH", "Controleurs", "Vue flotte", "Documents", "Parametres"];
    case "officier_avia_bph":
      return ["Planification BPH", "Documents"];
  }
}

function canPlanAudits(role: UserRole) {
  return role === "administrateur" || role === "controleur_planificateur";
}

function canEditOwnControllerTimeline(role: UserRole) {
  return role === "administrateur" || role === "controleur_planificateur" || role === "controleur";
}

function canUploadDocuments(role: UserRole) {
  return role === "administrateur" || role === "controleur_planificateur" || role === "controleur";
}

function canDeleteDocuments(role: UserRole) {
  return role === "administrateur";
}

type UploadDocumentType = "cr_chaud" | "cr" | "annexe";

export default function App() {
  const [activeTab, setActiveTab] = useState<AppNavigationItem>("Planification BPH");
  const [planningDate, setPlanningDate] = useState("2026-04-20");
  const [timelineZoom, setTimelineZoom] = useState(340);
  const [selectedBlock, setSelectedBlock] = useState<TimelineBlock | null>(null);
  const [platforms, setPlatforms] = useState(() => cloneResources(platformPlanning));
  const [controllers, setControllers] = useState(() => cloneResources(controllerPlanning));
  const [fleetRecords, setFleetRecords] = useState(() => cloneRecords(auditTable));
  const [shipDocuments, setShipDocuments] = useState(() => cloneDocumentGroups(documentGroups));
  const [users, setUsers] = useState<AppUserProfile[]>(mockUsers);
  const [retentionDays, setRetentionDays] = useState(180);
  const [expandedShipId, setExpandedShipId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [planningShipId, setPlanningShipId] = useState<string | null>(null);
  const [planningScrollRatio, setPlanningScrollRatio] = useState(0);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [newShip, setNewShip] = useState({ code: "", label: "", caption: "", periodicityMonths: 12, lastAuditDate: "" });
  const [newController, setNewController] = useState({ code: "", label: "", caption: "" });
  const [newShipArchiveFiles, setNewShipArchiveFiles] = useState<File[]>([]);
  const [shipCreateError, setShipCreateError] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [auditFormError, setAuditFormError] = useState<string | null>(null);
  const [timelineActionError, setTimelineActionError] = useState<string | null>(null);
  const [documentActionError, setDocumentActionError] = useState<string | null>(null);
  const [documentBusyAuditId, setDocumentBusyAuditId] = useState<string | null>(null);
  const [documentUploadAuditId, setDocumentUploadAuditId] = useState<string | null>(null);
  const [documentUploadType, setDocumentUploadType] = useState<UploadDocumentType>("annexe");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [newUser, setNewUser] = useState({
    username: "",
    displayName: "",
    role: "controleur" as UserRole,
    password: "",
    controllerId: "",
    shipId: ""
  });
  const [userPasswordDrafts, setUserPasswordDrafts] = useState<Record<string, string>>({});

  function applyBootstrapPayload(payload: Awaited<ReturnType<typeof fetchBootstrap>>) {
    setUsers(payload.users.length ? payload.users : mockUsers);
    setPlatforms(payload.ships as TimelineResource[]);
    setControllers(payload.controllers as TimelineResource[]);
    setFleetRecords(payload.fleetRecords as AuditRecord[]);
    setShipDocuments(payload.documentGroups as ShipDocumentGroup[]);
    setRetentionDays(payload.retentionSettings?.autoDeleteDelayDays ?? 180);
    if (payload.currentUser?.id) {
      setCurrentUserId(payload.currentUser.id);
      setIsAuthenticated(true);
    }
  }

  async function refreshData(targetUserId?: string) {
    setLoading(true);
    try {
      const payload = await fetchBootstrap(targetUserId ?? currentUserId);
      setBackendAvailable(true);
      setLoadError(null);
      applyBootstrapPayload(payload);
    } catch (error) {
      setBackendAvailable(false);
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  const currentUser = useMemo(
    () => users.find((user) => user.id === currentUserId) ?? users[0] ?? mockUsers[0],
    [currentUserId, users]
  );
  const availableNavItems = useMemo(
    () => availableNavItemsForRole(currentUser.role),
    [currentUser.role]
  );

  useEffect(() => {
    if (!availableNavItems.includes(activeTab)) {
      setActiveTab(availableNavItems[0]);
    }
  }, [activeTab, availableNavItems]);

  useEffect(() => {
    setAuditFormError(null);
  }, [selectedBlock?.id]);

  useEffect(() => {
    if (activeTab !== "Planification BPH" && planningShipId !== null) {
      setPlanningShipId(null);
      setPlanningScrollRatio(0);
    }
  }, [activeTab, planningShipId]);

  const visiblePlatforms = useMemo(() => {
    if (currentUser.role === "officier_avia_bph" && currentUser.shipId) {
      return platforms.filter((resource) => resource.id === currentUser.shipId);
    }
    return platforms;
  }, [currentUser.role, currentUser.shipId, platforms]);

  const visibleControllers = useMemo(() => {
    if (currentUser.role === "controleur" && currentUser.controllerCode) {
      return controllers.filter((resource) => resource.code === currentUser.controllerCode);
    }
    if (currentUser.role === "officier_avia_bph") {
      return [];
    }
    return controllers;
  }, [controllers, currentUser.controllerCode, currentUser.role]);

  const visibleDocuments = useMemo(() => {
    if (currentUser.role === "officier_avia_bph" && currentUser.shipId) {
      return shipDocuments.filter((group) => group.shipId === currentUser.shipId);
    }
    return shipDocuments;
  }, [currentUser.role, currentUser.shipId, shipDocuments]);

  const visibleFleetRecords = useMemo(() => {
    if (currentUser.role === "officier_avia_bph" && currentUser.shipId) {
      return fleetRecords.filter((record) => record.id === currentUser.shipId);
    }
    return fleetRecords;
  }, [currentUser.role, currentUser.shipId, fleetRecords]);

  const selectedResource = useMemo(() => {
    const allResources = [...platforms, ...controllers];
    return allResources.find((resource) => resource.blocks.some((block) => block.id === selectedBlock?.id)) ?? null;
  }, [controllers, platforms, selectedBlock]);

  const selectedResourceLabel = selectedResource ? `${selectedResource.code} • ${selectedResource.label}` : "Aucune selection";
  const selectedShipForPlanning = planningShipId ? visiblePlatforms.find((resource) => resource.id === planningShipId) ?? null : null;
  const sessionSummary = `${currentUser.displayName} • ${roleLabel(currentUser.role)} • ${currentUser.shipCode ?? currentUser.controllerCode ?? "Perimetre global"}`;
  const showTimelineSelection = activeTab === "Planification BPH" || activeTab === "Controleurs";
  const canEditControllerPersonalTimeline = canEditOwnControllerTimeline(currentUser.role);
  const controllerOptions = useMemo(
    () => controllers.map((controller) => ({ id: controller.id, label: `${controller.label} (${controller.code})` })),
    [controllers]
  );
  const shipOptions = useMemo(
    () => platforms.map((ship) => ({ id: ship.id, label: `${ship.label} (${ship.code})` })),
    [platforms]
  );

  function renderDocumentAuditCards(group: ShipDocumentGroup) {
    if (group.audits.length === 0) {
      return <div className="document-empty-state">Aucun audit documente pour ce navire.</div>;
    }

    return group.audits.map((audit) => (
      <section key={audit.auditId} className="document-audit-card">
        <div className="document-audit-head">
          <div className="document-audit-main">
            <strong>{audit.auditTitle}</strong>
            <span>
              {formatDisplayDateFromIso(audit.auditDate)} • {audit.auditStatus === "validated" ? "audit valide" : "audit planifie"}
            </span>
          </div>
          {canUploadDocuments(currentUser.role) ? (
            <div className="document-upload-stack">
              <button
                type="button"
                className="document-upload-button"
                title="Televerser un document"
                onClick={() => {
                  setDocumentActionError(null);
                  setDocumentUploadAuditId((current) => (current === audit.auditId ? null : audit.auditId));
                }}
              >
                {documentBusyAuditId === audit.auditId ? "..." : "⇪"}
              </button>
              {documentUploadAuditId === audit.auditId ? (
                <div className="document-upload-popover">
                  <label className="mission-form">
                    <span className="section-label">Type de document</span>
                    <select
                      value={documentUploadType}
                      onChange={(event) => setDocumentUploadType(event.target.value as UploadDocumentType)}
                    >
                      <option value="cr_chaud">Compte-rendu a chaud</option>
                      <option value="cr">Compte-rendu d'audit</option>
                      <option value="annexe">Autre document</option>
                    </select>
                  </label>
                  <label className="document-file-picker">
                    <span>{uploadDocumentTypeLabel(documentUploadType)}</span>
                    <input
                      type="file"
                      multiple
                      onChange={(event) => {
                        void uploadAuditDocuments(audit.auditId, event.target.files, documentUploadType);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="document-card-grid">
          {audit.documents.length > 0 ? audit.documents.map((document) => (
            <article key={document.id} className="document-card">
              <a
                className="document-download"
                href={backendAvailable ? getDocumentDownloadUrl(document.id, currentUserId) : "#"}
                title="Telecharger"
                onClick={(event) => {
                  if (!backendAvailable) {
                    event.preventDefault();
                  }
                }}
              >
                ↓
              </a>
              {canDeleteDocuments(currentUser.role) ? (
                <button
                  type="button"
                  className="document-delete"
                  title="Supprimer"
                  onClick={() => void deleteDocument(document.id)}
                >
                  ×
                </button>
              ) : null}
              <strong>{document.title}</strong>
              <span>{documentKindLabel(document.kind)}</span>
              <span>{formatDisplayDateFromIso(document.date)}</span>
            </article>
          )) : (
            <div className="document-empty-state">Aucun document associe a cet audit.</div>
          )}
        </div>
      </section>
    ));
  }

  async function submitLogin() {
    setAuthError(null);
    setLoading(true);
    try {
      const payload = await apiLogin(loginUsername, loginPassword);
      setBackendAvailable(true);
      setLoadError(null);
      applyBootstrapPayload(payload);
      setActiveTab("Planification BPH");
      setLoginPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    setIsAuthenticated(false);
    setCurrentUserId("");
    setSelectedBlock(null);
    setPlanningShipId(null);
    setPlatforms(cloneResources(platformPlanning));
    setControllers(cloneResources(controllerPlanning));
    setFleetRecords(cloneRecords(auditTable));
    setShipDocuments(cloneDocumentGroups(documentGroups));
    setUsers(mockUsers);
  }

  async function uploadAuditDocuments(auditId: string, files: FileList | null, documentType: UploadDocumentType) {
    if (!files || files.length === 0 || !backendAvailable) {
      return;
    }

    setDocumentActionError(null);
    setDocumentBusyAuditId(auditId);

    try {
      const documents = await Promise.all(
        Array.from(files).map(async (file) => ({
          name: file.name,
          title: file.name,
          mimeType: file.type || "application/octet-stream",
          base64: await fileToBase64(file),
          documentType
        }))
      );

      await apiUploadAuditDocuments(auditId, { currentUserId, documents });
      setDocumentUploadAuditId(null);
      await refreshData(currentUserId);
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setDocumentBusyAuditId(null);
    }
  }

  async function deleteDocument(documentId: string) {
    if (!backendAvailable) {
      return;
    }

    setDocumentActionError(null);

    try {
      await apiDeleteDocument(documentId, currentUserId);
      await refreshData(currentUserId);
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : String(error));
    }
  }

  async function moveBlock(
    scope: "ships" | "controllers",
    setter: Dispatch<SetStateAction<TimelineResource[]>>,
    resourceId: string,
    blockId: string,
    start: string,
    end: string
  ) {
    let movedBlock: TimelineBlock | null = null;

    setter((current) =>
      current.map((resource) =>
        resource.id !== resourceId
          ? resource
          : {
              ...resource,
              blocks: resource.blocks.map((block) => {
                if (block.id !== blockId) {
                  return block;
                }

                const nextBlock =
                  scope === "ships"
                    ? recalculateAuditBlockFromTimelineRange(block, start, end)
                    : { ...block, start, end };
                movedBlock = nextBlock;
                return nextBlock;
              })
            }
      )
    );

    setSelectedBlock((current) => (current && current.id === blockId ? movedBlock ?? current : current));

    if (backendAvailable) {
      if (scope === "ships") {
        await moveShipTimelineBlock(resourceId, blockId, start, end);
      } else {
        await moveControllerTimelineBlock(resourceId, blockId, start, end);
      }
      await refreshData(currentUserId);
    }
  }

  function updatePeriodicityLocally(shipId: string, periodicityMonths: number) {
    const sanitizedMonths = Math.max(1, periodicityMonths || 1);

    setFleetRecords((current) =>
      current.map((record) =>
        record.id !== shipId
          ? record
          : {
              ...record,
              periodicityMonths: sanitizedMonths,
              nextAudit: formatDisplayDateFromIso(endOfDeadlineMonth(record.lastAudit, sanitizedMonths).toISOString())
            }
      )
    );

    setPlatforms((current) =>
      current.map((resource) => {
        if (resource.id !== shipId || !resource.lastAuditDate) {
          return resource;
        }

        const deadlineDate = endOfDeadlineMonth(formatDisplayDateFromIso(resource.lastAuditDate), sanitizedMonths).toISOString();
        return {
          ...resource,
          periodicityMonths: sanitizedMonths,
          deadlineDate,
          caption: buildPlatformCaption({
            ...resource,
            deadlineDate
          })
        };
      })
    );
  }

  async function persistPeriodicity(shipId: string, periodicityMonths: number) {
    const sanitizedMonths = Math.max(1, periodicityMonths || 1);
    if (backendAvailable) {
      await updateFleetPeriodicity(shipId, sanitizedMonths);
      await refreshData(currentUserId);
    }
  }

  function updatePlatformResourceLocally(resourceId: string, field: "label" | "code" | "caption", value: string) {
    setPlatforms((current) =>
      current.map((resource) => (resource.id === resourceId ? { ...resource, [field]: value } : resource))
    );
  }

  async function persistPlatformResource(resourceId: string) {
    if (backendAvailable) {
      const resource = platforms.find((item) => item.id === resourceId);
      await updateShip(resourceId, {
        code: resource?.code,
        label: resource?.label,
        caption: editableShipDescription(resource?.caption ?? ""),
        periodicityMonths: resource?.periodicityMonths
      });
      await refreshData(currentUserId);
    }
  }

  function updateControllerResourceLocally(resourceId: string, field: "label" | "code" | "caption", value: string) {
    setControllers((current) =>
      current.map((resource) => (resource.id === resourceId ? { ...resource, [field]: value } : resource))
    );
  }

  async function persistControllerResource(resourceId: string) {
    if (backendAvailable) {
      const resource = controllers.find((item) => item.id === resourceId);
      await updateController(resourceId, {
        code: resource?.code,
        label: resource?.label,
        caption: resource?.caption
      });
      await refreshData(currentUserId);
    }
  }

  async function createControllerActivity(resourceId: string, block: TimelineBlock) {
    setControllers((current) =>
      current.map((resource) =>
        resource.id !== resourceId
          ? resource
          : {
              ...resource,
              blocks: [...resource.blocks, block]
            }
      )
    );
    setSelectedBlock(block);

    if (backendAvailable) {
      await apiCreateControllerActivity(resourceId, block);
      await refreshData(currentUserId);
    }
  }

  function updateRetentionDaysLocally(value: number) {
    const sanitized = Math.max(1, value || 1);
    setRetentionDays(sanitized);
  }

  async function persistRetentionDays(value: number) {
    const sanitized = Math.max(1, value || 1);
    if (backendAvailable) {
      await updateRetentionSettings(sanitized);
      await refreshData(currentUserId);
    }
  }

  async function createShipBlock(resourceId: string, block: TimelineBlock) {
    const nextBlock = { ...block, resourceCode: resourceId };

    if (block.kind === "audit") {
      const chronologyError = validateAuditChronology(nextBlock);
      if (chronologyError) {
        setAuditFormError(chronologyError);
        setSelectedBlock(nextBlock);
        return;
      }
      setAuditFormError(null);
    }

    setPlatforms((current) =>
      current.map((resource) =>
        resource.id !== resourceId
          ? resource
          : {
              ...resource,
              blocks: [...resource.blocks, nextBlock]
            }
      )
    );
    setSelectedBlock(nextBlock);

    if (backendAvailable) {
      const payload = { ...nextBlock, createdByUserId: currentUserId };
      if (nextBlock.kind === "audit") {
        await apiCreateShipAudit(resourceId, payload);
      } else {
        await apiCreateShipActivity(resourceId, payload);
      }
      await refreshData(currentUserId);
    }
  }

  async function deleteShipBlock(resourceId: string, blockId: string) {
    const targetBlock = platforms
      .find((resource) => resource.id === resourceId)
      ?.blocks.find((block) => block.id === blockId);

    if (backendAvailable) {
      try {
        if (targetBlock?.kind === "audit") {
          await apiDeleteAudit(blockId);
        } else {
          await apiDeleteShipActivity(resourceId, blockId);
        }
        setTimelineActionError(null);
        await refreshData(currentUserId);
      } catch (error) {
        setTimelineActionError(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    setPlatforms((current) =>
      current.map((resource) =>
        resource.id !== resourceId
          ? resource
          : {
              ...resource,
              blocks: resource.blocks.filter((block) => block.id !== blockId)
            }
      )
    );
    setControllers((current) =>
      current.map((resource) => ({
        ...resource,
        blocks: resource.blocks.filter((block) => block.id !== blockId)
      }))
    );
    setSelectedBlock((current) => (current?.id === blockId ? null : current));
  }

  async function createShipRecord() {
    const code = newShip.code.trim();
    const label = newShip.label.trim();
    const caption = newShip.caption.trim();
    const periodicityMonths = Math.max(1, Number(newShip.periodicityMonths || 1));
    const lastAuditDate = newShip.lastAuditDate.trim();

    if (!code || !label) {
      setShipCreateError("Le code et le nom du batiment sont obligatoires.");
      return;
    }

    setShipCreateError(null);

    const archiveDocuments = await Promise.all(
      newShipArchiveFiles.map(async (file) => ({
        name: file.name,
        title: file.name,
        mimeType: file.type || "application/octet-stream",
        base64: await fileToBase64(file)
      }))
    );

    if (backendAvailable) {
      try {
        await apiCreateShip({ code, label, caption, periodicityMonths, lastAuditDate: lastAuditDate || null, archiveDocuments, currentUserId });
        setNewShip({ code: "", label: "", caption: "", periodicityMonths: 12, lastAuditDate: "" });
        setNewShipArchiveFiles([]);
        await refreshData(currentUserId);
      } catch (error) {
        setShipCreateError(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const id = `ship-${Date.now()}`;
    setPlatforms((current) => [
      ...current,
      {
        id,
        code,
        label,
        caption,
        periodicityMonths,
        lastAuditDate: lastAuditDate || undefined,
        blocks: []
      }
    ]);
    setFleetRecords((current) => [
      ...current,
      {
        id,
        platform: label,
        platformCode: code,
        lastAudit: "-",
        nextAudit: "-",
        controllerLead: "-",
        status: "planned",
        periodicityMonths,
        latestReport: "-",
        latestHotReport: "-"
      }
    ]);
    setNewShip({ code: "", label: "", caption: "", periodicityMonths: 12, lastAuditDate: "" });
    setNewShipArchiveFiles([]);
    setShipCreateError(null);
  }

  async function removeShipRecord(shipId: string) {
    if (backendAvailable) {
      await apiDeleteShip(shipId);
      await refreshData(currentUserId);
      return;
    }

    setPlatforms((current) => current.filter((ship) => ship.id !== shipId));
    setFleetRecords((current) => current.filter((record) => record.id !== shipId));
    setShipDocuments((current) => current.filter((group) => group.shipId !== shipId));
  }

  async function createControllerRecord() {
    const code = newController.code.trim();
    const label = newController.label.trim();
    const caption = newController.caption.trim();

    if (!code || !label) {
      return;
    }

    if (backendAvailable) {
      await apiCreateController({ code, label, caption });
      setNewController({ code: "", label: "", caption: "" });
      await refreshData(currentUserId);
      return;
    }

    setControllers((current) => [
      ...current,
      {
        id: `controller-${Date.now()}`,
        code,
        label,
        caption: caption || "Controleur",
        blocks: []
      }
    ]);
    setNewController({ code: "", label: "", caption: "" });
  }

  async function removeControllerRecord(controllerId: string) {
    if (backendAvailable) {
      await apiDeleteController(controllerId);
      await refreshData(currentUserId);
      return;
    }

    setControllers((current) => current.filter((controller) => controller.id !== controllerId));
  }

  async function deleteControllerBlock(resourceId: string, blockId: string) {
    setControllers((current) =>
      current.map((resource) =>
        resource.id !== resourceId
          ? resource
          : {
              ...resource,
              blocks: resource.blocks.filter((block) => block.id !== blockId)
            }
      )
    );
    setSelectedBlock((current) => (current?.id === blockId ? null : current));

    if (backendAvailable) {
      await apiDeleteControllerActivity(resourceId, blockId);
      await refreshData(currentUserId);
    }
  }

  async function saveSelectedAuditDetails() {
    if (!selectedBlock || selectedBlock.kind !== "audit") {
      return;
    }

    const nextBlock: TimelineBlock = {
      ...selectedBlock,
      start: selectedBlock.controlStartAt ?? selectedBlock.start,
      end: selectedBlock.controlEndAt ?? selectedBlock.end
    };
    const chronologyError = validateAuditChronology(nextBlock);

    if (chronologyError) {
      setAuditFormError(chronologyError);
      return;
    }

    setAuditFormError(null);

    setPlatforms((current) =>
      current.map((resource) => ({
        ...resource,
        blocks: resource.blocks.map((block) => (block.id === nextBlock.id ? { ...block, ...nextBlock } : block))
      }))
    );
    setControllers((current) =>
      current.map((resource) => ({
        ...resource,
        blocks: resource.blocks.map((block) => (block.id === nextBlock.id ? { ...block, ...nextBlock } : block))
      }))
    );
    setSelectedBlock(nextBlock);

    if (backendAvailable) {
      await updateAudit(nextBlock.id, {
        title: nextBlock.title,
        detail: nextBlock.detail,
        status: nextBlock.status,
        controllerDepartureAt: nextBlock.controllerDepartureAt,
        controlStartAt: nextBlock.controlStartAt ?? nextBlock.start,
        controlEndAt: nextBlock.controlEndAt ?? nextBlock.end,
        returnToMainlandAt: nextBlock.returnToMainlandAt,
        assignedControllerIds: nextBlock.assignedControllerIds ?? []
      });
      await refreshData(currentUserId);
    }
  }

  async function createUserRecord() {
    if (!newUser.username.trim() || !newUser.displayName.trim()) {
      return;
    }

    if (backendAvailable) {
      await apiCreateUser({
        username: newUser.username.trim(),
        displayName: newUser.displayName.trim(),
        role: newUser.role,
        password: newUser.password.trim() || newUser.username.trim(),
        controllerId: newUser.controllerId || null,
        shipId: newUser.shipId || null
      });
      setNewUser({ username: "", displayName: "", role: "controleur", password: "", controllerId: "", shipId: "" });
      await refreshData(currentUserId);
    }
  }

  async function saveUserRecord(user: AppUserProfile, password?: string) {
    if (!backendAvailable) {
      return;
    }

    await apiUpdateUser(user.id, {
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      password: password?.trim() ? password.trim() : undefined,
      controllerId: user.controllerId ?? null,
      shipId: user.shipId ?? null
    });
    await refreshData(currentUserId);
  }

  async function removeUserRecord(userId: string) {
    if (!backendAvailable) {
      return;
    }

    await apiDeleteUser(userId);
    await refreshData(currentUserId);
  }

  function renderSelectedBlockPanel() {
    if (!showTimelineSelection) {
      return null;
    }

    const canEditSelectedAudit =
      selectedBlock?.kind === "audit" &&
      canPlanAudits(currentUser.role) &&
      platforms.some((resource) => resource.id === selectedBlock.resourceCode);

    return (
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Bloc selectionne</p>
            <h2>Description de l'activite</h2>
          </div>
        </div>
        {selectedBlock ? (
          <div className="selection-card">
            <div className="date-chip">{selectedResourceLabel}</div>
            {canEditSelectedAudit ? (
              <>
                {auditFormError ? (
                  <div className="auth-banner auth-banner-subtle">
                    <span>{auditFormError}</span>
                  </div>
                ) : null}
                <label className="mission-form">
                  <span className="section-label">Intitule de l'audit</span>
                  <input
                    value={selectedBlock.title}
                    onChange={(event) =>
                      setSelectedBlock((current) => (current && current.kind === "audit" ? { ...current, title: event.target.value } : current))
                    }
                  />
                </label>
                <div className="form-grid">
                  <label className="mission-form">
                    <span className="section-label">Mise en route des controleurs</span>
                    <input
                      type="date"
                      value={toDateValue(selectedBlock.controllerDepartureAt)}
                      onChange={(event) =>
                        setSelectedBlock((current) =>
                          current && current.kind === "audit"
                            ? { ...current, controllerDepartureAt: fromDateValue(event.target.value) }
                            : current
                        )
                      }
                    />
                  </label>
                  <label className="mission-form">
                    <span className="section-label">Debut d'audit</span>
                    <input
                      type="date"
                      value={toDateValue(selectedBlock.controlStartAt ?? selectedBlock.start)}
                      onChange={(event) =>
                        setSelectedBlock((current) =>
                          current && current.kind === "audit"
                            ? {
                                ...current,
                                start: fromDateValue(event.target.value) ?? current.start,
                                controlStartAt: fromDateValue(event.target.value)
                              }
                            : current
                        )
                      }
                    />
                  </label>
                  <label className="mission-form">
                    <span className="section-label">Fin d'audit</span>
                    <input
                      type="date"
                      value={toDateValue(selectedBlock.controlEndAt ?? selectedBlock.end)}
                      onChange={(event) =>
                        setSelectedBlock((current) =>
                          current && current.kind === "audit"
                            ? {
                                ...current,
                                end: fromDateValue(event.target.value) ?? current.end,
                                controlEndAt: fromDateValue(event.target.value)
                              }
                            : current
                        )
                      }
                    />
                  </label>
                  <label className="mission-form">
                    <span className="section-label">Retour en metropole</span>
                    <input
                      type="date"
                      value={toDateValue(selectedBlock.returnToMainlandAt)}
                      onChange={(event) =>
                        setSelectedBlock((current) =>
                          current && current.kind === "audit"
                            ? { ...current, returnToMainlandAt: fromDateValue(event.target.value) }
                            : current
                        )
                      }
                    />
                  </label>
                  <label className="mission-form">
                    <span className="section-label">Statut</span>
                    <select
                      value={selectedBlock.status}
                      onChange={(event) =>
                        setSelectedBlock((current) =>
                          current && current.kind === "audit"
                            ? { ...current, status: event.target.value as TimelineBlock["status"] }
                            : current
                        )
                      }
                    >
                      <option value="planned">Planifie</option>
                      <option value="validated">Valide</option>
                    </select>
                  </label>
                  <label className="mission-form">
                    <span className="section-label">Controleurs affectes</span>
                    <div className="checkbox-list">
                      {controllerOptions.map((controller) => {
                        const checked = (selectedBlock.assignedControllerIds ?? []).includes(controller.id);
                        return (
                          <label key={controller.id} className="checkbox-list-item">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const currentIds = selectedBlock.assignedControllerIds ?? [];
                                const nextIds = event.target.checked
                                  ? [...currentIds, controller.id]
                                  : currentIds.filter((id) => id !== controller.id);
                                const uniqueIds = [...new Set(nextIds)];

                                setSelectedBlock((current) =>
                                  current && current.kind === "audit"
                                    ? {
                                        ...current,
                                        assignedControllerIds: uniqueIds,
                                        crew: controllers
                                          .filter((entry) => uniqueIds.includes(entry.id))
                                          .map((entry) => entry.label)
                                      }
                                    : current
                                );
                              }}
                            />
                            <span>{controller.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </label>
                </div>
                <label className="mission-form">
                  <span className="section-label">Notes</span>
                  <textarea
                    value={selectedBlock.detail ?? ""}
                    onChange={(event) =>
                      setSelectedBlock((current) => (current && current.kind === "audit" ? { ...current, detail: event.target.value } : current))
                    }
                    rows={4}
                  />
                </label>
                <div className="ship-card-actions">
                  <div className={`status ${selectedBlock.status}`}>{selectedBlock.status}</div>
                  <button type="button" className="primary-button compact-button" onClick={() => void saveSelectedAuditDetails()}>
                    Enregistrer l'audit
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3>{selectedBlock.title}</h3>
                <p className="section-label">{selectedBlock.code}</p>
                <ul className="simple-list">
                  <li>Debut<span>{toDateValue(selectedBlock.start).split("-").reverse().join("/")}</span></li>
                  <li>Fin<span>{toDateValue(selectedBlock.end).split("-").reverse().join("/")}</span></li>
                  <li>Statut<span className={`status ${selectedBlock.status}`}>{selectedBlock.status}</span></li>
                  {selectedBlock.activityCategory ? <li>Categorie<span>{selectedBlock.activityCategory}</span></li> : null}
                  <li>Details<span>{selectedBlock.detail ?? "Aucun detail complementaire"}</span></li>
                  {selectedResource?.latestReport ? <li>Dernier CR<span>{selectedResource.latestReport}</span></li> : null}
                  {selectedResource?.latestHotReport ? <li>Dernier CR a chaud<span>{selectedResource.latestHotReport}</span></li> : null}
                </ul>
              </>
            )}
          </div>
        ) : (
          <div className="auth-state-card">Selectionnez un bloc dans la frise pour afficher son detail.</div>
        )}
      </section>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app-shell">
        <main className="workspace">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Acces securise</p>
                <h2>Connexion a la planification BPH</h2>
              </div>
            </div>
            <div className="selection-card">
              <label className="mission-form">
                <span className="section-label">Identifiant</span>
                <input value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} />
              </label>
              <label className="mission-form">
                <span className="section-label">Mot de passe</span>
                <input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} />
              </label>
              {authError ? <div className="auth-banner auth-banner-subtle"><span>{authError}</span></div> : null}
              {loadError ? <div className="auth-banner auth-banner-subtle"><span>API indisponible: {loadError}</span></div> : null}
              <div className="ship-card-actions">
                <button type="button" className="primary-button" onClick={() => void submitLogin()} disabled={loading}>
                  {loading ? "Connexion..." : "Se connecter"}
                </button>
              </div>
            </div>
          </section>
        </main>
        <div className="app-credit">Développement - Conception Codex : CV Florian Edus</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-brand">
          <div className="hero-cocarde app-monogram hero-cocarde-image" />
          <div>
            <p className="eyebrow">Marine Nationale • ALAVIA</p>
            <h1>Planification BSA des controles aeronautiques BPH</h1>
            <p className="hero-context">{sessionSummary}</p>
          </div>
        </div>
        <div className="hero-actions hero-actions-stack">
          <button className="secondary-button" onClick={logout}>Deconnexion</button>
        </div>
      </header>

      {loadError ? (
        <section className="panel">
          <div className="auth-banner auth-banner-subtle">
            <strong>Backend non joignable</strong>
            <span>
              Synchronisation impossible avec l'API. Erreur: {loadError}
            </span>
          </div>
        </section>
      ) : null}

      {timelineActionError ? (
        <section className="panel">
          <div className="auth-banner auth-banner-subtle">
            <strong>Action impossible</strong>
            <span>{timelineActionError}</span>
          </div>
        </section>
      ) : null}

      <TopNav activeItem={activeTab} onChange={setActiveTab} items={availableNavItems} />

      <main className="workspace">
        {loading ? <section className="panel"><div className="auth-state-card">Chargement des donnees...</div></section> : null}
        <section className="stack">
          {activeTab === "Planification BPH" ? (
            <>
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Navigation metier</p>
                    <h2>Batiments suivis</h2>
                  </div>
                  <div className="date-chip">{canPlanAudits(currentUser.role) ? "Planification activee" : "Lecture seule sur les navires"}</div>
                </div>
                <div className="ship-card-grid">
                  {visiblePlatforms.map((ship) => (
                    <article key={ship.id} className="ship-card">
                      <div className="ship-card-head">
                        <div>
                          <strong>{ship.label}</strong>
                          <span>{ship.code}</span>
                        </div>
                        <span className="status planned">{ship.periodicityMonths ?? "-"} mois</span>
                      </div>
                      <p>{ship.caption}</p>
                      <div className="ship-card-actions">
                        {ship.latestReport ? <button className="secondary-button compact-button">{ship.latestReport}</button> : null}
                        {ship.latestHotReport ? <button className="secondary-button compact-button">{ship.latestHotReport}</button> : null}
                        {canPlanAudits(currentUser.role) ? (
                          <button
                            className="primary-button compact-button"
                            onClick={() => {
                              setPlanningShipId((current) => (current === ship.id ? null : ship.id));
                              setPlanningScrollRatio(0);
                            }}
                          >
                            {planningShipId === ship.id ? "Quitter le mode audit" : "Planifier un audit"}
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              {selectedShipForPlanning ? (
                <section className="stack">
                  <section className="panel">
                    <div className="panel-header">
                      <div>
                        <p className="eyebrow">Mode dedie</p>
                        <h2>Planifier un audit • {selectedShipForPlanning.label}</h2>
                      </div>
                      <button className="secondary-button compact-button" onClick={() => setPlanningShipId(null)}>
                        Revenir a la vue globale
                      </button>
                    </div>
                    <p className="section-label">
                      Cette vue juxtapose la frise du bateau et les frises controleurs. Le zoom et le scroll horizontal y sont lies.
                    </p>
                  </section>

                  <TimelineBoard
                    title="Frise commune de planification"
                    eyebrow="Repere mutualise"
                    date={planningDate}
                    timezoneLabel="Theatre France • UTC +02:00"
                    zoom={timelineZoom}
                    resources={[]}
                    selectedBlockId={selectedBlock?.id ?? null}
                    onSelectBlock={setSelectedBlock}
                    onDateChange={setPlanningDate}
                    onZoomChange={setTimelineZoom}
                    onMoveBlock={() => undefined}
                    readOnly={!canPlanAudits(currentUser.role)}
                    externalScrollRatio={planningScrollRatio}
                    onScrollRatioChange={setPlanningScrollRatio}
                  />

                  <TimelineBoard
                    title={`Frise navire • ${selectedShipForPlanning.label}`}
                    eyebrow="Audit a planifier"
                    date={planningDate}
                    timezoneLabel="Theatre France • UTC +02:00"
                    zoom={timelineZoom}
                    resources={[selectedShipForPlanning]}
                    selectedBlockId={selectedBlock?.id ?? null}
                    onSelectBlock={setSelectedBlock}
                    onDateChange={setPlanningDate}
                    onZoomChange={setTimelineZoom}
                    onMoveBlock={(resourceId, blockId, start, end) => void moveBlock("ships", setPlatforms, resourceId, blockId, start, end)}
                    readOnly={!canPlanAudits(currentUser.role)}
                    externalScrollRatio={planningScrollRatio}
                    onScrollRatioChange={setPlanningScrollRatio}
                    headerMode="title-only"
                    showScaleHeader={false}
                    creationCategories={canPlanAudits(currentUser.role) ? auditCreationCategories : []}
                    onCreateBlock={canPlanAudits(currentUser.role) ? (resourceId, block) => void createShipBlock(resourceId, { ...block, kind: "audit", status: "planned" }) : undefined}
                    onDeleteBlock={(resourceId, blockId) => void deleteShipBlock(resourceId, blockId)}
                    canDeleteBlock={(block) => block.kind !== "audit" || block.status === "planned"}
                  />

                  {visibleControllers.length ? (
                    <TimelineBoard
                      title="Frises controleurs"
                      eyebrow="Lecture croisee"
                      date={planningDate}
                      timezoneLabel="Theatre France • UTC +02:00"
                      zoom={timelineZoom}
                      resources={visibleControllers}
                      selectedBlockId={selectedBlock?.id ?? null}
                      onSelectBlock={setSelectedBlock}
                      onDateChange={setPlanningDate}
                      onZoomChange={setTimelineZoom}
                    onMoveBlock={(resourceId, blockId, start, end) => void moveBlock("controllers", setControllers, resourceId, blockId, start, end)}
                    readOnly={currentUser.role !== "administrateur" && currentUser.role !== "controleur_planificateur"}
                    externalScrollRatio={planningScrollRatio}
                    onScrollRatioChange={setPlanningScrollRatio}
                    creationCategories={controllerCreationCategories}
                    onCreateBlock={(resourceId, block) => void createControllerActivity(resourceId, block)}
                    onDeleteBlock={(resourceId, blockId) => void deleteControllerBlock(resourceId, blockId)}
                    blockEditPolicy="activities-only"
                    headerMode="title-only"
                    showScaleHeader={false}
                  />
                  ) : null}

                  {renderSelectedBlockPanel()}
                </section>
              ) : (
                <>
                  <TimelineBoard
                    title="Planning des plateformes BPH"
                    eyebrow="Frise principale"
                    date={planningDate}
                    timezoneLabel="Theatre France • UTC +02:00"
                    zoom={timelineZoom}
                    resources={visiblePlatforms}
                    selectedBlockId={selectedBlock?.id ?? null}
                    onSelectBlock={setSelectedBlock}
                    onDateChange={setPlanningDate}
                    onZoomChange={setTimelineZoom}
                    onMoveBlock={(resourceId, blockId, start, end) => void moveBlock("ships", setPlatforms, resourceId, blockId, start, end)}
                    readOnly={currentUser.role === "controleur" || currentUser.role === "officier_avia_bph"}
                    creationCategories={currentUser.role === "controleur" || currentUser.role === "officier_avia_bph" ? [] : shipCreationCategories}
                    onCreateBlock={currentUser.role === "controleur" || currentUser.role === "officier_avia_bph" ? undefined : (resourceId, block) => void createShipBlock(resourceId, block)}
                    onDeleteBlock={(resourceId, blockId) => void deleteShipBlock(resourceId, blockId)}
                    canDeleteBlock={(block) => block.kind !== "audit"}
                  />
                  {renderSelectedBlockPanel()}
                </>
              )}
            </>
          ) : null}

          {activeTab === "Controleurs" ? (
            <>
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Mode personnel</p>
                    <h2>Renseignement d'activite controleur</h2>
                  </div>
                  <div className="date-chip">
                    {currentUser.role === "controleur" ? "Edition de votre frise personnelle" : "Edition selon votre profil"}
                  </div>
                </div>
                <p className="section-label">
                  Le profil controleur peut renseigner ses propres activites sur cette frise, avec creation, deplacement et suppression.
                </p>
              </section>
              <TimelineBoard
                title="Planning des controleurs"
                eyebrow="Disponibilites personnel"
                date={planningDate}
                timezoneLabel="Theatre France • UTC +02:00"
                zoom={timelineZoom}
                resources={visibleControllers}
                selectedBlockId={selectedBlock?.id ?? null}
                onSelectBlock={setSelectedBlock}
                onDateChange={setPlanningDate}
                onZoomChange={setTimelineZoom}
                onMoveBlock={(resourceId, blockId, start, end) => void moveBlock("controllers", setControllers, resourceId, blockId, start, end)}
                readOnly={!canEditControllerPersonalTimeline}
                creationCategories={canEditControllerPersonalTimeline ? controllerCreationCategories : []}
                onCreateBlock={canEditControllerPersonalTimeline ? (resourceId, block) => void createControllerActivity(resourceId, block) : undefined}
                onDeleteBlock={canEditControllerPersonalTimeline ? (resourceId, blockId) => void deleteControllerBlock(resourceId, blockId) : undefined}
                blockEditPolicy="activities-only"
              />
              {renderSelectedBlockPanel()}
            </>
          ) : null}

          {activeTab === "Vue flotte" ? (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Synthese flotte</p>
                  <h2>Vue globale des navires et des audits</h2>
                </div>
                <div className="date-chip">Lecture de l'echeance calculee</div>
              </div>
              <div className="activity-table-scroll">
                <table className="data-table activity-table">
                  <thead>
                    <tr>
                      <th>Plateforme</th>
                      <th>Dernier audit valide</th>
                      <th>Echeance</th>
                      <th>Controleur prevu</th>
                      <th>Dernier CR</th>
                      <th>Dernier CR a chaud</th>
                      <th>Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleFleetRecords.map((record) => (
                      <tr key={record.id}>
                        <td>{record.platform}</td>
                        <td>{record.lastAudit}</td>
                        <td>{record.nextAudit}</td>
                        <td>{record.controllerLead}</td>
                        <td><button className="secondary-button compact-button">{record.latestReport}</button></td>
                        <td><button className="secondary-button compact-button">{record.latestHotReport}</button></td>
                        <td className={`status ${record.status}`}>{record.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {activeTab === "Documents" ? (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Archivage</p>
                  <h2>Documents classes par navire et par audit</h2>
                </div>
                <div className="date-chip">
                  {currentUser.role === "officier_avia_bph" ? "Historique limite au bateau associe" : "Espaces documentaires replies par defaut"}
                </div>
              </div>
              {documentActionError ? (
                <div className="auth-banner auth-banner-subtle">
                  <strong>Documents</strong>
                  <span>{documentActionError}</span>
                </div>
              ) : null}
              <div className="documents-tree">
                {visibleDocuments.map((group) => {
                  const expanded = expandedShipId === group.shipId;
                  return (
                    <section key={group.shipId} className="document-ship-card">
                      <button
                        type="button"
                        className="document-ship-toggle"
                        onClick={() => setExpandedShipId(expanded ? null : group.shipId)}
                        aria-expanded={expanded}
                      >
                        <span className={`document-chevron ${expanded ? "expanded" : ""}`}>▸</span>
                        <span className="document-ship-main">
                          <strong>{group.shipName}</strong>
                          <span>{group.shipCode} • dernier CR {group.latestReport} • dernier CR a chaud {group.latestHotReport}</span>
                        </span>
                      </button>
                      {expanded ? (
                        <div className="document-ship-body">
                          <div className="document-ship-summary">
                            <button className="secondary-button compact-button">{group.latestReport}</button>
                            <button className="secondary-button compact-button">{group.latestHotReport}</button>
                          </div>
                          <div className="document-audit-stack">
                            {renderDocumentAuditCards(group)}
                          </div>
                        </div>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            </section>
          ) : null}

          {activeTab === "Parametres" ? (
            <section className="stack">
              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Referentiel flotte</p>
                    <h2>Base des batiments</h2>
                  </div>
                </div>
                <div className="form-grid">
                  <label className="mission-form">
                    <span className="section-label">Code</span>
                    <input value={newShip.code} onChange={(event) => setNewShip((current) => ({ ...current, code: event.target.value }))} />
                  </label>
                  <label className="mission-form">
                    <span className="section-label">Nom</span>
                    <input value={newShip.label} onChange={(event) => setNewShip((current) => ({ ...current, label: event.target.value }))} />
                  </label>
                  <label className="mission-form">
                    <span className="section-label">Description / port-base</span>
                    <input value={newShip.caption} onChange={(event) => setNewShip((current) => ({ ...current, caption: event.target.value }))} />
                  </label>
                  <label className="mission-form">
                    <span className="section-label">Validite (mois)</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={newShip.periodicityMonths}
                      onChange={(event) => setNewShip((current) => ({ ...current, periodicityMonths: Number(event.target.value) }))}
                    />
                  </label>
                  <label className="mission-form">
                    <span className="section-label">Date du dernier audit</span>
                    <input
                      type="date"
                      value={newShip.lastAuditDate}
                      onChange={(event) => setNewShip((current) => ({ ...current, lastAuditDate: event.target.value }))}
                    />
                  </label>
                  <label className="mission-form">
                    <span className="section-label">Documents d'archive</span>
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                      onChange={(event) => setNewShipArchiveFiles(Array.from(event.target.files ?? []))}
                    />
                  </label>
                </div>
                <div className="ship-card-actions">
                  <button type="button" className="primary-button compact-button" onClick={() => void createShipRecord()}>
                    Creer un batiment
                  </button>
                  {newShipArchiveFiles.length ? <span className="date-chip">{newShipArchiveFiles.length} document(s) pret(s)</span> : null}
                </div>
                {shipCreateError ? (
                  <div className="auth-banner auth-banner-subtle">
                    <span>{shipCreateError}</span>
                  </div>
                ) : null}
                <div className="activity-table-scroll">
                  <table className="data-table activity-table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Nom</th>
                        <th>Description</th>
                        <th>Validite (mois)</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {platforms.map((ship) => (
                        <tr key={ship.id}>
                          <td><input value={ship.code} onChange={(event) => updatePlatformResourceLocally(ship.id, "code", event.target.value)} onBlur={() => void persistPlatformResource(ship.id)} /></td>
                          <td><input value={ship.label} onChange={(event) => updatePlatformResourceLocally(ship.id, "label", event.target.value)} onBlur={() => void persistPlatformResource(ship.id)} /></td>
                          <td><input value={editableShipDescription(ship.caption)} onChange={(event) => updatePlatformResourceLocally(ship.id, "caption", event.target.value)} onBlur={() => void persistPlatformResource(ship.id)} /></td>
                          <td>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={ship.periodicityMonths ?? 1}
                              onChange={(event) => updatePeriodicityLocally(ship.id, Number(event.target.value))}
                              onBlur={(event) => void persistPeriodicity(ship.id, Number(event.target.value))}
                            />
                          </td>
                          <td>
                            <button type="button" className="secondary-button compact-button" onClick={() => void removeShipRecord(ship.id)}>
                              Supprimer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Referentiel controleurs</p>
                    <h2>Base des controleurs</h2>
                  </div>
                </div>
                <div className="form-grid">
                  <label className="mission-form">
                    <span className="section-label">Matricule</span>
                    <input value={newController.code} onChange={(event) => setNewController((current) => ({ ...current, code: event.target.value }))} />
                  </label>
                  <label className="mission-form">
                    <span className="section-label">Nom</span>
                    <input value={newController.label} onChange={(event) => setNewController((current) => ({ ...current, label: event.target.value }))} />
                  </label>
                  <label className="mission-form">
                    <span className="section-label">Fonction</span>
                    <input value={newController.caption} onChange={(event) => setNewController((current) => ({ ...current, caption: event.target.value }))} />
                  </label>
                </div>
                <div className="ship-card-actions">
                  <button type="button" className="primary-button compact-button" onClick={() => void createControllerRecord()}>
                    Creer un controleur
                  </button>
                </div>
                <div className="activity-table-scroll">
                  <table className="data-table activity-table">
                    <thead>
                      <tr>
                        <th>Matricule</th>
                        <th>Nom</th>
                        <th>Fonction</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {controllers.map((controller) => (
                        <tr key={controller.id}>
                          <td><input value={controller.code} onChange={(event) => updateControllerResourceLocally(controller.id, "code", event.target.value)} onBlur={() => void persistControllerResource(controller.id)} /></td>
                          <td><input value={controller.label} onChange={(event) => updateControllerResourceLocally(controller.id, "label", event.target.value)} onBlur={() => void persistControllerResource(controller.id)} /></td>
                          <td><input value={controller.caption} onChange={(event) => updateControllerResourceLocally(controller.id, "caption", event.target.value)} onBlur={() => void persistControllerResource(controller.id)} /></td>
                          <td>
                            <button type="button" className="secondary-button compact-button" onClick={() => void removeControllerRecord(controller.id)}>
                              Supprimer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Parametrage</p>
                    <h2>Configuration metier</h2>
                  </div>
                </div>
                <div className="form-grid">
                  <label className="mission-form">
                    <span className="section-label">Delai de purge automatique</span>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={retentionDays}
                      onChange={(event) => updateRetentionDaysLocally(Number(event.target.value))}
                      onBlur={(event) => void persistRetentionDays(Number(event.target.value))}
                    />
                  </label>
                  <DateTimeStepper
                    label="Prochaine bascule planning"
                    value="2026-04-20T08:00"
                    onChange={() => undefined}
                    stepMinutes={30}
                  />
                </div>
                <p className="section-label">
                  La purge automatique ne concerne que les activites navires et controleurs hors audits. Les audits et les documents ne sont jamais purges automatiquement.
                </p>
              </section>
            </section>
          ) : null}

          {activeTab === "Utilisateurs" ? (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Administration</p>
                  <h2>Gestion des utilisateurs</h2>
                </div>
              </div>
              <div className="form-grid">
                <label className="mission-form">
                  <span className="section-label">Identifiant</span>
                  <input value={newUser.username} onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))} />
                </label>
                <label className="mission-form">
                  <span className="section-label">Nom affiche</span>
                  <input value={newUser.displayName} onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))} />
                </label>
                <label className="mission-form">
                  <span className="section-label">Profil</span>
                  <select value={newUser.role} onChange={(event) => setNewUser((current) => ({ ...current, role: event.target.value as UserRole }))}>
                    <option value="administrateur">Administrateur</option>
                    <option value="controleur">Controleur</option>
                    <option value="controleur_planificateur">Controleur + planificateur</option>
                    <option value="officier_avia_bph">Officier AVIA BPH</option>
                  </select>
                </label>
                <label className="mission-form">
                  <span className="section-label">Mot de passe initial</span>
                  <input type="password" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} />
                </label>
                <label className="mission-form">
                  <span className="section-label">Fusion controleur</span>
                  <select value={newUser.controllerId} onChange={(event) => setNewUser((current) => ({ ...current, controllerId: event.target.value }))}>
                    <option value="">Aucune</option>
                    {controllerOptions.map((controller) => (
                      <option key={controller.id} value={controller.id}>{controller.label}</option>
                    ))}
                  </select>
                </label>
                <label className="mission-form">
                  <span className="section-label">Fusion navire</span>
                  <select value={newUser.shipId} onChange={(event) => setNewUser((current) => ({ ...current, shipId: event.target.value }))}>
                    <option value="">Aucune</option>
                    {shipOptions.map((ship) => (
                      <option key={ship.id} value={ship.id}>{ship.label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="ship-card-actions">
                <button type="button" className="primary-button compact-button" onClick={() => void createUserRecord()}>
                  Creer un utilisateur
                </button>
              </div>
              <div className="activity-table-scroll">
                <table className="data-table activity-table">
                  <thead>
                    <tr>
                      <th>Identifiant</th>
                      <th>Nom</th>
                      <th>Profil</th>
                      <th>Controleur</th>
                      <th>Navire</th>
                      <th>Mot de passe</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td><input value={user.username} onChange={(event) => setUsers((current) => current.map((entry) => (entry.id === user.id ? { ...entry, username: event.target.value } : entry)))} /></td>
                        <td><input value={user.displayName} onChange={(event) => setUsers((current) => current.map((entry) => (entry.id === user.id ? { ...entry, displayName: event.target.value } : entry)))} /></td>
                        <td>
                          <select value={user.role} onChange={(event) => setUsers((current) => current.map((entry) => (entry.id === user.id ? { ...entry, role: event.target.value as UserRole } : entry)))}>
                            <option value="administrateur">Administrateur</option>
                            <option value="controleur">Controleur</option>
                            <option value="controleur_planificateur">Controleur + planificateur</option>
                            <option value="officier_avia_bph">Officier AVIA BPH</option>
                          </select>
                        </td>
                        <td>
                          <select value={user.controllerId ?? ""} onChange={(event) => setUsers((current) => current.map((entry) => (entry.id === user.id ? { ...entry, controllerId: event.target.value || undefined } : entry)))}>
                            <option value="">Aucune</option>
                            {controllerOptions.map((controller) => (
                              <option key={controller.id} value={controller.id}>{controller.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select value={user.shipId ?? ""} onChange={(event) => setUsers((current) => current.map((entry) => (entry.id === user.id ? { ...entry, shipId: event.target.value || undefined } : entry)))}>
                            <option value="">Aucune</option>
                            {shipOptions.map((ship) => (
                              <option key={ship.id} value={ship.id}>{ship.label}</option>
                            ))}
                          </select>
                        </td>
                        <td><input type="password" placeholder="Nouveau mot de passe" value={userPasswordDrafts[user.id] ?? ""} onChange={(event) => setUserPasswordDrafts((current) => ({ ...current, [user.id]: event.target.value }))} /></td>
                        <td>
                          <div className="ship-card-actions">
                            <button type="button" className="secondary-button compact-button" onClick={() => void saveUserRecord(user, userPasswordDrafts[user.id])}>Enregistrer</button>
                            <button type="button" className="secondary-button compact-button" onClick={() => void removeUserRecord(user.id)}>Supprimer</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="simple-list" hidden>
                {users.map((user) => (
                  <li key={user.id}>
                    {user.displayName}
                    <span>{user.username} • {roleLabel(user.role)}{user.shipCode ? ` • ${user.shipCode}` : ""}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </section>
      </main>
      <div className="app-credit">Développement - Conception Codex : CV Florian Edus</div>
    </div>
  );
}
