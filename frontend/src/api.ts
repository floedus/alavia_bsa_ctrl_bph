import type { AppUserProfile, TimelineBlock } from "./types";

const apiBaseUrl = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8081/api").replace(/\/$/, "");

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail ?? error.error ?? `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export type BootstrapPayload = {
  currentUser: AppUserProfile | null;
  users: AppUserProfile[];
  ships: unknown[];
  controllers: unknown[];
  fleetRecords: unknown[];
  documentGroups: unknown[];
  retentionSettings: { autoDeleteDelayDays: number } | null;
};

export type LoginPayload = {
  currentUser: AppUserProfile;
  users: AppUserProfile[];
  ships: unknown[];
  controllers: unknown[];
  fleetRecords: unknown[];
  documentGroups: unknown[];
  retentionSettings: { autoDeleteDelayDays: number } | null;
};

export function login(username: string, password: string) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  }) as Promise<LoginPayload>;
}

export function changePassword(username: string, currentPassword: string, nextPassword: string) {
  return request("/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ username, currentPassword, nextPassword })
  });
}

export function fetchBootstrap(userId?: string) {
  const suffix = userId ? `?userId=${encodeURIComponent(userId)}` : "";
  return request(`/bootstrap${suffix}`) as Promise<BootstrapPayload>;
}

export function updateShip(id: string, payload: Record<string, unknown>) {
  return request(`/ships/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function createShip(payload: Record<string, unknown>) {
  return request("/ships", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteShip(id: string) {
  return request(`/ships/${id}`, {
    method: "DELETE"
  });
}

export function createShipActivity(resourceId: string, block: TimelineBlock & { createdByUserId?: string }) {
  return request(`/ships/${resourceId}/activities`, {
    method: "POST",
    body: JSON.stringify(block)
  });
}

export function createShipAudit(resourceId: string, block: TimelineBlock & { createdByUserId?: string }) {
  return request(`/ships/${resourceId}/audits`, {
    method: "POST",
    body: JSON.stringify(block)
  });
}

export function updateAudit(id: string, payload: Record<string, unknown>) {
  return request(`/audits/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteAudit(id: string) {
  return request(`/audits/${id}`, {
    method: "DELETE"
  });
}

export function uploadAuditDocuments(auditId: string, payload: Record<string, unknown>) {
  return request(`/audits/${auditId}/documents`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteDocument(id: string, currentUserId: string) {
  return request(`/documents/${id}?userId=${encodeURIComponent(currentUserId)}`, {
    method: "DELETE"
  });
}

export function getDocumentDownloadUrl(id: string, currentUserId: string) {
  return `${apiBaseUrl}/documents/${id}/download?userId=${encodeURIComponent(currentUserId)}`;
}

export function updateController(id: string, payload: Record<string, unknown>) {
  return request(`/controllers/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function createController(payload: Record<string, unknown>) {
  return request("/controllers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteController(id: string) {
  return request(`/controllers/${id}`, {
    method: "DELETE"
  });
}

export function createUser(payload: Record<string, unknown>) {
  return request("/users", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function updateUser(id: string, payload: Record<string, unknown>) {
  return request(`/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function deleteUser(id: string) {
  return request(`/users/${id}`, {
    method: "DELETE"
  });
}

export function updateFleetPeriodicity(id: string, periodicityMonths: number) {
  return request(`/fleet/${id}/periodicity`, {
    method: "PATCH",
    body: JSON.stringify({ periodicityMonths })
  });
}

export function updateRetentionSettings(autoDeleteDelayDays: number) {
  return request("/retention-settings", {
    method: "PATCH",
    body: JSON.stringify({ autoDeleteDelayDays })
  });
}

export function createControllerActivity(resourceId: string, block: TimelineBlock) {
  return request(`/controllers/${resourceId}/activities`, {
    method: "POST",
    body: JSON.stringify(block)
  });
}

export function deleteShipActivity(resourceId: string, blockId: string) {
  return request(`/ships/${resourceId}/activities/${blockId}`, {
    method: "DELETE"
  });
}

export function deleteControllerActivity(resourceId: string, blockId: string) {
  return request(`/controllers/${resourceId}/activities/${blockId}`, {
    method: "DELETE"
  });
}

export function moveShipTimelineBlock(resourceId: string, blockId: string, start: string, end: string) {
  return request(`/timeline/ships/${resourceId}/blocks/${blockId}`, {
    method: "PATCH",
    body: JSON.stringify({ start, end })
  });
}

export function moveControllerTimelineBlock(resourceId: string, blockId: string, start: string, end: string) {
  return request(`/timeline/controllers/${resourceId}/blocks/${blockId}`, {
    method: "PATCH",
    body: JSON.stringify({ start, end })
  });
}
