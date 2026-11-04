export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formattedDate = date.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const formattedTime = date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formattedDate.replace(/\s*р\.\s*$/, '')} · ${formattedTime}`;
}

export function getTimezoneParts(): {
  offset: string;
  city: string;
} {
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const city = tzName.split('/')[1] || tzName;
  const offsetStr = minutes > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : `${hours}`;
  return {
    offset: `UTC${sign}${offsetStr}`,
    city: city ? `· (${city})` : '',
  };
}

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

export function getTodayStr(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 1);
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCurrentTimeStr(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

