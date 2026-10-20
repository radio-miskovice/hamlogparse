import { ediBand } from './bands';
import type { ParsedLog, SortDirection } from './types';

function sortValue(value: string, field: string): number | string {
  if (field === 'BAND') return ediBand(value)?.min ?? value.toUpperCase();
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(Number(value)))
    return Number(value);
  return value.toUpperCase();
}

export function sortLog(
  log: ParsedLog,
  field: string,
  direction: SortDirection = 'asc',
): ParsedLog {
  const key = field.trim().toUpperCase();
  if (!key) throw new Error('Sort field must not be empty.');
  if (direction !== 'asc' && direction !== 'desc')
    throw new Error(`Unsupported sort direction: ${String(direction)}.`);

  const multiplier = direction === 'asc' ? 1 : -1;
  const records = log.records.map((record) => {
    const value = record[key]?.trim() ?? '';
    return { record, value: value ? sortValue(value, key) : undefined };
  });
  records.sort((a, b) => {
    if (a.value === undefined) return b.value === undefined ? 0 : 1;
    if (b.value === undefined) return -1;
    if (typeof a.value === 'number' && typeof b.value === 'number')
      return (a.value - b.value) * multiplier;
    if (typeof a.value !== typeof b.value)
      return (typeof a.value === 'number' ? -1 : 1) * multiplier;
    return (a.value < b.value ? -1 : a.value > b.value ? 1 : 0) * multiplier;
  });
  return { ...log, records: records.map(({ record }) => record) };
}
