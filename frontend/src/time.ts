const zone = 'Europe/Copenhagen';
const dateFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
});
export function previousDanishDay(now = new Date()): string {
  const parts = Object.fromEntries(dateFormat.formatToParts(now).map(p => [p.type, p.value]));
  const calendar = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() - 1);
  return calendar.toISOString().slice(0, 10);
}
export function copenhagenTimestamp(instant: number | string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(instant)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${parts.timeZoneName.replace('GMT', 'UTC')}`;
}
export const clockLabel = (instant: number) => new Intl.DateTimeFormat('en-GB', {
  timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(instant));
