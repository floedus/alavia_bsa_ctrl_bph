export type AuditStatus = "draft" | "planned" | "validated" | "warning";
export type ConstraintStatus = "compliant" | "warning" | "blocking";
export type BlockKind = "audit" | "transit" | "unavailability";

export type TimelineBlock = {
  id: string;
  code: string;
  title: string;
  start: string;
  end: string;
  status: AuditStatus;
  kind: BlockKind;
  controllerDepartureAt?: string;
  controlStartAt?: string;
  controlEndAt?: string;
  returnToMainlandAt?: string;
  assignedControllerIds?: string[];
  activityCategory?: string;
  resourceCode?: string;
  constraintStatus?: ConstraintStatus;
  crew?: string[];
  detail?: string;
};

export type TimelineResource = {
  id: string;
  code: string;
  label: string;
  caption: string;
  lastAuditDate?: string;
  periodicityMonths?: number;
  deadlineDate?: string;
  latestReport?: string;
  latestHotReport?: string;
  blocks: TimelineBlock[];
};

export type AuditRecord = {
  id: string;
  platform: string;
  platformCode: string;
  lastAudit: string;
  nextAudit: string;
  controllerLead: string;
  status: AuditStatus;
  periodicityMonths: number;
  latestReport: string;
  latestHotReport: string;
};

export type ShipDocument = {
  id: string;
  title: string;
  kind: "cr" | "cr_chaud" | "annexe";
  date: string;
  status: "diffuse" | "brouillon" | "validation";
};

export type ShipDocumentGroup = {
  shipId: string;
  shipName: string;
  shipCode: string;
  latestReport: string;
  latestHotReport: string;
  documents: ShipDocument[];
};

export type UserRole =
  | "administrateur"
  | "controleur"
  | "controleur_planificateur"
  | "officier_avia_bph";

export type AppUserProfile = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  controllerId?: string;
  shipId?: string;
  shipName?: string;
  shipCode?: string;
  controllerCode?: string;
};
