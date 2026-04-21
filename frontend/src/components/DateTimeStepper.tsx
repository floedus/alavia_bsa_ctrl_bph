import { useEffect, useRef } from "react";
import { formatPlatformLocalDateTimeLabel, shiftPlatformLocalDateTime } from "./platformTime";

type DateTimeStepperProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minValue?: string;
  maxValue?: string;
  stepMinutes?: number;
  onBlur?: () => void;
};

export function DateTimeStepper({
  label,
  value,
  onChange,
  minValue,
  maxValue,
  stepMinutes = 5,
  onBlur
}: DateTimeStepperProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef(value);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => () => stopStepping(), []);

  function clampValue(nextValue: string) {
    if (minValue && nextValue < minValue) {
      return minValue;
    }

    if (maxValue && nextValue > maxValue) {
      return maxValue;
    }

    return nextValue;
  }

  function applyStep(direction: 1 | -1) {
    const nextValue = clampValue(shiftPlatformLocalDateTime(valueRef.current, direction * stepMinutes));
    if (nextValue !== valueRef.current) {
      valueRef.current = nextValue;
      onChange(nextValue);
    }
  }

  function focusDisplay() {
    if (!inputRef.current) {
      return;
    }
    inputRef.current.focus();
    inputRef.current.select();
  }

  function stopStepping() {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function startStepping(direction: 1 | -1) {
    focusDisplay();
    applyStep(direction);
    stopStepping();
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => applyStep(direction), 50);
    }, 300);
  }

  const canStepUp = !maxValue || value < maxValue;
  const canStepDown = !minValue || value > minValue;

  return (
    <div className="date-time-stepper">
      <span className="date-time-stepper-label">{label}</span>
      <div className="date-time-stepper-control">
        <input
          ref={inputRef}
          className="date-time-stepper-display"
          value={formatPlatformLocalDateTimeLabel(value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={onBlur}
          readOnly
          aria-label={label}
        />
        <div className="date-time-stepper-buttons">
          <button
            type="button"
            className="date-time-stepper-button"
            onMouseDown={(event) => {
              event.preventDefault();
              startStepping(1);
            }}
            onMouseUp={stopStepping}
            onMouseLeave={stopStepping}
            onTouchStart={(event) => {
              event.preventDefault();
              startStepping(1);
            }}
            onTouchEnd={stopStepping}
            disabled={!canStepUp}
            aria-label={`Augmenter ${label}`}
          >
            ▲
          </button>
          <button
            type="button"
            className="date-time-stepper-button"
            onMouseDown={(event) => {
              event.preventDefault();
              startStepping(-1);
            }}
            onMouseUp={stopStepping}
            onMouseLeave={stopStepping}
            onTouchStart={(event) => {
              event.preventDefault();
              startStepping(-1);
            }}
            onTouchEnd={stopStepping}
            disabled={!canStepDown}
            aria-label={`Diminuer ${label}`}
          >
            ▼
          </button>
        </div>
      </div>
    </div>
  );
}
