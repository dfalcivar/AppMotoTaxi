export type RegistrationPeriod = 'ALL' | 'TODAY' | 'LAST_7_DAYS' | 'LAST_30_DAYS' | 'CUSTOM';

export function ecuadorCalendarDate(value: string | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function registrationDateRange(period: RegistrationPeriod, today: string, from: string, to: string) {
  if (period === 'ALL') return {from: '', to: ''};
  if (period === 'CUSTOM') return {from, to};
  if (period === 'TODAY') return {from: today, to: today};
  const first = new Date(`${today}T00:00:00Z`);
  first.setUTCDate(first.getUTCDate() - (period === 'LAST_7_DAYS' ? 6 : 29));
  return {from: first.toISOString().slice(0, 10), to: today};
}

export function registeredInRange(createdAt: string | null | undefined, from: string, to: string) {
  const day = createdAt && ecuadorCalendarDate(createdAt);
  return Boolean(day && (!from || day >= from) && (!to || day <= to));
}
