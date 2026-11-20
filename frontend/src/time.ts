export function localValue(instant: string | Date, zone: string) {
  const date = typeof instant === 'string' ? new Date(instant) : instant;
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const value = (key: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === key)?.value;
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

export const dateKey = (instant: string | Date, zone: string) => localValue(instant, zone).slice(0, 10);
export const todayIn = (zone: string) => dateKey(new Date(), zone);
export const localClock = (instant: string, zone: string) => localValue(instant, zone).slice(11);
export const calendarDate = (key: string) => new Date(`${key}T12:00:00Z`);

export function addDays(key: string, count: number) {
  const date = calendarDate(key);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}

export function monday(key: string) {
  return addDays(key, -((calendarDate(key).getUTCDay() + 6) % 7));
}

export function addMonths(key: string, count: number) {
  const date = calendarDate(key);
  const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1, 12));
  const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate();
  month.setUTCDate(Math.min(date.getUTCDate(), last));
  return month.toISOString().slice(0, 10);
}

export function dateLabel(key: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(calendarDate(key));
}

export function eventTime(start: string, end: string, zone: string, day?: string) {
  const first = dateKey(start, zone);
  const last = dateKey(end, zone);
  const from = day && first < day ? '00:00' : localClock(start, zone);
  const to = day && last > day ? '24:00' : localClock(end, zone);
  const spansDays = (calendarDate(last).getTime() - calendarDate(first).getTime()) / 86400000;
  return `${from} – ${to}${!day && spansDays > 0 ? ` (+${spansDays} дн.)` : ''}`;
}

export const weekDays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
