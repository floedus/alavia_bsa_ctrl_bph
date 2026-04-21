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
