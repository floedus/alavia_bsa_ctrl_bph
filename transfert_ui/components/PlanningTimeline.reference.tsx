import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  AlertCard,
  DailyPlanningView,
  MissionCard,
  SimulatorSessionCard,
  ActivityConstraintStatus,
  ActivityConstraintEvaluation,
  UpdatePlanningEntryDetailsInput,
  UpdatePlanningEntryScheduleInput
} from "@icare/shared";
import { isHotRefuelLikeTurnaroundMode } from "./turnaroundMode";

type PlanningTimelineProps = {
  planning: DailyPlanningView;
  isUpdating: boolean;
  zoom: number;
  onZoomChange: (value: number) => void;
  selectedDate: string;
  onDateChange: (value: string) => void;
  dateLocked?: boolean;
  selectedEntryId: string | null;
  onSelectEntry: (payload: UpdatePlanningEntryDetailsInput["entryType"], id: string) => void;
  onScheduleChange: (payload: UpdatePlanningEntryScheduleInput) => Promise<void>;
  onDeleteEntry: (entry: { entryType: "mission" | "alert" | "simulator"; id: string }) => Promise<void>;
  onMarkPlanned?: (entry: { entryType: "mission" | "alert" | "simulator"; id: string }) => Promise<void>;
  enableContextActions?: boolean;
  readOnly?: boolean;
  timezoneCode: string;
  utcOffsetMinutes: number;
};

type TimelineBlock = {
  id: string;
  code: string;
  title: string;
  status: string;
  isModified: boolean;
  start: string;
  end: string;
  briefingTime?: string;
  aircraftCode?: string;
  turnaroundMode?: MissionCard["turnaroundMode"];
  constraintStatus?: ActivityConstraintStatus;
  constraintEvaluations?: ActivityConstraintEvaluation[];
  crew?: Array<{
    trigram: string;
    isCommander: boolean;
  }>;
  kind: "mission" | "alert" | "simulator";
};

type PositionedBlock = TimelineBlock & {
  left: number;
  width: number;
  lane: number;
  startMinutes: number;
  endMinutes: number;
};

type InteractionMode = "drag" | "resize-start" | "resize-end";

type ActiveInteraction = {
  block: PositionedBlock;
  mode: InteractionMode;
  pointerStartX: number;
  laneWidth: number;
  startMinutes: number;
  endMinutes: number;
};

const timelineStartHour = 0;
const timelineEndHour = 30;
const timelineMinutes = (timelineEndHour - timelineStartHour) * 60;
const minimumBlockDuration = 5;
const snapMinutes = 5;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function getDayOfYear(date: Date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function calculateSolarEvent(date: string, latitude: number, longitude: number, isSunrise: boolean) {
  const [year, month, day] = date.split("-").map((value) => Number(value));
  const baseDate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  const dayOfYear = getDayOfYear(baseDate);
  const lngHour = longitude / 15;
  const approximateTime = isSunrise
    ? dayOfYear + ((6 - lngHour) / 24)
    : dayOfYear + ((18 - lngHour) / 24);
  const meanAnomaly = (0.9856 * approximateTime) - 3.289;
  let trueLongitude = meanAnomaly
    + (1.916 * Math.sin(toRadians(meanAnomaly)))
    + (0.02 * Math.sin(2 * toRadians(meanAnomaly)))
    + 282.634;
  trueLongitude = normalizeDegrees(trueLongitude);
  let rightAscension = toDegrees(Math.atan(0.91764 * Math.tan(toRadians(trueLongitude))));
  rightAscension = normalizeDegrees(rightAscension);

  const trueLongitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const rightAscensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + (trueLongitudeQuadrant - rightAscensionQuadrant)) / 15;

  const sinDeclination = 0.39782 * Math.sin(toRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const cosHourAngle = (
    Math.cos(toRadians(90.833))
    - (sinDeclination * Math.sin(toRadians(latitude)))
  ) / (cosDeclination * Math.cos(toRadians(latitude)));

  if (cosHourAngle > 1 || cosHourAngle < -1) {
    return null;
  }

  const hourAngle = isSunrise
    ? 360 - toDegrees(Math.acos(cosHourAngle))
    : toDegrees(Math.acos(cosHourAngle));
  const localHour = (hourAngle / 15) + rightAscension - (0.06571 * approximateTime) - 6.622;
  let utcHour = localHour - lngHour;
  utcHour = ((utcHour % 24) + 24) % 24;

  const hours = Math.floor(utcHour);
  const minutes = Math.floor((utcHour - hours) * 60);
  const seconds = Math.round((((utcHour - hours) * 60) - minutes) * 60);

  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds, 0));
}

function getSolarMarkers(planning: DailyPlanningView) {
  if (planning.platform.latitude === undefined || planning.platform.longitude === undefined) {
    return null;
  }

  function addDays(value: string, days: number) {
    const [year, month, day] = value.split("-").map((item) => Number(item));
    const shifted = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0, 0));
    return `${shifted.getUTCFullYear()}-${`${shifted.getUTCMonth() + 1}`.padStart(2, "0")}-${`${shifted.getUTCDate()}`.padStart(2, "0")}`;
  }

  function buildDaylightSegment(date: string) {
    const localSunrise = calculateSolarEvent(date, planning.platform.latitude!, planning.platform.longitude!, true);
    const localSunset = calculateSolarEvent(date, planning.platform.latitude!, planning.platform.longitude!, false);

    if (!localSunrise || !localSunset) {
      return null;
    }

    const startMinutes = toMinutesFromStart(localSunrise.toISOString(), planning.date, planning.platform.utcOffsetMinutes);
    const endMinutes = toMinutesFromStart(localSunset.toISOString(), planning.date, planning.platform.utcOffsetMinutes);
    const clippedStart = Math.max(0, Math.min(timelineMinutes, startMinutes));
    const clippedEnd = Math.max(0, Math.min(timelineMinutes, endMinutes));

    if (clippedEnd <= clippedStart) {
      return null;
    }

    return {
      startMinutes: clippedStart,
      endMinutes: clippedEnd
    };
  }

  const sunrise = calculateSolarEvent(planning.date, planning.platform.latitude, planning.platform.longitude, true);
  const sunset = calculateSolarEvent(planning.date, planning.platform.latitude, planning.platform.longitude, false);

  if (!sunrise || !sunset) {
    return null;
  }

  const daylightSegments = [
    buildDaylightSegment(planning.date),
    buildDaylightSegment(addDays(planning.date, 1))
  ].filter((segment): segment is { startMinutes: number; endMinutes: number } => segment !== null);

  return {
    sunrise,
    sunset,
    sunriseMinutes: toMinutesFromStart(sunrise.toISOString(), planning.date, planning.platform.utcOffsetMinutes),
    sunsetMinutes: toMinutesFromStart(sunset.toISOString(), planning.date, planning.platform.utcOffsetMinutes),
    daylightSegments
  };
}

function formatHour(value: string, utcOffsetMinutes: number) {
  const shifted = new Date(new Date(value).getTime() + utcOffsetMinutes * 60000);
  const hours = shifted.getUTCHours().toString().padStart(2, "0");
  const minutes = shifted.getUTCMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getWindowStartUtc(date: string, utcOffsetMinutes: number) {
  const [year, month, day] = date.split("-").map((value) => Number(value));
  return Date.UTC(year, month - 1, day, timelineStartHour, 0, 0, 0) - (utcOffsetMinutes * 60000);
}

function toMinutesFromStart(value: string, planningDate: string, utcOffsetMinutes: number) {
  const timestamp = new Date(value).getTime();
  const windowStartUtc = getWindowStartUtc(planningDate, utcOffsetMinutes);
  return Math.round((timestamp - windowStartUtc) / 60000);
}

function toIsoOnPlanningWindow(planningDate: string, minutesFromStart: number, utcOffsetMinutes: number) {
  const windowStartUtc = getWindowStartUtc(planningDate, utcOffsetMinutes);
  const utcTimestamp = windowStartUtc + minutesFromStart * 60000;
  return new Date(utcTimestamp).toISOString();
}

function normalizeBlock(block: TimelineBlock, planningDate: string, utcOffsetMinutes: number): (TimelineBlock & {
  startMinutes: number;
  endMinutes: number;
}) | null {
  const rawStart = toMinutesFromStart(block.start, planningDate, utcOffsetMinutes);
  const rawEnd = toMinutesFromStart(block.end, planningDate, utcOffsetMinutes);
  if (rawEnd <= 0 || rawStart >= timelineMinutes) {
    return null;
  }
  const startMinutes = Math.max(0, Math.min(timelineMinutes - minimumBlockDuration, rawStart));
  const endMinutes = Math.max(startMinutes + minimumBlockDuration, Math.min(timelineMinutes, rawEnd));

  return {
    ...block,
    startMinutes,
    endMinutes
  };
}

function assignLanes(blocks: TimelineBlock[], planningDate: string, utcOffsetMinutes: number): PositionedBlock[] {
  const laneEnds: number[] = [];
  const lastMissionByAircraftCode = new Map<string, PositionedBlock>();

  return blocks
    .map((block) => normalizeBlock(block, planningDate, utcOffsetMinutes))
    .filter((block): block is TimelineBlock & { startMinutes: number; endMinutes: number } => block !== null)
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map((block) => {
      let preferredLane: number | null = null;

      if (block.kind === "mission" && block.aircraftCode) {
        const previousMission = lastMissionByAircraftCode.get(block.aircraftCode);
        if (
          previousMission
          && previousMission.turnaroundMode
          && isHotRefuelLikeTurnaroundMode(previousMission.turnaroundMode)
          && previousMission.endMinutes <= block.startMinutes
        ) {
          preferredLane = previousMission.lane;
        }
      }

      let lane = preferredLane !== null && laneEnds[preferredLane] !== undefined && laneEnds[preferredLane] <= block.startMinutes
        ? preferredLane
        : laneEnds.findIndex((laneEnd) => laneEnd <= block.startMinutes);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(block.endMinutes);
      } else {
        laneEnds[lane] = block.endMinutes;
      }

      const positionedBlock = {
        ...block,
        lane,
        left: (block.startMinutes / timelineMinutes) * 100,
        width: ((block.endMinutes - block.startMinutes) / timelineMinutes) * 100
      };

      if (block.kind === "mission" && block.aircraftCode) {
        lastMissionByAircraftCode.set(block.aircraftCode, positionedBlock);
      }

      return positionedBlock;
    });
}

function toTrigram(name?: string) {
  if (!name) {
    return "---";
  }

  const cleaned = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(" ")
    .filter(Boolean)
    .at(-1) ?? name;

  return cleaned.toUpperCase().slice(0, 3);
}

function mapCrewToTimeline(members: Array<{ name?: string; trigram?: string; crewMemberId?: string; isCommander?: boolean }>) {
  return members.map((member) => ({
    trigram: member.trigram
      || (member.name ? toTrigram(member.name) : null)
      || (member.crewMemberId ? member.crewMemberId.slice(0, 3).toUpperCase() : null)
      || "---",
    isCommander: Boolean(member.isCommander)
  }));
}

function missionToBlock(mission: MissionCard): TimelineBlock {
  return {
    id: mission.id,
    code: mission.aircraftCode,
    title: mission.title,
    status: mission.status,
    isModified: mission.isModified,
    start: mission.departureTime,
    end: mission.landingTime,
    briefingTime: mission.briefingTime,
    aircraftCode: mission.aircraftCode,
    turnaroundMode: mission.turnaroundMode,
    constraintStatus: mission.constraintStatus,
    constraintEvaluations: mission.constraintEvaluations,
    kind: "mission",
    crew: mapCrewToTimeline(mission.crew)
  };
}

function alertToBlock(alert: AlertCard): TimelineBlock {
  return {
    id: alert.id,
    code: alert.aircraftCode,
    title: alert.missionLabel,
    status: alert.status,
    isModified: alert.isModified,
    start: alert.startTime,
    end: alert.endTime,
    briefingTime: alert.briefingTime,
    constraintStatus: alert.constraintStatus,
    constraintEvaluations: alert.constraintEvaluations,
    kind: "alert",
    crew: mapCrewToTimeline(alert.crew)
  };
}

function simulatorSessionToBlock(session: SimulatorSessionCard): TimelineBlock {
  return {
    id: session.id,
    code: session.simulatorCode,
    title: session.title,
    status: session.status,
    isModified: session.isModified,
    start: session.startTime,
    end: session.endTime,
    briefingTime: session.briefingTime,
    constraintStatus: session.constraintStatus,
    constraintEvaluations: session.constraintEvaluations,
    kind: "simulator",
    crew: mapCrewToTimeline(session.crew)
  };
}

function renderHourLabels() {
  return Array.from({ length: timelineEndHour - timelineStartHour }, (_, index) => {
    const hour = timelineStartHour + index;
    return (
      <div key={hour} className="timeline-hour">
        {`${(hour % 24).toString().padStart(2, "0")}:00`}
      </div>
    );
  });
}

const timelineSegmentCount = timelineEndHour - timelineStartHour;
const timelineHourLabelCount = timelineSegmentCount;

function buildSchedulePayload(
  block: PositionedBlock,
  startMinutes: number,
  endMinutes: number,
  planningDate: string,
  utcOffsetMinutes: number
): UpdatePlanningEntryScheduleInput {
  if (block.kind === "alert") {
    const originalStart = new Date(block.start).getTime();
    const originalBriefing = new Date(block.briefingTime ?? block.start).getTime();
    const briefingOffset = originalStart - originalBriefing;
    const newStartIso = toIsoOnPlanningWindow(planningDate, startMinutes, utcOffsetMinutes);
    const newEndIso = toIsoOnPlanningWindow(planningDate, endMinutes, utcOffsetMinutes);
    const newBriefingIso = new Date(new Date(newStartIso).getTime() - briefingOffset).toISOString();

    return {
      entryType: "alert",
      id: block.id,
      briefingTime: newBriefingIso,
      startTime: newStartIso,
      endTime: newEndIso
    };
  }

  if (block.kind === "simulator") {
    const originalStart = new Date(block.start).getTime();
    const originalBriefing = new Date(block.briefingTime ?? block.start).getTime();
    const briefingOffset = originalStart - originalBriefing;
    const newStartIso = toIsoOnPlanningWindow(planningDate, startMinutes, utcOffsetMinutes);
    const newEndIso = toIsoOnPlanningWindow(planningDate, endMinutes, utcOffsetMinutes);
    const newBriefingIso = new Date(new Date(newStartIso).getTime() - briefingOffset).toISOString();

    return {
      entryType: "simulator",
      id: block.id,
      startTime: newStartIso,
      endTime: newEndIso,
      briefingTime: newBriefingIso
    };
  }

  const originalDeparture = new Date(block.start).getTime();
  const originalBriefing = new Date(block.briefingTime ?? block.start).getTime();
  const briefingOffset = originalDeparture - originalBriefing;
  const newDepartureIso = toIsoOnPlanningWindow(planningDate, startMinutes, utcOffsetMinutes);
  const newLandingIso = toIsoOnPlanningWindow(planningDate, endMinutes, utcOffsetMinutes);
  const newBriefingIso = new Date(new Date(newDepartureIso).getTime() - briefingOffset).toISOString();

  return {
    entryType: "mission",
    id: block.id,
    departureTime: newDepartureIso,
    landingTime: newLandingIso,
    briefingTime: newBriefingIso
  };
}

type TimelineLaneProps = {
  label: string;
  showInteractionHint?: boolean;
  blocks: PositionedBlock[];
  planningDate: string;
  isUpdating: boolean;
  zoom: number;
  scrollRef: { current: HTMLDivElement | null };
  selectedEntryId: string | null;
  onSelectEntry: (payload: UpdatePlanningEntryDetailsInput["entryType"], id: string) => void;
  onScheduleChange: (payload: UpdatePlanningEntryScheduleInput) => Promise<void>;
  onDeleteEntry: (entry: { entryType: "mission" | "alert" | "simulator"; id: string }) => Promise<void>;
  onContextMenu?: (block: PositionedBlock, event: ReactPointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) => void;
  solarMarkers: ReturnType<typeof getSolarMarkers>;
  utcOffsetMinutes: number;
  readOnly?: boolean;
};

function TimelineLane({
  label,
  showInteractionHint = false,
  blocks,
  planningDate,
  isUpdating,
  zoom,
  scrollRef,
  selectedEntryId,
  onSelectEntry,
  onScheduleChange,
  onDeleteEntry,
  onContextMenu,
  solarMarkers,
  utcOffsetMinutes,
  readOnly = false
}: TimelineLaneProps) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const [activeInteraction, setActiveInteraction] = useState<ActiveInteraction | null>(null);
  const [preview, setPreview] = useState<{ id: string; startMinutes: number; endMinutes: number } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    if (!activeInteraction) {
      return;
    }

    const interaction = activeInteraction;

    function applyDelta(deltaMinutes: number) {
      if (interaction.mode === "drag") {
        const duration = interaction.endMinutes - interaction.startMinutes;
        let nextStart = interaction.startMinutes + deltaMinutes;
        nextStart = Math.max(0, Math.min(timelineMinutes - duration, nextStart));
        const nextEnd = nextStart + duration;
        setPreview({
          id: interaction.block.id,
          startMinutes: nextStart,
          endMinutes: nextEnd
        });
        if (deltaMinutes !== 0) {
          suppressClickRef.current = true;
        }
        return;
      }

      if (interaction.mode === "resize-start") {
        const nextStart = Math.max(0, Math.min(interaction.endMinutes - minimumBlockDuration, interaction.startMinutes + deltaMinutes));
        setPreview({
          id: interaction.block.id,
          startMinutes: nextStart,
          endMinutes: interaction.endMinutes
        });
        if (deltaMinutes !== 0) {
          suppressClickRef.current = true;
        }
        return;
      }

      const nextEnd = Math.max(interaction.startMinutes + minimumBlockDuration, Math.min(timelineMinutes, interaction.endMinutes + deltaMinutes));
      setPreview({
        id: interaction.block.id,
        startMinutes: interaction.startMinutes,
        endMinutes: nextEnd
      });
      if (deltaMinutes !== 0) {
        suppressClickRef.current = true;
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const deltaX = event.clientX - interaction.pointerStartX;
      const rawMinutes = (deltaX / interaction.laneWidth) * timelineMinutes;
      const snappedMinutes = Math.round(rawMinutes / snapMinutes) * snapMinutes;
      applyDelta(snappedMinutes);
    }

    function handlePointerUp() {
      const finalStart = preview?.id === interaction.block.id ? preview.startMinutes : interaction.startMinutes;
      const finalEnd = preview?.id === interaction.block.id ? preview.endMinutes : interaction.endMinutes;

      setActiveInteraction(null);
      setPreview(null);

      if (finalStart === interaction.startMinutes && finalEnd === interaction.endMinutes) {
        return;
      }

      void onScheduleChange(buildSchedulePayload(interaction.block, finalStart, finalEnd, planningDate, utcOffsetMinutes)).catch(() => undefined);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeInteraction, onScheduleChange, preview]);

  const displayedBlocks = useMemo(
    () => blocks.map((block) => {
      if (!preview || preview.id !== block.id) {
        return block;
      }

      return {
        ...block,
        startMinutes: preview.startMinutes,
        endMinutes: preview.endMinutes,
        left: (preview.startMinutes / timelineMinutes) * 100,
        width: ((preview.endMinutes - preview.startMinutes) / timelineMinutes) * 100
      };
    }),
    [blocks, preview]
  );

  const laneCount = Math.max(1, ...displayedBlocks.map((block) => block.lane + 1));

  function startInteraction(event: ReactPointerEvent, block: PositionedBlock, mode: InteractionMode) {
    if (readOnly || isUpdating || !laneRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    setActiveInteraction({
      block,
      mode,
      pointerStartX: event.clientX,
      laneWidth: laneRef.current.getBoundingClientRect().width,
      startMinutes: block.startMinutes,
      endMinutes: block.endMinutes
    });
    setPreview({
      id: block.id,
      startMinutes: block.startMinutes,
      endMinutes: block.endMinutes
    });
  }

  return (
    <section className="timeline-lane-section">
      <div className="timeline-lane-header">
        <p className="section-label">{label}</p>
        {showInteractionHint && !readOnly ? (
          <span>Glisser pour deplacer, etirer par les bords pour ajuster l'horaire.</span>
        ) : null}
      </div>
      <div className="timeline-lane-shell">
        <div ref={scrollRef} className="timeline-scroll timeline-lane-scroll">
          <div className="timeline-canvas" style={{ minWidth: `${Math.max(100, zoom)}%` }}>
            {solarMarkers ? (
              <div className="timeline-solar-overlay" aria-hidden="true">
                {solarMarkers.daylightSegments.map((segment, index) => (
                  <div
                    key={`solar-${label}-${index}`}
                    className="timeline-solar-day-segment"
                    style={{
                      left: `${(segment.startMinutes / timelineMinutes) * 100}%`,
                      width: `${((segment.endMinutes - segment.startMinutes) / timelineMinutes) * 100}%`
                    }}
                  />
                ))}
              </div>
            ) : null}
            <div
              className="timeline-grid-overlay"
              style={{ gridTemplateColumns: `repeat(${timelineSegmentCount}, minmax(0, 1fr))` }}
            >
              {Array.from({ length: timelineSegmentCount }, (_, index) => (
                <div key={index} className="timeline-grid-segment" />
              ))}
            </div>
            <div
              ref={laneRef}
              className="timeline-lane"
              style={{
                minHeight: `${laneCount * 112 + 12}px`
              }}
            >
              {displayedBlocks.map((block) => (
                <article
                  key={block.id}
                  className={`timeline-block ${block.kind} ${block.isModified ? "modified" : ""} ${block.status} ${isUpdating ? "disabled" : ""} ${selectedEntryId === block.id ? "selected" : ""}`}
                  style={{
                    left: `${block.left}%`,
                    width: `${block.width}%`,
                    top: `${block.lane * 104 + 8}px`
                  }}
                  onPointerDown={(event) => startInteraction(event, block, "drag")}
                  onClick={() => {
                    if (suppressClickRef.current) {
                      suppressClickRef.current = false;
                      return;
                    }
                    onSelectEntry(block.kind, block.id);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSelectEntry(block.kind, block.id);
                    onContextMenu?.(block, event);
                  }}
                >
                  {!readOnly ? (
                    <button
                      type="button"
                      className="timeline-quick-delete"
                      onPointerDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDeleteEntry({
                          entryType: block.kind,
                          id: block.id
                        });
                      }}
                      aria-label="Supprimer l'activite"
                    >
                      {"\u00D7"}
                    </button>
                  ) : null}
                  {!readOnly ? (
                    <button
                      type="button"
                      className="timeline-handle timeline-handle-start"
                      onPointerDown={(event) => startInteraction(event, block, "resize-start")}
                      aria-label="Avancer ou retarder le debut"
                    />
                  ) : null}
                  <div className="timeline-block-head">
                    <span className="timeline-block-code">{block.code}</span>
                    <span className={`status ${block.status}`}>{block.status}</span>
                  </div>
                  <p className="timeline-block-title">{block.title}</p>
                  {block.crew ? (
                    <p className="timeline-block-crew">
                      {block.crew.map((member, index) => (
                        <span key={`${block.id}-${member.trigram}-${index}`} className="timeline-block-crew-member">
                          {index > 0 ? <span className="timeline-block-crew-separator"> - </span> : null}
                          <span className={`timeline-block-crew-trigram ${member.isCommander ? "timeline-block-crew-commander" : ""}`}>{member.trigram}</span>
                        </span>
                      ))}
                    </p>
                  ) : null}
                  {!readOnly ? (
                    <button
                      type="button"
                      className="timeline-handle timeline-handle-end"
                      onPointerDown={(event) => startInteraction(event, block, "resize-end")}
                      aria-label="Etendre ou reduire la fin"
                    />
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function PlanningTimeline({
  planning,
  isUpdating,
  zoom,
  onZoomChange,
  selectedDate,
  onDateChange,
  dateLocked = false,
  selectedEntryId,
  onSelectEntry,
  onScheduleChange,
  onDeleteEntry,
  onMarkPlanned,
  enableContextActions = false,
  readOnly = false,
  timezoneCode,
  utcOffsetMinutes
}: PlanningTimelineProps) {
  const timelineRef = useRef<HTMLElement | null>(null);
  const hoursScrollRef = useRef<HTMLDivElement | null>(null);
  const missionScrollRef = useRef<HTMLDivElement | null>(null);
  const alertScrollRef = useRef<HTMLDivElement | null>(null);
  const simulatorScrollRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{ block: PositionedBlock; x: number; y: number } | null>(null);
  const missionBlocks = assignLanes(planning.missions.map(missionToBlock), planning.date, utcOffsetMinutes);
  const alertBlocks = assignLanes(planning.alerts.map(alertToBlock), planning.date, utcOffsetMinutes);
  const simulatorBlocks = assignLanes(planning.simulatorSessions.map(simulatorSessionToBlock), planning.date, utcOffsetMinutes);
  const solarMarkers = useMemo(() => getSolarMarkers(planning), [planning]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function handleClose() {
      setContextMenu(null);
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    window.addEventListener("click", handleClose);
    window.addEventListener("contextmenu", handleClose);
    window.addEventListener("keydown", handleKey);

    return () => {
      window.removeEventListener("click", handleClose);
      window.removeEventListener("contextmenu", handleClose);
      window.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    const node = timelineRef.current;
    if (!node) {
      return;
    }

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey || event.deltaY === 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const direction = event.deltaY > 0 ? -10 : 10;
      onZoomChange(Math.max(100, Math.min(240, zoom + direction)));
    }

    node.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      node.removeEventListener("wheel", handleWheel);
    };
  }, [onZoomChange, zoom]);

  useEffect(() => {
    const nodes = [hoursScrollRef.current, missionScrollRef.current, alertScrollRef.current, simulatorScrollRef.current].filter(
      (node): node is HTMLDivElement => node !== null
    );

    if (nodes.length < 2) {
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
  }, [zoom]);

  function handleContextMenu(block: PositionedBlock, event: ReactPointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) {
    if (!enableContextActions || readOnly) {
      return;
    }
    const container = timelineRef.current;
    if (!container) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const rawX = event.clientX - rect.left;
    const rawY = event.clientY - rect.top;
    const x = Math.max(12, Math.min(rawX, rect.width - 220));
    const y = Math.max(12, Math.min(rawY, rect.height - 140));
    setContextMenu({ block, x, y });
  }

  function canMarkPlanned(block: PositionedBlock) {
    if (block.status !== "draft") {
      return false;
    }
    if (block.constraintStatus === "blocking") {
      return false;
    }
    if (block.constraintStatus === "compliant") {
      return true;
    }
    const evaluations = block.constraintEvaluations ?? [];
    if (evaluations.length === 0) {
      return false;
    }
    const unresolvedWarning = evaluations.some((evaluation) => evaluation.details.some((detail) => detail.status === "warning" && !detail.isOverridden));
    const hasBlocking = evaluations.some((evaluation) => evaluation.details.some((detail) => detail.status === "blocking"));
    return !hasBlocking && !unresolvedWarning;
  }

  return (
    <section ref={timelineRef} className="panel timeline-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Feuille des vols</p>
          <h2>{planning.flottilleName} - {planning.platform.name} ({timezoneCode})</h2>
        </div>
        <div className="timeline-header-tools">
          {solarMarkers ? (
            <div className="solar-chip">
              Lever {formatHour(solarMarkers.sunrise.toISOString(), utcOffsetMinutes)} {"\u2022"} Coucher {formatHour(solarMarkers.sunset.toISOString(), utcOffsetMinutes)}
            </div>
          ) : null}
          <div className="date-chip">{`${planning.platform.code} \u2022 ${timezoneCode} (UTC ${utcOffsetMinutes >= 0 ? "+" : ""}${(utcOffsetMinutes / 60).toString().padStart(2, "0")}:00)`}</div>
          <label className="zoom-control">
            Zoom
            <input
              type="range"
              min={100}
              max={240}
              step={10}
              value={zoom}
              onChange={(event) => onZoomChange(Number(event.target.value))}
            />
            <span>{zoom}%</span>
          </label>
          <label className="date-chip-control">
            <span>Date</span>
            <input
              type="date"
              value={selectedDate}
              disabled={dateLocked}
              onChange={(event) => onDateChange(event.target.value)}
            />
          </label>
        </div>
      </div>

      <div ref={hoursScrollRef} className="timeline-scroll timeline-hours-scroll">
        <div className="timeline-canvas" style={{ minWidth: `${Math.max(100, zoom)}%` }}>
          <div className="timeline-hours-shell">
            <div
              className="timeline-hours"
              style={{ gridTemplateColumns: `repeat(${timelineHourLabelCount}, minmax(0, 1fr))` }}
            >
              {renderHourLabels()}
            </div>
          </div>
        </div>
      </div>

      <div className="timeline-stack">
        <TimelineLane
          label="Missions"
          showInteractionHint
          blocks={missionBlocks}
          planningDate={planning.date}
          isUpdating={isUpdating}
          zoom={zoom}
          scrollRef={missionScrollRef}
          selectedEntryId={selectedEntryId}
          onSelectEntry={onSelectEntry}
          onScheduleChange={onScheduleChange}
          onDeleteEntry={onDeleteEntry}
          onContextMenu={handleContextMenu}
          solarMarkers={solarMarkers}
          utcOffsetMinutes={utcOffsetMinutes}
          readOnly={readOnly}
        />
        <TimelineLane
          label="Alertes"
          blocks={alertBlocks}
          planningDate={planning.date}
          isUpdating={isUpdating}
          zoom={zoom}
          scrollRef={alertScrollRef}
          selectedEntryId={selectedEntryId}
          onSelectEntry={onSelectEntry}
          onScheduleChange={onScheduleChange}
          onDeleteEntry={onDeleteEntry}
          onContextMenu={handleContextMenu}
          solarMarkers={solarMarkers}
          utcOffsetMinutes={utcOffsetMinutes}
          readOnly={readOnly}
        />
        <TimelineLane
          label="Simulateur"
          blocks={simulatorBlocks}
          planningDate={planning.date}
          isUpdating={isUpdating}
          zoom={zoom}
          scrollRef={simulatorScrollRef}
          selectedEntryId={selectedEntryId}
          onSelectEntry={onSelectEntry}
          onScheduleChange={onScheduleChange}
          onDeleteEntry={onDeleteEntry}
          onContextMenu={handleContextMenu}
          solarMarkers={solarMarkers}
          utcOffsetMinutes={utcOffsetMinutes}
          readOnly={readOnly}
        />
      </div>

      {contextMenu ? (
        <div
          className="timeline-context-menu"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        >
          {contextMenu.block.status === "draft" && canMarkPlanned(contextMenu.block) ? (
            <>
              <button
                type="button"
                className="timeline-context-item"
                disabled={!onMarkPlanned}
                onClick={() => {
                  setContextMenu(null);
                  if (onMarkPlanned) {
                    void onMarkPlanned({
                      entryType: contextMenu.block.kind,
                      id: contextMenu.block.id
                    });
                  }
                }}
              >
                Passer en planned
              </button>
            </>
          ) : (
            <span className="timeline-context-hint">Aucune action disponible</span>
          )}
        </div>
      ) : null}
    </section>
  );
}
