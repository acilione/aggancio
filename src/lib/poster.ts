import { classify } from './events';
import type { PosterSuggestion } from './types';

const monthNames = ['gennaio|january|gen', 'febbraio|february|feb', 'marzo|march|mar', 'aprile|april|apr', 'maggio|may|mag', 'giugno|june|giu', 'luglio|july|lug', 'agosto|august|ago', 'settembre|september|sett?|sep', 'ottobre|october|ott|oct', 'novembre|november|nov', 'dicembre|december|dic|dec'];
const monthPattern = monthNames.map((names) => `(?:${names})`).join('|');
function validDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
export function extractPoster(text: string, referenceYear = new Date().getFullYear()): PosterSuggestion {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const dates = new Set<string>();
  const warnings = ['Check the title, venue and every date against the poster. Extraction is a suggestion.'];
  let usedReferenceYear = false;
  const named = new RegExp(`((?:\\d{1,2}\\s*(?:,|;|e\\b|and\\b|&|al\\b|to\\b|[-–])\\s*)*\\d{1,2})\\s+(${monthPattern})\\.?(?:\\s+(20\\d{2}))?`, 'gi');
  for (const match of text.matchAll(named)) {
    const month = monthNames.findIndex(names => new RegExp(`^(?:${names})$`, 'i').test(match[2])) + 1;
    const year = match[3] ? Number(match[3]) : referenceYear;
    if (!match[3]) usedReferenceYear = true;
    const days = match[1].match(/\d{1,2}/g) || [];
    if (/\bal\b|\bto\b|[-–]/i.test(match[1])) warnings.push('A date range was detected. Only its endpoints are suggested; choose a continuous end date or add the actual sessions.');
    for (const day of days) { const value = validDate(year, month, Number(day)); if (value) dates.add(value); }
  }
  for (const match of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})(?:[/.](20\d{2}|\d{2}))?\b/g)) {
    // A dot-separated clock is not a date when explicitly introduced by ore/h/at.
    const before = text.slice(Math.max(0, match.index! - 8), match.index);
    if (/(?:ore|alle|at|h)\s*$/i.test(before)) continue;
    const year = match[3] ? Number(match[3]) + (match[3].length === 2 ? 2000 : 0) : referenceYear;
    const value = validDate(year, Number(match[2]), Number(match[1]));
    if (value) { dates.add(value); if (!match[3]) usedReferenceYear = true; }
  }
  for (const match of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) { const value = validDate(Number(match[1]), Number(match[2]), Number(match[3])); if (value) dates.add(value); }
  if (usedReferenceYear) warnings.push(`Some dates have no year. ${referenceYear} was used; please confirm it.`);
  if (!dates.size) warnings.push('No reliable date was found. Add the dates manually.');
  const timeMatch = text.match(/(?:ore|alle|at|h)\s*(\d{1,2})(?:[:.](\d{2}))?\b/i) || text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  const hour = timeMatch ? Number(timeMatch[1]) : -1;
  const minute = timeMatch?.[2] ? Number(timeMatch[2]) : 0;
  const time = hour >= 0 && hour <= 23 && minute <= 59 ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : '';
  if (!time) warnings.push('No reliable start time was found. Enter it before saving.');
  const venue = lines.find(line => /^(?:presso|luogo|venue|dove|location)\s*[:\-]?\s+/i.test(line))?.replace(/^(?:presso|luogo|venue|dove|location)\s*[:\-]?\s+/i, '') || '';
  const city = ['Reggio Calabria', 'Torino', 'London', 'Milano', 'Roma', 'Bologna', 'Napoli', 'Firenze', 'Palermo'].find(city => text.toLowerCase().includes(city.toLowerCase())) || '';
  return { title: lines.find(line => line.length > 4 && !/^\d|^(?:ore|dal|dalle|presso)\b/i.test(line)) || '', description: text.trim(), venue, city, category: classify(text)[0], dates: [...dates].sort(), time, warnings: [...new Set(warnings)] };
}
export function zonedDateTimeToISO(local: string, timezone: string): string {
  const target = new Date(local + 'Z');
  if (!Number.isFinite(target.getTime())) throw new Error('Enter a valid date and time.');
  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  let guess = target.getTime();
  for (let i = 0; i < 3; i++) {
    const rendered = formatter.format(new Date(guess)).replace(' ', 'T');
    const difference = target.getTime() - new Date(rendered + 'Z').getTime();
    if (!difference) return new Date(guess).toISOString();
    guess += difference;
  }
  throw new Error('This time does not exist in the selected timezone (possibly a daylight-saving change).');
}
export function localDateTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)).replace(' ', 'T');
}
