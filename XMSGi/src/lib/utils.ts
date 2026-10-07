export function getTimezoneLabel(): string {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const offset = `GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const country = timezone === 'Europe/Helsinki' ? 'Finland' : timezone.split('/')[0] || timezone || 'Local time';

  return `${country} · ${offset} (${offset})`;
}

export { formatDateTime, getTimezoneParts, getTodayStr, getCurrentTimeStr, uid } from '@shared/utils';

