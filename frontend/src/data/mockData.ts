import type { AppUserProfile, AuditRecord, ShipDocumentGroup, TimelineResource } from "../types";

function formatDisplayDate(value: string) {
  const date = new Date(value);
  return date.toLocaleDateString("fr-FR");
}

function endOfDeadlineMonth(lastAuditIso: string, periodicityMonths: number) {
  const source = new Date(lastAuditIso);
  return new Date(source.getFullYear(), source.getMonth() + periodicityMonths + 1, 0, 23, 59, 0, 0);
}

function deadlineCaption(lastAuditIso: string, periodicityMonths: number) {
  const deadline = endOfDeadlineMonth(lastAuditIso, periodicityMonths);
  return `${deadline.getDate().toString().padStart(2, "0")}/${`${deadline.getMonth() + 1}`.padStart(2, "0")}/${deadline.getFullYear()}`;
}

export const platformPlanning: TimelineResource[] = [
  {
    id: "bph-01",
    code: "PHA TON",
    label: "Tonnerre",
    caption: `BPH Toulon • echeance ${deadlineCaption("2026-01-05T09:00", 3)}`,
    lastAuditDate: "2026-01-05T09:00",
    periodicityMonths: 3,
    deadlineDate: endOfDeadlineMonth("2026-01-05T09:00", 3).toISOString(),
    latestReport: "CR-2026-014",
    latestHotReport: "CRH-2026-014",
    blocks: [
      {
        id: "audit-ton-1",
        code: "AUD-241",
        title: "Controle pont aviation",
        start: "2026-04-20T07:00",
        end: "2026-04-22T17:00",
        status: "planned",
        kind: "audit",
        crew: ["LCL Martin", "MJR Colin"],
        constraintStatus: "compliant",
        detail: "Audit periodique hangar et pont"
      },
      {
        id: "transit-ton-1",
        code: "TR-2J",
        title: "Transit aller-retour",
        start: "2026-04-19T07:00",
        end: "2026-04-20T07:00",
        status: "warning",
        kind: "transit",
        crew: ["LCL Martin"],
        constraintStatus: "warning",
        detail: "Transit long depuis Hyeres"
      }
    ]
  },
  {
    id: "bph-02",
    code: "PHA MIS",
    label: "Mistral",
    caption: `BPH Brest • echeance ${deadlineCaption("2025-11-12T09:00", 6)}`,
    lastAuditDate: "2025-11-12T09:00",
    periodicityMonths: 6,
    deadlineDate: endOfDeadlineMonth("2025-11-12T09:00", 6).toISOString(),
    latestReport: "CR-2025-089",
    latestHotReport: "CRH-2025-089",
    blocks: [
      {
        id: "audit-mis-1",
        code: "AUD-255",
        title: "Controle soute et securite helis",
        start: "2026-04-25T08:00",
        end: "2026-04-27T16:00",
        status: "draft",
        kind: "audit",
        crew: ["CNE Arnaud"],
        constraintStatus: "warning",
        detail: "Affectation controleur secondaire a confirmer"
      }
    ]
  },
  {
    id: "bph-03",
    code: "PHA DIX",
    label: "Dixmude",
    caption: `BPH Toulon • echeance ${deadlineCaption("2026-04-18T09:00", 6)}`,
    lastAuditDate: "2026-04-18T09:00",
    periodicityMonths: 6,
    deadlineDate: endOfDeadlineMonth("2026-04-18T09:00", 6).toISOString(),
    latestReport: "CR-2026-021",
    latestHotReport: "CRH-2026-021",
    blocks: [
      {
        id: "audit-dix-1",
        code: "AUD-198",
        title: "Controle complet aviation embarquee",
        start: "2026-04-18T06:30",
        end: "2026-04-21T18:00",
        status: "validated",
        kind: "audit",
        crew: ["LCL Martin", "ADC Leroy"],
        constraintStatus: "compliant",
        detail: "Validation en attente de diffusion CR"
      }
    ]
  }
];

export const controllerPlanning: TimelineResource[] = [
  {
    id: "ctrl-1",
    code: "CTL-017",
    label: "LCL Martin",
    caption: "Responsable audits pont aviation",
    blocks: [
      {
        id: "indisp-1",
        code: "MISSION",
        title: "Mission externe",
        start: "2026-04-23T08:00",
        end: "2026-04-24T18:00",
        status: "warning",
        kind: "unavailability",
        constraintStatus: "blocking",
        detail: "Indisponible pour replanification courte"
      },
      {
        id: "ctrl-audit-1",
        code: "AUD-241",
        title: "Tonnerre",
        start: "2026-04-20T07:00",
        end: "2026-04-22T17:00",
        status: "planned",
        kind: "audit",
        constraintStatus: "compliant",
        detail: "Chef de mission"
      }
    ]
  },
  {
    id: "ctrl-2",
    code: "CTL-024",
    label: "MJR Colin",
    caption: "Cellule soutien BPH",
    blocks: [
      {
        id: "ctrl-audit-2",
        code: "AUD-241",
        title: "Tonnerre",
        start: "2026-04-20T07:00",
        end: "2026-04-22T17:00",
        status: "planned",
        kind: "audit",
        constraintStatus: "compliant",
        detail: "Controle structure et fluides"
      }
    ]
  },
  {
    id: "ctrl-3",
    code: "CTL-031",
    label: "CNE Arnaud",
    caption: "Renfort Atlantique",
    blocks: [
      {
        id: "leave-1",
        code: "PERM",
        title: "Permission",
        start: "2026-04-28T00:00",
        end: "2026-04-30T23:55",
        status: "warning",
        kind: "unavailability",
        constraintStatus: "blocking",
        detail: "Permission deja validee"
      }
    ]
  }
];

export const auditTable: AuditRecord[] = [
  {
    id: "bph-01",
    platform: "Tonnerre",
    platformCode: "PHA TON",
    lastAudit: "05/01/2026",
    nextAudit: formatDisplayDate(endOfDeadlineMonth("2026-01-05T09:00", 3).toISOString()),
    controllerLead: "LCL Martin",
    status: "planned",
    periodicityMonths: 3,
    latestReport: "CR-2026-014",
    latestHotReport: "CRH-2026-014"
  },
  {
    id: "bph-02",
    platform: "Mistral",
    platformCode: "PHA MIS",
    lastAudit: "12/11/2025",
    nextAudit: formatDisplayDate(endOfDeadlineMonth("2025-11-12T09:00", 6).toISOString()),
    controllerLead: "CNE Arnaud",
    status: "draft",
    periodicityMonths: 6,
    latestReport: "CR-2025-089",
    latestHotReport: "CRH-2025-089"
  },
  {
    id: "bph-03",
    platform: "Dixmude",
    platformCode: "PHA DIX",
    lastAudit: "18/04/2026",
    nextAudit: formatDisplayDate(endOfDeadlineMonth("2026-04-18T09:00", 6).toISOString()),
    controllerLead: "ADC Leroy",
    status: "validated",
    periodicityMonths: 6,
    latestReport: "CR-2026-021",
    latestHotReport: "CRH-2026-021"
  }
];

export const documentGroups: ShipDocumentGroup[] = [
  {
    shipId: "bph-01",
    shipName: "Tonnerre",
    shipCode: "PHA TON",
    latestReport: "CR-2026-014",
    latestHotReport: "CRH-2026-014",
    audits: [
      {
        auditId: "audit-ton-2026-014",
        auditTitle: "Audit BPH 2026-014",
        auditStatus: "validated",
        auditDate: "2026-01-05",
        documents: [
          { id: "doc-ton-1", auditId: "audit-ton-2026-014", title: "CR-2026-014", kind: "cr", date: "2026-01-05", status: "diffuse" },
          { id: "doc-ton-2", auditId: "audit-ton-2026-014", title: "CRH-2026-014", kind: "cr_chaud", date: "2026-01-05", status: "diffuse" },
          { id: "doc-ton-3", auditId: "audit-ton-2026-014", title: "ANN-2026-014-A", kind: "annexe", date: "2026-01-06", status: "validation" }
        ]
      }
    ]
  },
  {
    shipId: "bph-02",
    shipName: "Mistral",
    shipCode: "PHA MIS",
    latestReport: "CR-2025-089",
    latestHotReport: "CRH-2025-089",
    audits: [
      {
        auditId: "audit-mis-2025-089",
        auditTitle: "Audit BPH 2025-089",
        auditStatus: "validated",
        auditDate: "2025-11-12",
        documents: [
          { id: "doc-mis-1", auditId: "audit-mis-2025-089", title: "CR-2025-089", kind: "cr", date: "2025-11-12", status: "diffuse" },
          { id: "doc-mis-2", auditId: "audit-mis-2025-089", title: "CRH-2025-089", kind: "cr_chaud", date: "2025-11-12", status: "diffuse" }
        ]
      }
    ]
  },
  {
    shipId: "bph-03",
    shipName: "Dixmude",
    shipCode: "PHA DIX",
    latestReport: "CR-2026-021",
    latestHotReport: "CRH-2026-021",
    audits: [
      {
        auditId: "audit-dix-2026-021",
        auditTitle: "Audit BPH 2026-021",
        auditStatus: "validated",
        auditDate: "2026-04-18",
        documents: [
          { id: "doc-dix-1", auditId: "audit-dix-2026-021", title: "CR-2026-021", kind: "cr", date: "2026-04-18", status: "validation" },
          { id: "doc-dix-2", auditId: "audit-dix-2026-021", title: "CRH-2026-021", kind: "cr_chaud", date: "2026-04-18", status: "diffuse" }
        ]
      }
    ]
  }
];

export const mockUsers: AppUserProfile[] = [
  {
    id: "user-admin",
    username: "admin",
    displayName: "Administrateur principal",
    role: "administrateur"
  },
  {
    id: "user-martin",
    username: "martin",
    displayName: "LCL Martin",
    role: "controleur",
    controllerCode: "CTL-017"
  },
  {
    id: "user-planif",
    username: "planif",
    displayName: "CNE Arnaud",
    role: "controleur_planificateur",
    controllerCode: "CTL-031"
  },
  {
    id: "user-avia-ton",
    username: "avia-ton",
    displayName: "Officier AVIA Tonnerre",
    role: "officier_avia_bph",
    shipId: "bph-01",
    shipCode: "PHA TON"
  }
];
