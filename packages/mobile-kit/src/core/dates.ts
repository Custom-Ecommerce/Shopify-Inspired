const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26 Nov, 3:05 pm" in the phone's time zone; the year only when it is not this year. "-" for a missing or unreadable date. */
export function formatDateTime(value: string | number | null | undefined, now: Date = new Date()): string {
  if (value === null || value === undefined || value === '') return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const hours = date.getHours();
  const year = date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${year}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`;
}
