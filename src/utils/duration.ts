/**
 * Calculate duration in minutes between two time strings.
 *
 * If the end time is earlier than the start time the shift is considered
 * overnight: the end time belongs to the next day (17:00 -> 05:00 = 12h).
 * The hours are always attributed to the starting day, i.e. to the
 * dataRiferimento of the activity.
 *
 * @param oraInizio Start time in HH:mm format
 * @param oraFine End time in HH:mm format
 * @returns Duration in minutes
 */
export function calculateDurationMinutes(
  oraInizio: string,
  oraFine: string
): number {
  const [startHours, startMinutes] = oraInizio.split(':').map(Number);
  const [endHours, endMinutes] = oraFine.split(':').map(Number);

  if (
    startHours === undefined ||
    startMinutes === undefined ||
    endHours === undefined ||
    endMinutes === undefined
  ) {
    throw new Error('Invalid time format. Expected HH:mm');
  }

  const startTotalMinutes = startHours * 60 + startMinutes;
  let endTotalMinutes = endHours * 60 + endMinutes;

  if (endTotalMinutes === startTotalMinutes) {
    throw new Error('End time must be different from start time');
  }

  // Overnight shift: the end time belongs to the next day
  if (endTotalMinutes < startTotalMinutes) {
    endTotalMinutes += 24 * 60;
  }

  return endTotalMinutes - startTotalMinutes;
}

/**
 * Format minutes to HH:mm display string
 *
 * I minuti possono essere negativi (le assenze di tipo "Recupero ore" valgono
 * -492): il segno va anteposto alla stringa intera, scomporre il negativo con
 * Math.floor darebbe "-9h -12m".
 *
 * @param minutes Total minutes
 * @returns Formatted string like "2h 30m", "45m" or "-8h 12m"
 */
export function formatDuration(minutes: number): string {
  const segno = minutes < 0 ? '-' : '';
  const assoluti = Math.abs(minutes);
  const hours = Math.floor(assoluti / 60);
  const mins = assoluti % 60;

  if (hours === 0) {
    return `${segno}${mins}m`;
  }
  if (mins === 0) {
    return `${segno}${hours}h`;
  }
  return `${segno}${hours}h ${mins}m`;
}

/**
 * Validate time string format
 * @param time Time string to validate
 * @returns True if valid HH:mm format
 */
export function isValidTimeFormat(time: string): boolean {
  const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  return regex.test(time);
}
