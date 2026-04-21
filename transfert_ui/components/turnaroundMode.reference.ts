import type { TurnaroundMode } from "@icare/shared";

export const EDITABLE_TURNAROUND_MODE_OPTIONS: Array<{
  value: Exclude<TurnaroundMode, "hot_refuel">;
  label: string;
}> = [
  { value: "shutdown", label: "Coupure" },
  { value: "rrt_cert", label: "RRT-CERT" },
  { value: "rrt", label: "RRT" },
  { value: "cert", label: "CERT" },
  { value: "rmf_cemf", label: "RMF-CEMF" },
  { value: "rmf", label: "RMF" },
  { value: "cemf", label: "CEMF" }
];

export function isHotRefuelLikeTurnaroundMode(mode: TurnaroundMode) {
  return mode !== "shutdown";
}

export function getTurnaroundModeLabel(mode: TurnaroundMode) {
  switch (mode) {
    case "shutdown":
      return "Coupure";
    case "rrt_cert":
      return "RRT-CERT";
    case "rrt":
      return "RRT";
    case "cert":
      return "CERT";
    case "rmf_cemf":
      return "RMF-CEMF";
    case "rmf":
      return "RMF";
    case "cemf":
      return "CEMF";
    case "hot_refuel":
      return "Hot refuel (legacy)";
    default:
      return mode;
  }
}
