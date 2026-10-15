import { bandAt, bands, ediBand } from './bands';
import {
  supportedLogFormats,
  type LogInput,
  type LogRecord,
  type ParsedLog,
  type SupportedLogFormat,
} from './types';

const decoder = new TextDecoder('utf-8', { fatal: true });
export const cabrilloWidths = [5, 2, 10, 4, 13, 3, 6, 13, 3, 6];
const ediModes: Record<string, string> = {
  '1': 'SSB',
  '2': 'CW',
  '3': 'SSB',
  '4': 'CW',
  '5': 'AM',
  '6': 'FM',
  '7': 'MFSK',
  '8': 'SSTV',
  '9': 'ATV',
};

function asText(input: LogInput): string {
  try {
    return typeof input === 'string' ? input : decoder.decode(input);
  } catch (error) {
    throw new Error('Log data must be valid UTF-8.', { cause: error });
  }
}

function detectFormat(text: string): SupportedLogFormat {
  if (/^\s*\[REG1TEST\s*;/im.test(text)) return 'edi';
  if (/^\s*(?:START-OF-LOG:|QSO:)/im.test(text)) return 'cabrillo';
  if (/<\s*(?:EOH|EOR)(?::0)?\s*>/i.test(text)) return 'adif';
  throw new Error('Unable to detect log format; specify format explicitly.');
}

function parseAdif(text: string): LogRecord[] {
  const bytes = new TextEncoder().encode(text);
  const records: LogRecord[] = [];
  let record: LogRecord = {};
  let position = 0;
  while (position < bytes.length) {
    const open = bytes.indexOf(60, position);
    if (open < 0) break;
    const close = bytes.indexOf(62, open + 1);
    if (close < 0) throw new Error("Malformed ADIF tag: missing closing '>'.");
    const tag = decoder.decode(bytes.subarray(open + 1, close)).trim();
    position = close + 1;
    if (/^EOH(?::0)?$/i.test(tag)) {
      record = {};
      continue;
    }
    if (/^EOR(?::0)?$/i.test(tag)) {
      if (Object.keys(record).length > 0) records.push(record);
      record = {};
      continue;
    }
    const match = /^([A-Z0-9_]+):(\d+)(?::[^>]*)?$/i.exec(tag);
    if (!match) throw new Error(`Malformed ADIF tag: <${tag}>.`);
    const length = Number(match[2]);
    if (!Number.isSafeInteger(length) || position + length > bytes.length) {
      throw new Error(`Invalid byte length for ADIF field ${match[1]}.`);
    }
    record[match[1].toUpperCase()] = decoder.decode(bytes.subarray(position, position + length));
    position += length;
  }
  if (Object.keys(record).length) throw new Error('Incomplete ADIF record: missing <EOR>.');
  return records;
}

function headers(text: string, separator: ':' | '='): LogRecord {
  const result: LogRecord = {};
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(?:QSO\s*:|\[Remarks\]|\[QSORecords)/i.test(line)) break;
    const index = line.indexOf(separator);
    if (index >= 0)
      result[line.slice(0, index).trim().toUpperCase()] = line.slice(index + 1).trim();
  }
  return result;
}

function fixedCabrillo(body: string): string[] | undefined {
  let offset = 0;
  const columns = cabrilloWidths.map((width) => {
    const value = body.slice(offset, offset + width).trim();
    offset += width + 1;
    return value;
  });
  const separators = cabrilloWidths.map(
    (width, index) =>
      cabrilloWidths.slice(0, index + 1).reduce((sum, item) => sum + item + 1, 0) - 1,
  );
  if (body.length < offset - 1 || separators.slice(0, -1).some((index) => body[index] !== ' '))
    return;
  if (columns[2] && !/^\d{4}-\d{2}-\d{2}$/.test(columns[2])) return;
  if (columns[3] && !/^\d{4}$/.test(columns[3])) return;
  if (columns[4] && !isCallsign(columns[4])) return;
  if (columns[7] && !isCallsign(columns[7])) return;
  const tail = body.slice(offset - 1).trim();
  if (tail && !/^[01]$/.test(tail)) return;
  return columns;
}

function exchange(record: LogRecord, side: 'STX' | 'SRX', tokens: string[]): void {
  if (/^\d{2,3}$/.test(tokens[0] ?? '')) {
    record[side === 'STX' ? 'RST_SENT' : 'RST_RCVD'] = tokens.shift()!;
  }
  if (tokens.length) record[`${side}_STRING`] = tokens.join(' ');
}

function parseCabrillo(text: string): ParsedLog {
  const h = headers(text, ':');
  const metadata: LogRecord = {
    STATION_CALLSIGN: h.CALLSIGN ?? '',
    MY_GRIDSQUARE: h['GRID-LOCATOR'] ?? '',
    CONTEST_ID: h.CONTEST ?? '',
  };
  const records: LogRecord[] = [];
  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const match = /^\s*QSO\s*: ?(.*)$/i.exec(rawLine);
    if (!match) continue;
    const fixed = fixedCabrillo(match[1]);
    let record: LogRecord;
    let frequency: string;
    if (fixed) {
      frequency = fixed[0];
      record = {
        MODE: cabrilloMode(fixed[1]),
        QSO_DATE: fixed[2].replace(/-/g, ''),
        TIME_ON: fixed[3],
        STATION_CALLSIGN: fixed[4],
        RST_SENT: fixed[5],
        STX_STRING: fixed[6],
        CALL: fixed[7],
        RST_RCVD: fixed[8],
        SRX_STRING: fixed[9],
      };
    } else {
      const tokens = match[1].trim().split(/\s+/);
      if (
        tokens.length < 5 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(tokens[2]) ||
        !/^\d{4}$/.test(tokens[3])
      ) {
        throw new Error(`Malformed Cabrillo QSO record on line ${lineIndex + 1}.`);
      }
      const ownCall = isCallsign(tokens[4]);
      const workedIndex = tokens.findIndex(
        (token, index) => index >= (ownCall ? 5 : 4) && isCallsign(token),
      );
      if (workedIndex < 0)
        throw new Error(
          `Unable to locate contacted station in Cabrillo QSO on line ${lineIndex + 1}.`,
        );
      frequency = tokens[0];
      record = {
        MODE: cabrilloMode(tokens[1]),
        QSO_DATE: tokens[2].replace(/-/g, ''),
        TIME_ON: tokens[3],
        STATION_CALLSIGN: ownCall ? tokens[4] : metadata.STATION_CALLSIGN,
        CALL: tokens[workedIndex],
      };
      exchange(record, 'STX', tokens.slice(ownCall ? 5 : 4, workedIndex));
      const received = tokens.slice(workedIndex + 1);
      if (
        (received.length >= 3 || (received.length === 2 && /^[A-R]{2}\d{2}/i.test(received[0]))) &&
        /^[01]$/.test(received[received.length - 1])
      )
        received.pop();
      exchange(record, 'SRX', received);
    }
    const band = bands.find(({ cabrillo }) => cabrillo === frequency.toUpperCase());
    if (band && band.min >= 50) record.BAND = band.name;
    else if (frequency) {
      if (!/^\d+(?:\.\d+)?$/.test(frequency) || Number(frequency) <= 0) {
        throw new Error(`Unsupported Cabrillo frequency "${frequency}" on line ${lineIndex + 1}.`);
      }
      record.FREQ = String(Number(frequency) / 1000);
    }
    for (const [key, value] of Object.entries(metadata))
      if (value && !record[key]) record[key] = value;
    records.push(record);
  }
  return { format: 'cabrillo', records, metadata };
}

function parseEdi(text: string): ParsedLog {
  const h = headers(text, '=');
  const metadata: LogRecord = {
    STATION_CALLSIGN: h.PCALL ?? '',
    MY_GRIDSQUARE: h.PWWLO ?? '',
    CONTEST_ID: h.TNAME ?? '',
  };
  const common: LogRecord = {};
  for (const [key, value] of Object.entries(metadata)) if (value) common[key] = value;
  if (h.PBAND) {
    const band = ediBand(h.PBAND);
    if (!band) throw new Error(`Unsupported EDI PBand value: "${h.PBAND}".`);
    common.BAND = band.name;
  }
  const records: LogRecord[] = [];
  let reading = false;
  let expected: number | undefined;
  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    const section = /^\[QSORecords;(\d+)\]$/i.exec(line);
    if (section) {
      if (expected !== undefined)
        throw new Error('Multiple EDI QSORecords sections are not supported.');
      expected = Number(section[1]);
      reading = true;
      continue;
    }
    if (line.startsWith('[')) reading = false;
    if (!reading || !line || line.startsWith('#')) continue;
    const c = line.split(';').map((value) => value.trim());
    if (c.length < 10) throw new Error(`Malformed EDI QSO record on line ${lineIndex + 1}.`);
    // Older exporters omit the empty received-exchange column before the locator.
    if (/^[A-R]{2}\d{2}(?:[A-X]{2})?$/i.test(c[8]) && !/^[A-R]{2}\d{2}/i.test(c[9])) {
      c.splice(8, 0, '');
    }
    const record: LogRecord = {
      ...common,
      QSO_DATE: ediDate(c[0], h.TDATE),
      TIME_ON: c[1],
      CALL: c[2],
      RST_SENT: c[4],
      STX_STRING: c[5],
      RST_RCVD: c[6],
      SRX_STRING: c[7],
      GRIDSQUARE: c[9],
    };
    if (c[8]) record.SRX_STRING = [c[7], c[8]].filter(Boolean).join(' ');
    if (c[3] && c[3] !== '0') {
      if (!ediModes[c[3]]) throw new Error(`Unknown EDI mode "${c[3]}" on line ${lineIndex + 1}.`);
      record.MODE = ediModes[c[3]];
      if (c[3] === '3' || c[3] === '4') record.APP_HAMLOGPARSE_EDI_MODE = c[3];
    }
    records.push(record);
  }
  if (expected === undefined) throw new Error('Missing EDI QSORecords section.');
  if (records.length !== expected)
    throw new Error(`EDI declares ${expected} QSOs but contains ${records.length}.`);
  return { format: 'edi', records, metadata };
}

function ediDate(value: string, contestDates = ''): string {
  if (!value) return '';
  const dates = contestDates
    .split(';')
    .filter((date) => /^\d{8}$/.test(date))
    .sort();
  if (dates.length && /^\d{6}$/.test(value)) {
    const start = dates[0];
    const end = dates[dates.length - 1];
    const candidates: string[] = [];
    for (let century = Number(start.slice(0, 2)); century <= Number(end.slice(0, 2)); century++) {
      const candidate = `${String(century).padStart(2, '0')}${value}`;
      if (candidate >= start && candidate <= end) candidates.push(candidate);
    }
    if (candidates.length > 1)
      throw new Error(`Ambiguous EDI QSO date "${value}" for TDate=${contestDates}.`);
    return candidates[0] ?? `${start.slice(0, 2)}${value}`;
  }
  return `20${value}`;
}

function cabrilloMode(value: string): string {
  const modes: LogRecord = { PH: 'SSB', RY: 'RTTY', DG: 'MFSK', FM: 'FM' };
  return modes[value.toUpperCase()] ?? value.toUpperCase();
}

function isCallsign(value: string): boolean {
  return /^(?:[A-Z0-9]+\/)?[A-Z0-9]*\d[A-Z]+[A-Z0-9]*(?:\/[A-Z0-9]+)*$/i.test(value);
}

function validateRecords(records: LogRecord[]): void {
  for (const [index, record] of records.entries()) {
    const date = record.QSO_DATE?.trim();
    if (date) {
      const iso = /^\d{8}$/.test(date)
        ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
        : '';
      const parsed = new Date(`${iso}T00:00:00Z`);
      if (!iso || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
        throw new Error(`Invalid QSO date "${date}" in record ${index + 1}.`);
      }
    }
    const time = record.TIME_ON?.trim();
    if (time && !/^(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?$/.test(time)) {
      throw new Error(`Invalid QSO time "${time}" in record ${index + 1}.`);
    }
    if (record.FREQ && (!/^\d+(?:\.\d+)?$/.test(record.FREQ.trim()) || Number(record.FREQ) <= 0)) {
      throw new Error(`Invalid frequency in record ${index + 1}.`);
    }
    // Some exporters put a frequency in MHz in ADIF BAND instead of an ADIF band name.
    if (record.BAND && !/[a-z]/i.test(record.BAND)) {
      const band = bandAt(Number(record.BAND));
      if (!band) throw new Error(`Unsupported ADIF band "${record.BAND}" in record ${index + 1}.`);
      record.BAND = band.name;
    }
  }
}

export function parseLog(input: LogInput, format?: SupportedLogFormat): ParsedLog {
  const text = asText(input);
  const selectedFormat = format ?? detectFormat(text);
  if (!supportedLogFormats.includes(selectedFormat))
    throw new Error(`Unsupported log format: ${String(selectedFormat)}.`);
  const parsed =
    selectedFormat === 'adif'
      ? { format: selectedFormat, records: parseAdif(text) }
      : selectedFormat === 'cabrillo'
        ? parseCabrillo(text)
        : parseEdi(text);
  validateRecords(parsed.records);
  return parsed;
}

export function selectFields(input: LogInput, format?: SupportedLogFormat): string[] {
  return [
    ...new Set(parseLog(input, format).records.flatMap((record) => Object.keys(record))),
  ].sort();
}
