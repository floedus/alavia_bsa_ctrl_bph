function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function formatUtcDateParts(timestamp: number) {
  const shifted = new Date(timestamp);
  const year = shifted.getUTCFullYear();
  const month = pad(shifted.getUTCMonth() + 1);
  const day = pad(shifted.getUTCDate());
  const hours = pad(shifted.getUTCHours());
  const minutes = pad(shifted.getUTCMinutes());
  return { year, month, day, hours, minutes };
}

function isPlatformLocalDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)
    && !(/[zZ]$/.test(value) || /[+-]\d{2}:\d{2}$/.test(value));
}

export function formatDateTimeLocalForPlatform(value: string, utcOffsetMinutes: number) {
  if (!value) {
    return "";
  }

  if (isPlatformLocalDateTime(value)) {
    return value.slice(0, 16);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value.slice(0, 16);
  }

  const shifted = new Date(parsed.getTime() + utcOffsetMinutes * 60000);
  const { year, month, day, hours, minutes } = formatUtcDateParts(shifted.getTime());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function formatTimeLocalForPlatform(value: string, utcOffsetMinutes: number) {
  const local = formatDateTimeLocalForPlatform(value, utcOffsetMinutes);
  return local ? local.slice(11, 16) : "";
}

export function platformDateTimeLocalToIso(value: string, utcOffsetMinutes: number) {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) {
    return new Date(value).toISOString();
  }

  const [year, month, day] = datePart.split("-").map((item) => Number(item));
  const [hours, minutes] = timePart.split(":").map((item) => Number(item));
  const utcTimestamp = Date.UTC(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0, 0, 0) - (utcOffsetMinutes * 60000);
  return new Date(utcTimestamp).toISOString();
}

export function shiftPlatformLocalDateTime(value: string, minuteDelta: number) {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) {
    return value;
  }

  const [year, month, day] = datePart.split("-").map((item) => Number(item));
  const [hours, minutes] = timePart.split(":").map((item) => Number(item));
  const shiftedUtcTimestamp = Date.UTC(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0, 0, 0) + (minuteDelta * 60000);
  const shifted = formatUtcDateParts(shiftedUtcTimestamp);
  return `${shifted.year}-${shifted.month}-${shifted.day}T${shifted.hours}:${shifted.minutes}`;
}

export function shiftPlatformDate(date: string, dayDelta: number) {
  return shiftPlatformLocalDateTime(`${date}T00:00`, dayDelta * 24 * 60).slice(0, 10);
}

export function formatPlatformLocalDateTimeLabel(value: string) {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) {
    return value;
  }

  const [year, month, day] = datePart.split("-");
  const [hours, minutes] = timePart.split(":");
  return `${day}/${month}/${year} ${hours}:${minutes}`;
}

export function planningTimeOnDateToIso(
  planningDate: string,
  time: string,
  utcOffsetMinutes: number,
  nextDayThresholdHour = 6
) {
  const [hours] = time.split(":").map((item) => Number(item));
  const [year, month, day] = planningDate.split("-").map((item) => Number(item));
  const dayOffset = Number.isFinite(hours) && hours < nextDayThresholdHour ? 1 : 0;
  const localDate = `${year.toString().padStart(4, "0")}-${pad(month || 1)}-${pad((day || 1) + dayOffset)}T${time}`;
  return platformDateTimeLocalToIso(localDate, utcOffsetMinutes);
}
