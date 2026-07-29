/**
 * Calculate duration in minutes between two time strings
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
  const endTotalMinutes = endHours * 60 + endMinutes;

  if (endTotalMinutes <= startTotalMinutes) {
    throw new Error('End time must be after start time');
  }

  return endTotalMinutes - startTotalMinutes;
}

/**
 * Format minutes to HH:mm display string
 * @param minutes Total minutes
 * @returns Formatted string like "2h 30m" or "45m"
 */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) {
    return `${mins}m`;
  }
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
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

/**
 * Check if a date is within the same week (Monday-Sunday)
 * @param date Date to check
 * @param referenceDate Reference date (defaults to now)
 * @returns True if within the same week
 */
export function isWithinSameWeek(
  date: Date,
  referenceDate: Date = new Date()
): boolean {
  const getMonday = (d: Date): Date => {
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    monday.setHours(0, 0, 0, 0);
    return monday;
  };

  const getSunday = (d: Date): Date => {
    const monday = getMonday(d);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return sunday;
  };

  const weekStart = getMonday(referenceDate);
  const weekEnd = getSunday(referenceDate);

  return date >= weekStart && date <= weekEnd;
}
