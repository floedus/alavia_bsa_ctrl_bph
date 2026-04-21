import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { AuditStatus, BlockKind, ConstraintStatus, TimelineBlock, TimelineResource } from "../types";

type CreationCategory = {
  code: string;
  label: string;
  kind?: BlockKind;
  status?: AuditStatus;
  constraintStatus?: ConstraintStatus;
};

type PositionedBlock = TimelineBlock & {
  lane: number;
  left: number;
  width: number;
  startTimestamp: number;
  endTimestamp: number;
};

type InteractionMode = "drag" | "resize-start" | "resize-end";

type ActiveInteraction = {
  block: PositionedBlock;
  mode: InteractionMode;
  pointerStartX: number;
  laneWidth: number;
  startTimestamp: number;
  endTimestamp: number;
};

type ContextMenuState = {
  x: number;
  y: number;
  timestamp: number;
  block?: PositionedBlock;
};

type PendingCreation = {
  category: CreationCategory;
  timestamp: number;
};

type TimelineBoardProps = {
  title: string;
  eyebrow: string;
  date: string;
  timezoneLabel: string;
  zoom: number;
  resources: TimelineResource[];
  selectedBlockId: string | null;
  onSelectBlock: (block: TimelineBlock) => void;
  onDateChange: (value: string) => void;
  onZoomChange: (value: number) => void;
  onMoveBlock: (resourceId: string, blockId: string, start: string, end: string) => void;
  readOnly?: boolean;
  externalScrollRatio?: number | null;
  onScrollRatioChange?: (ratio: number) => void;
  creationCategories?: readonly CreationCategory[];
  onCreateBlock?: (resourceId: string, block: TimelineBlock) => void;
  onDeleteBlock?: (resourceId: string, blockId: string) => void;
  canDeleteBlock?: (block: TimelineBlock) => boolean;
  blockEditPolicy?: "all" | "activities-only";
  headerMode?: "full" | "title-only";
  showScaleHeader?: boolean;
};

type MonthSegment = {
  key: string;
  label: string;
  left: number;
  width: number;
};

type DaySegment = {
  key: string;
  label: string;
  dayNumber: string;
  left: number;
  width: number;
  isWeekend: boolean;
  isWeekStart: boolean;
};

type TimelineSharedHeaderProps = {
  date: string;
  timezoneLabel: string;
  zoom: number;
  minWidth: string;
  monthSegments: MonthSegment[];
  daySegments: DaySegment[];
  showDayLabels: boolean;
  readOnly?: boolean;
  creationCategories?: readonly CreationCategory[];
  onDateChange: (value: string) => void;
  onZoomChange: (value: number) => void;
  externalScrollRatio?: number | null;
  onScrollRatioChange?: (ratio: number) => void;
};

const dayMs = 24 * 60 * 60 * 1000;
const minimumBlockDurationMs = dayMs;
const snapMs = dayMs;
const minZoom = 180;
const maxZoom = 1000;

function parseDateTime(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function parseDate(value: string) {
  return parseDateTime(`${value}T00:00:00`);
}

function startOfDay(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function addMonths(timestamp: number, months: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate()).getTime();
}

function startOfMonth(timestamp: number) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatDateKey(timestamp: number) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatIsoAtHour(timestamp: number, hour: number) {
  const date = new Date(timestamp);
  date.setHours(hour, 0, 0, 0);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}T${`${hour}`.padStart(2, "0")}:00`;
}

function buildWindow(date: string) {
  const anchorDate = parseDate(date);
  const windowStart = addMonths(startOfMonth(anchorDate), -1);
  const windowEnd = addMonths(windowStart, 12);
  const duration = Math.max(dayMs, windowEnd - windowStart);
  return { windowStart, windowEnd, duration };
}

function normalizeBlock(block: TimelineBlock, windowStart: number, windowEnd: number, duration: number) {
  const rawStart = parseDateTime(block.kind === "audit" ? block.controllerDepartureAt ?? block.start : block.start);
  const rawEnd = parseDateTime(block.kind === "audit" ? block.returnToMainlandAt ?? block.end : block.end);

  if (rawEnd <= windowStart || rawStart >= windowEnd) {
    return null;
  }

  const startTimestamp = clamp(rawStart, windowStart, windowEnd - minimumBlockDurationMs);
  const endTimestamp = clamp(rawEnd, startTimestamp + minimumBlockDurationMs, windowEnd);

  return {
    ...block,
    startTimestamp,
    endTimestamp,
    left: ((startTimestamp - windowStart) / duration) * 100,
    width: Math.max(0.22, ((endTimestamp - startTimestamp) / duration) * 100)
  };
}

function assignLanes(blocks: TimelineBlock[], windowStart: number, windowEnd: number, duration: number) {
  const laneEnds: number[] = [];

  return blocks
    .map((block) => normalizeBlock(block, windowStart, windowEnd, duration))
    .filter((block): block is Omit<PositionedBlock, "lane"> => block !== null)
    .sort((a, b) => a.startTimestamp - b.startTimestamp)
    .map((block) => {
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= block.startTimestamp);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(block.endTimestamp);
      } else {
        laneEnds[lane] = block.endTimestamp;
      }

      return {
        ...block,
        lane
      };
    });
}

function buildMonthSegments(windowStart: number, windowEnd: number, duration: number): MonthSegment[] {
  const segments: MonthSegment[] = [];
  let cursor = startOfDay(windowStart);

  while (cursor < windowEnd) {
    const date = new Date(cursor);
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1).getTime();
    const segmentStart = Math.max(monthStart, windowStart);
    const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
    const segmentEnd = Math.min(nextMonth, windowEnd);

    if (segmentEnd > segmentStart) {
      segments.push({
        key: `${date.getFullYear()}-${date.getMonth()}`,
        label: date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" }),
        left: ((segmentStart - windowStart) / duration) * 100,
        width: ((segmentEnd - segmentStart) / duration) * 100
      });
    }

    cursor = nextMonth;
  }

  return segments;
}

function buildDaySegments(windowStart: number, windowEnd: number, duration: number): DaySegment[] {
  const segments: DaySegment[] = [];

  for (let cursor = windowStart; cursor < windowEnd; cursor += dayMs) {
    const date = new Date(cursor);
    const nextCursor = Math.min(cursor + dayMs, windowEnd);
    const day = date.getDay();

    segments.push({
      key: formatDateKey(cursor),
      label: date.toLocaleDateString("fr-FR", { weekday: "short" }),
      dayNumber: `${date.getDate()}`.padStart(2, "0"),
      left: ((cursor - windowStart) / duration) * 100,
      width: ((nextCursor - cursor) / duration) * 100,
      isWeekend: day === 0 || day === 6,
      isWeekStart: day === 1
    });
  }

  return segments;
}

function timestampToIso(timestamp: number, originalValue: string) {
  const hasTime = originalValue.includes("T");
  return formatIsoAtHour(timestamp, hasTime ? new Date(originalValue).getHours() : 8);
}

function blockStatusClass(block: TimelineBlock) {
  const base = ["timeline-block", block.status];
  if (block.kind === "audit") {
    base.push("mission");
  } else if (block.kind === "transit") {
    base.push("simulator");
  } else {
    base.push("alert");
  }
  return base.join(" ");
}

function resourceSummary(resource: TimelineResource) {
  const audits = resource.blocks.filter((block) => block.kind === "audit").length;
  const alerts = resource.blocks.filter((block) => block.constraintStatus === "blocking").length;
  return `${audits} audit${audits > 1 ? "s" : ""} • ${alerts} alerte${alerts > 1 ? "s" : ""}`;
}

function getOverdueSegment(resource: TimelineResource, windowStart: number, windowEnd: number, duration: number) {
  if (!resource.deadlineDate) {
    return null;
  }

  const deadlineTimestamp = parseDateTime(resource.deadlineDate);
  if (deadlineTimestamp <= windowStart || deadlineTimestamp >= windowEnd) {
    return deadlineTimestamp < windowStart ? { left: 0, width: 100 } : null;
  }

  return {
    left: ((deadlineTimestamp - windowStart) / duration) * 100,
    width: ((windowEnd - deadlineTimestamp) / duration) * 100
  };
}

function formatAuditPhase(block: TimelineBlock, windowStart: number, windowEnd: number) {
  if (block.kind !== "audit") {
    return null;
  }

  const departure = parseDateTime(block.controllerDepartureAt ?? block.start);
  const controlStart = parseDateTime(block.controlStartAt ?? block.start);
  const controlEnd = parseDateTime(block.controlEndAt ?? block.end);
  const returnToMainland = parseDateTime(block.returnToMainlandAt ?? block.end);
  const safeStart = clamp(departure, windowStart, windowEnd);
  const safeAuditStart = clamp(controlStart, safeStart, windowEnd);
  const safeAuditEnd = clamp(controlEnd, safeAuditStart, windowEnd);
  const safeEnd = clamp(returnToMainland, safeAuditEnd, windowEnd);
  const total = Math.max(dayMs, safeEnd - safeStart);

  return {
    outboundWidth: ((safeAuditStart - safeStart) / total) * 100,
    auditLeft: ((safeAuditStart - safeStart) / total) * 100,
    auditWidth: ((safeAuditEnd - safeAuditStart) / total) * 100,
    returnLeft: ((safeAuditEnd - safeStart) / total) * 100,
    returnWidth: ((safeEnd - safeAuditEnd) / total) * 100
  };
}

function TimelineLane({
  resource,
  selectedBlockId,
  onSelectBlock,
  onMoveBlock,
  windowStart,
  windowEnd,
  duration,
  daySegments,
  minWidth,
  setScrollNode,
  readOnly = false,
  creationCategories = [],
  onCreateBlock,
  onDeleteBlock,
  canDeleteBlock,
  blockEditPolicy = "all"
}: {
  resource: TimelineResource;
  selectedBlockId: string | null;
  onSelectBlock: (block: TimelineBlock) => void;
  onMoveBlock: (resourceId: string, blockId: string, start: string, end: string) => void;
  windowStart: number;
  windowEnd: number;
  duration: number;
  daySegments: DaySegment[];
  minWidth: string;
  setScrollNode: (node: HTMLDivElement | null) => void;
  readOnly?: boolean;
  creationCategories?: readonly CreationCategory[];
  onCreateBlock?: (resourceId: string, block: TimelineBlock) => void;
  onDeleteBlock?: (resourceId: string, blockId: string) => void;
  canDeleteBlock?: (block: TimelineBlock) => boolean;
  blockEditPolicy?: "all" | "activities-only";
}) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const laneShellRef = useRef<HTMLDivElement | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<ActiveInteraction | null>(null);
  const [preview, setPreview] = useState<{ id: string; startTimestamp: number; endTimestamp: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [pendingCreation, setPendingCreation] = useState<PendingCreation | null>(null);
  const suppressClickRef = useRef(false);
  const blocks = useMemo(
    () => assignLanes(resource.blocks, windowStart, windowEnd, duration),
    [duration, resource.blocks, windowEnd, windowStart]
  );
  const overdueSegment = useMemo(
    () => getOverdueSegment(resource, windowStart, windowEnd, duration),
    [duration, resource, windowEnd, windowStart]
  );

  useEffect(() => {
    if (!activeInteraction) {
      return;
    }

    const interaction = activeInteraction;

    function applyPreview(deltaTimestamp: number) {
      if (interaction.mode === "drag") {
        const durationMs = interaction.endTimestamp - interaction.startTimestamp;
        const nextStart = clamp(interaction.startTimestamp + deltaTimestamp, windowStart, windowEnd - durationMs);
        setPreview({
          id: interaction.block.id,
          startTimestamp: nextStart,
          endTimestamp: nextStart + durationMs
        });
      } else if (interaction.mode === "resize-start") {
        const nextStart = clamp(
          interaction.startTimestamp + deltaTimestamp,
          windowStart,
          interaction.endTimestamp - minimumBlockDurationMs
        );
        setPreview({ id: interaction.block.id, startTimestamp: nextStart, endTimestamp: interaction.endTimestamp });
      } else {
        const nextEnd = clamp(
          interaction.endTimestamp + deltaTimestamp,
          interaction.startTimestamp + minimumBlockDurationMs,
          windowEnd
        );
        setPreview({ id: interaction.block.id, startTimestamp: interaction.startTimestamp, endTimestamp: nextEnd });
      }

      if (deltaTimestamp !== 0) {
        suppressClickRef.current = true;
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const deltaX = event.clientX - interaction.pointerStartX;
      const rawTimestamp = (deltaX / interaction.laneWidth) * duration;
      const snapped = Math.round(rawTimestamp / snapMs) * snapMs;
      applyPreview(snapped);
    }

    function handlePointerUp() {
      const finalStart = preview?.id === interaction.block.id ? preview.startTimestamp : interaction.startTimestamp;
      const finalEnd = preview?.id === interaction.block.id ? preview.endTimestamp : interaction.endTimestamp;
      setActiveInteraction(null);
      setPreview(null);

      if (finalStart === interaction.startTimestamp && finalEnd === interaction.endTimestamp) {
        return;
      }

      onMoveBlock(
        resource.id,
        interaction.block.id,
        timestampToIso(finalStart, interaction.block.start),
        timestampToIso(finalEnd, interaction.block.end)
      );
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeInteraction, duration, onMoveBlock, preview, resource.id, windowEnd, windowStart]);

  useEffect(() => {
    function closeMenu() {
      setContextMenu(null);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
        setPendingCreation(null);
      }
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const displayedBlocks = useMemo(
    () =>
      blocks.map((block) => {
        if (!preview || preview.id !== block.id) {
          return block;
        }

        return {
          ...block,
          startTimestamp: preview.startTimestamp,
          endTimestamp: preview.endTimestamp,
          left: ((preview.startTimestamp - windowStart) / duration) * 100,
          width: Math.max(0.22, ((preview.endTimestamp - preview.startTimestamp) / duration) * 100)
        };
      }),
    [blocks, duration, preview, windowStart]
  );

  const creationPreview = useMemo(() => {
    if (!pendingCreation) {
      return null;
    }

    const startTimestamp = pendingCreation.timestamp;
    const endTimestamp = startTimestamp + minimumBlockDurationMs;
    return {
      left: ((startTimestamp - windowStart) / duration) * 100,
      width: Math.max(0.22, ((endTimestamp - startTimestamp) / duration) * 100),
      title: pendingCreation.category.label,
      code: pendingCreation.category.code
    };
  }, [duration, pendingCreation, windowStart]);

  const laneCount = Math.max(1, ...displayedBlocks.map((block) => block.lane + 1));

  function timestampFromPointer(event: { clientX: number }) {
    if (!laneRef.current) {
      return windowStart;
    }

    const rect = laneRef.current.getBoundingClientRect();
    const relativeX = clamp(event.clientX - rect.left, 0, rect.width);
    const ratio = rect.width === 0 ? 0 : relativeX / rect.width;
    const rawTimestamp = windowStart + (ratio * duration);
    return clamp(Math.round(rawTimestamp / snapMs) * snapMs, windowStart, windowEnd - minimumBlockDurationMs);
  }

  function buildCreatedBlock(category: CreationCategory, timestamp: number): TimelineBlock {
    const start = timestampToIso(timestamp, "2026-01-01T08:00");
    const end = timestampToIso(timestamp + minimumBlockDurationMs, "2026-01-02T18:00");
    return {
      id: `${resource.id}-${category.code}-${timestamp}`,
      code: category.code,
      title: category.label,
      start,
      end,
      status: category.status ?? "warning",
      kind: category.kind ?? "unavailability",
      controllerDepartureAt: category.kind === "audit" ? start : undefined,
      controlStartAt: category.kind === "audit" ? start : undefined,
      controlEndAt: category.kind === "audit" ? end : undefined,
      returnToMainlandAt: category.kind === "audit" ? end : undefined,
      activityCategory: category.code,
      constraintStatus: category.constraintStatus ?? (category.kind === "audit" ? undefined : "blocking"),
      detail: category.kind === "audit" ? `${category.label} a confirmer` : `${category.label} declaree`
    };
  }

  function isBlockEditable(block?: PositionedBlock | TimelineBlock) {
    if (!block || readOnly) {
      return false;
    }

    if (blockEditPolicy === "activities-only" && block.kind === "audit") {
      return false;
    }

    return true;
  }

  function isBlockDeletable(block?: PositionedBlock | TimelineBlock) {
    if (!block) {
      return false;
    }

    if (canDeleteBlock) {
      return canDeleteBlock(block);
    }

    return block.kind !== "audit";
  }

  function openCreationMenu(
    event: { clientX: number; clientY: number; preventDefault: () => void; stopPropagation: () => void },
    block?: PositionedBlock
  ) {
    if (readOnly || ((creationCategories.length === 0 || !onCreateBlock) && !isBlockDeletable(block))) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: Math.max(8, event.clientX + 8),
      y: Math.max(8, event.clientY + 8),
      timestamp: timestampFromPointer(event),
      block
    });
    setPendingCreation(null);
  }

  function startInteraction(event: ReactPointerEvent, block: PositionedBlock, mode: InteractionMode) {
    if (!laneRef.current || !isBlockEditable(block)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    setActiveInteraction({
      block,
      mode,
      pointerStartX: event.clientX,
      laneWidth: laneRef.current.getBoundingClientRect().width,
      startTimestamp: block.startTimestamp,
      endTimestamp: block.endTimestamp
    });
    setPreview({
      id: block.id,
      startTimestamp: block.startTimestamp,
      endTimestamp: block.endTimestamp
    });
  }

  return (
    <section className="timeline-lane-section">
      <div className="timeline-lane-header">
        <div>
          <p className="section-label">{resource.code} • {resource.label}</p>
          <span>{resource.caption}</span>
        </div>
        <span>{resourceSummary(resource)}</span>
      </div>
      <div ref={laneShellRef} className="timeline-lane-shell">
        <div
          ref={setScrollNode}
          className="timeline-scroll timeline-lane-scroll"
          onContextMenu={(event) => openCreationMenu(event)}
        >
          <div className="timeline-canvas timeline-year-canvas" style={{ minWidth }}>
            <div className="timeline-year-grid" aria-hidden="true">
              {overdueSegment ? (
                <div
                  className="timeline-overdue-segment"
                  style={{ left: `${overdueSegment.left}%`, width: `${overdueSegment.width}%` }}
                />
              ) : null}
              {daySegments.map((segment) => (
                <div
                  key={`${resource.id}-${segment.key}`}
                  className={[
                    "timeline-day-segment",
                    segment.isWeekend ? "is-weekend" : "",
                    segment.isWeekStart ? "is-week-start" : ""
                  ].join(" ").trim()}
                  style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
                />
              ))}
            </div>
            <div
              ref={laneRef}
              className={`timeline-lane ${pendingCreation ? "timeline-lane-creation" : ""}`}
              style={{ minHeight: `${laneCount * 112 + 12}px` }}
              onContextMenu={(event) => openCreationMenu(event)}
              onPointerMove={(event) => {
                if (!pendingCreation) {
                  return;
                }
                setPendingCreation((current) => (current ? { ...current, timestamp: timestampFromPointer(event) } : current));
              }}
              onClick={(event) => {
                if (!pendingCreation || !onCreateBlock) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                const block = buildCreatedBlock(pendingCreation.category, timestampFromPointer(event));
                onCreateBlock(resource.id, block);
                setPendingCreation(null);
              }}
            >
              {displayedBlocks.map((block) => (
                <article
                  key={block.id}
                  className={`${blockStatusClass(block)} ${selectedBlockId === block.id ? "selected" : ""}`}
                  style={{ left: `${block.left}%`, width: `${block.width}%`, top: `${block.lane * 104 + 8}px` }}
                  onPointerDown={(event) => startInteraction(event, block, "drag")}
                  onContextMenu={(event) => openCreationMenu(event, block)}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    onSelectBlock({ ...block, resourceCode: resource.id });
                  }}
                >
                  {isBlockEditable(block) ? (
                    <button
                      type="button"
                      className="timeline-handle timeline-handle-start"
                      onPointerDown={(event) => startInteraction(event, block, "resize-start")}
                      aria-label="Ajuster le debut"
                    />
                  ) : null}
                  {block.kind === "audit" ? (
                    <div className="timeline-audit-phases" aria-hidden="true">
                      {(() => {
                        const phases = formatAuditPhase(block, windowStart, windowEnd);
                        if (!phases) {
                          return null;
                        }

                        return (
                          <>
                            <div
                              className="timeline-audit-phase timeline-audit-phase-outbound"
                              style={{ left: "0%", width: `${phases.outboundWidth}%` }}
                            />
                            <div
                              className="timeline-audit-phase timeline-audit-phase-main"
                              style={{ left: `${phases.auditLeft}%`, width: `${phases.auditWidth}%` }}
                            />
                            <div
                              className="timeline-audit-phase timeline-audit-phase-return"
                              style={{ left: `${phases.returnLeft}%`, width: `${phases.returnWidth}%` }}
                            />
                          </>
                        );
                      })()}
                    </div>
                  ) : null}
                  <div className="timeline-block-head">
                    <span className="timeline-block-code">{block.code}</span>
                    <span className={`status ${block.status}`}>{block.status}</span>
                  </div>
                  <p className="timeline-block-title">{block.title}</p>
                  {block.crew?.length ? <p className="timeline-block-crew">{block.crew.join(" - ")}</p> : null}
                  {isBlockEditable(block) ? (
                    <button
                      type="button"
                      className="timeline-handle timeline-handle-end"
                      onPointerDown={(event) => startInteraction(event, block, "resize-end")}
                      aria-label="Ajuster la fin"
                    />
                  ) : null}
                  {isBlockEditable(block) && isBlockDeletable(block) && onDeleteBlock ? (
                    <button
                      type="button"
                      className="timeline-block-delete"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        void onDeleteBlock(resource.id, block.id);
                      }}
                      aria-label="Supprimer l'activite"
                    >
                      ×
                    </button>
                  ) : null}
                </article>
              ))}
              {creationPreview ? (
                <article
                  className="timeline-block alert timeline-block-ghost"
                  style={{ left: `${creationPreview.left}%`, width: `${creationPreview.width}%`, top: "8px" }}
                >
                  <div className="timeline-block-head">
                    <span className="timeline-block-code">{creationPreview.code}</span>
                    <span className="status warning">nouveau</span>
                  </div>
                  <p className="timeline-block-title">{creationPreview.title}</p>
                </article>
              ) : null}
            </div>
          </div>
        </div>
        {contextMenu
          ? createPortal(
              <div
                className="timeline-context-menu"
                style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
              >
                {creationCategories.map((category) => (
                  <button
                    key={category.code}
                    type="button"
                    className="timeline-context-item"
                    onClick={() => {
                      setPendingCreation({ category, timestamp: contextMenu.timestamp });
                      setContextMenu(null);
                    }}
                  >
                    {category.label}
                  </button>
                ))}
                {contextMenu.block && isBlockDeletable(contextMenu.block) && onDeleteBlock ? (
                  <button
                    type="button"
                    className="timeline-context-item timeline-context-item-danger"
                    onClick={() => {
                      void onDeleteBlock(resource.id, contextMenu.block!.id);
                      setContextMenu(null);
                    }}
                  >
                    Supprimer
                  </button>
                ) : null}
                <span className="timeline-context-hint">Choisissez un type puis placez le bloc sur la frise.</span>
              </div>,
              document.body
            )
          : null}
      </div>
    </section>
  );
}

function TimelineScale({
  minWidth,
  monthSegments,
  daySegments,
  showDayLabels
}: {
  minWidth: string;
  monthSegments: MonthSegment[];
  daySegments: DaySegment[];
  showDayLabels: boolean;
}) {
  return (
    <div className="timeline-canvas timeline-year-canvas" style={{ minWidth }}>
      <div className="timeline-months">
        {monthSegments.map((segment) => (
          <div
            key={segment.key}
            className="timeline-month-segment"
            style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
          >
            {segment.label}
          </div>
        ))}
      </div>
      <div className="timeline-days-header">
        {daySegments.map((segment) => (
          <div
            key={segment.key}
            className={[
              "timeline-day-header-segment",
              showDayLabels ? "is-readable" : "is-condensed",
              segment.isWeekend ? "is-weekend" : "",
              segment.isWeekStart ? "is-week-start" : ""
            ].join(" ").trim()}
            style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
            title={`${segment.label} ${segment.dayNumber}`}
          >
            {showDayLabels ? <span>{segment.dayNumber}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function TimelineSharedHeader({
  date,
  timezoneLabel,
  zoom,
  minWidth,
  monthSegments,
  daySegments,
  showDayLabels,
  readOnly = false,
  creationCategories = [],
  onDateChange,
  onZoomChange,
  externalScrollRatio = null,
  onScrollRatioChange
}: TimelineSharedHeaderProps) {
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const applyingExternalScrollRef = useRef(false);

  useEffect(() => {
    const node = headerScrollRef.current;
    const handleRatioChange = onScrollRatioChange;
    if (!node || !handleRatioChange) {
      return;
    }

    const scrollNode = node;
    const emitScrollRatio = handleRatioChange;

    function handleScroll() {
      if (applyingExternalScrollRef.current) {
        return;
      }

      const maxScroll = Math.max(1, scrollNode.scrollWidth - scrollNode.clientWidth);
      emitScrollRatio(scrollNode.scrollLeft / maxScroll);
    }

    scrollNode.addEventListener("scroll", handleScroll);
    return () => {
      scrollNode.removeEventListener("scroll", handleScroll);
    };
  }, [onScrollRatioChange]);

  useEffect(() => {
    const node = headerScrollRef.current;
    if (!node || externalScrollRatio === null) {
      return;
    }

    applyingExternalScrollRef.current = true;
    const maxScroll = Math.max(0, node.scrollWidth - node.clientWidth);
    node.scrollLeft = externalScrollRatio * maxScroll;

    requestAnimationFrame(() => {
      applyingExternalScrollRef.current = false;
    });
  }, [externalScrollRatio, zoom]);

  function setZoom(nextZoom: number) {
    onZoomChange(clamp(nextZoom, minZoom, maxZoom));
  }

  return (
    <section className="panel timeline-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Repere temporel mutualise</p>
          <h2>Frise commune de planification</h2>
        </div>
        <div className="timeline-header-tools">
          <div className="solar-chip">Fenetre glissante 12 mois • precision au jour • week-ends visibles</div>
          <div className="date-chip">{timezoneLabel}</div>
          {readOnly ? <div className="date-chip">Lecture seule</div> : null}
          {creationCategories.length ? <div className="date-chip">Clic droit pour creer une indisponibilite</div> : null}
          <label className="zoom-control">
            Zoom
            <input
              type="range"
              min={minZoom}
              max={maxZoom}
              step={20}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
            <span>{zoom}%</span>
          </label>
          <div className="timeline-zoom-buttons">
            <button type="button" className="secondary-button compact-button" onClick={() => setZoom(zoom - 40)}>
              -
            </button>
            <button type="button" className="secondary-button compact-button" onClick={() => setZoom(zoom + 40)}>
              +
            </button>
          </div>
          <label className="date-chip-control">
            <span>Ancre</span>
            <input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} />
          </label>
        </div>
      </div>

      <div ref={headerScrollRef} className="timeline-scroll timeline-hours-scroll">
        <TimelineScale
          minWidth={minWidth}
          monthSegments={monthSegments}
          daySegments={daySegments}
          showDayLabels={showDayLabels}
        />
      </div>
    </section>
  );
}

export function TimelineBoard({
  title,
  eyebrow,
  date,
  timezoneLabel,
  zoom,
  resources,
  selectedBlockId,
  onSelectBlock,
  onDateChange,
  onZoomChange,
  onMoveBlock,
  readOnly = false,
  externalScrollRatio = null,
  onScrollRatioChange,
  creationCategories = [],
  onCreateBlock,
  onDeleteBlock,
  canDeleteBlock,
  blockEditPolicy = "all",
  headerMode = "full",
  showScaleHeader = true
}: TimelineBoardProps) {
  const { windowStart, windowEnd, duration } = useMemo(() => buildWindow(date), [date]);
  const monthSegments = useMemo(() => buildMonthSegments(windowStart, windowEnd, duration), [duration, windowEnd, windowStart]);
  const daySegments = useMemo(() => buildDaySegments(windowStart, windowEnd, duration), [duration, windowEnd, windowStart]);
  const showDayLabels = zoom >= 400;
  const minWidth = `${zoom}%`;
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const laneScrollRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const previousZoomRef = useRef(zoom);
  const applyingExternalScrollRef = useRef(false);

  const selectedBlockMetrics = useMemo(() => {
    if (!selectedBlockId) {
      return null;
    }

    for (const resource of resources) {
      const block = resource.blocks.find((entry) => entry.id === selectedBlockId);
      if (!block) {
        continue;
      }

      const normalized = normalizeBlock(block, windowStart, windowEnd, duration);
      if (!normalized) {
        return null;
      }

      return {
        centerPercent: normalized.left + (normalized.width / 2)
      };
    }

    return null;
  }, [duration, resources, selectedBlockId, windowEnd, windowStart]);

  useEffect(() => {
    const nodes = [headerScrollRef.current, ...resources.map((resource) => laneScrollRefs.current[resource.id] ?? null)].filter(
      (node): node is HTMLDivElement => node !== null
    );

    if (nodes.length === 0) {
      return;
    }

    let syncing = false;
    const listeners = nodes.map((node) => {
      const onScroll = () => {
        if (syncing) {
          return;
        }

        syncing = true;
        for (const other of nodes) {
          if (other !== node) {
            other.scrollLeft = node.scrollLeft;
          }
        }

        if (!applyingExternalScrollRef.current && onScrollRatioChange) {
          const maxScroll = Math.max(1, node.scrollWidth - node.clientWidth);
          onScrollRatioChange(node.scrollLeft / maxScroll);
        }

        requestAnimationFrame(() => {
          syncing = false;
        });
      };

      node.addEventListener("scroll", onScroll);
      return { node, onScroll };
    });

    return () => {
      for (const listener of listeners) {
        listener.node.removeEventListener("scroll", listener.onScroll);
      }
    };
  }, [onScrollRatioChange, resources, zoom]);

  useEffect(() => {
    if (externalScrollRatio === null) {
      return;
    }

    const nodes = [headerScrollRef.current, ...resources.map((resource) => laneScrollRefs.current[resource.id] ?? null)].filter(
      (node): node is HTMLDivElement => node !== null
    );

    if (nodes.length === 0) {
      return;
    }

    applyingExternalScrollRef.current = true;
    for (const node of nodes) {
      const maxScroll = Math.max(0, node.scrollWidth - node.clientWidth);
      node.scrollLeft = externalScrollRatio * maxScroll;
    }

    requestAnimationFrame(() => {
      applyingExternalScrollRef.current = false;
    });
  }, [externalScrollRatio, resources, zoom]);

  useEffect(() => {
    const previousZoom = previousZoomRef.current;
    previousZoomRef.current = zoom;

    if (previousZoom === zoom) {
      return;
    }

    const nodes = [headerScrollRef.current, ...resources.map((resource) => laneScrollRefs.current[resource.id] ?? null)].filter(
      (node): node is HTMLDivElement => node !== null
    );

    if (nodes.length === 0) {
      return;
    }

    const referenceNode = headerScrollRef.current ?? nodes[0];
    const targetScrollLeft = selectedBlockMetrics
      ? clamp(
          ((selectedBlockMetrics.centerPercent / 100) * referenceNode.scrollWidth) - (referenceNode.clientWidth / 2),
          0,
          Math.max(0, referenceNode.scrollWidth - referenceNode.clientWidth)
        )
      : referenceNode.scrollLeft;

    for (const node of nodes) {
      const nextScrollLeft = selectedBlockMetrics
        ? clamp(
            ((selectedBlockMetrics.centerPercent / 100) * node.scrollWidth) - (node.clientWidth / 2),
            0,
            Math.max(0, node.scrollWidth - node.clientWidth)
          )
        : targetScrollLeft;
      node.scrollLeft = nextScrollLeft;
    }
  }, [resources, selectedBlockMetrics, zoom]);

  function setZoom(nextZoom: number) {
    onZoomChange(clamp(nextZoom, minZoom, maxZoom));
  }

  const showHeaderTools = headerMode === "full";

  return (
    <section className="panel timeline-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {showHeaderTools ? (
          <div className="timeline-header-tools">
            <div className="solar-chip">Fenetre glissante 12 mois • precision au jour • week-ends visibles</div>
            <div className="date-chip">{timezoneLabel}</div>
            {readOnly ? <div className="date-chip">Lecture seule</div> : null}
            {creationCategories.length ? <div className="date-chip">Clic droit pour creer une indisponibilite</div> : null}
            <label className="zoom-control">
              Zoom
              <input
                type="range"
                min={minZoom}
                max={maxZoom}
                step={20}
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
              <span>{zoom}%</span>
            </label>
            <div className="timeline-zoom-buttons">
              <button type="button" className="secondary-button compact-button" onClick={() => setZoom(zoom - 40)}>
                -
              </button>
              <button type="button" className="secondary-button compact-button" onClick={() => setZoom(zoom + 40)}>
                +
              </button>
            </div>
            <label className="date-chip-control">
              <span>Ancre</span>
              <input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} />
            </label>
          </div>
        ) : null}
      </div>

      {showScaleHeader ? (
        <div ref={headerScrollRef} className="timeline-scroll timeline-hours-scroll">
          <TimelineScale
            minWidth={minWidth}
            monthSegments={monthSegments}
            daySegments={daySegments}
            showDayLabels={showDayLabels}
          />
        </div>
      ) : null}

      <div className="timeline-stack">
        {resources.map((resource) => (
          <TimelineLane
            key={resource.id}
            resource={resource}
            selectedBlockId={selectedBlockId}
            onSelectBlock={onSelectBlock}
            onMoveBlock={onMoveBlock}
            windowStart={windowStart}
            windowEnd={windowEnd}
            duration={duration}
            daySegments={daySegments}
            minWidth={minWidth}
            setScrollNode={(node) => {
              laneScrollRefs.current[resource.id] = node;
            }}
            readOnly={readOnly}
            creationCategories={creationCategories}
            onCreateBlock={onCreateBlock}
            onDeleteBlock={onDeleteBlock}
            canDeleteBlock={canDeleteBlock}
            blockEditPolicy={blockEditPolicy}
          />
        ))}
      </div>
    </section>
  );
}
