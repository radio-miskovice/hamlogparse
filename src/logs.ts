import {
  bandAt,
  bandFrequencyMhz,
  bandNamed,
  bands,
  ediBand,
  ediFrequencyMhz,
  printingBand,
} from './bands';
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

interface SourcePosition {
  line: number;
}

interface ParsedRecords {
  records: LogRecord[];
  fieldPositions: Record<string, SourcePosition>[];
}

function sourcePosition(text: string, offset: number): SourcePosition {
  const end = Math.max(0, Math.min(offset, text.length));
  let line = 1;
  for (let index = 0; index < end; index++) {
    if (text[index] === '\r') {
      if (text[index + 1] === '\n' && index + 1 < end) index++;
      line++;
    } else if (text[index] === '\n') {
      line++;
    }
  }
  return { line };
}

function atPosition(message: string, position: SourcePosition): Error {
  return new Error(`${message} (line ${position.line})`);
}

function bytePosition(text: string, bytes: Uint8Array, offset: number): SourcePosition {
  return sourcePosition(text, decoder.decode(bytes.subarray(0, offset)).length);
}

function invalidUtf8Line(input: Uint8Array): number {
  const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
  let line = 1;
  const countLines = (text: string) => (line += text.split('\n').length - 1);
  for (let index = 0; index < input.length; index++) {
    try {
      countLines(utf8Decoder.decode(input.subarray(index, index + 1), { stream: true }));
    } catch {
      return line;
    }
  }
  try {
    countLines(utf8Decoder.decode());
  } catch {
    return line;
  }
  return line;
}

function asText(input: LogInput): string {
  try {
    return typeof input === 'string' ? input : decoder.decode(input);
  } catch (error) {
    const line = typeof input === 'string' ? 1 : invalidUtf8Line(input);
    throw new Error(`Log data must be valid UTF-8. (line ${line})`, { cause: error });
  }
}

function detectFormat(text: string): SupportedLogFormat {
  if (/^\s*\[REG1TEST\s*;/im.test(text)) return 'edi';
  if (/^\s*(?:START-OF-LOG:|QSO:)/im.test(text)) return 'cabrillo';
  if (/<\s*(?:EOH|EOR)(?::0)?\s*>/i.test(text)) return 'adif';
  throw atPosition(
    'Unable to detect log format; specify format explicitly.',
    sourcePosition(text, 0),
  );
}

function parseAdif(text: string): ParsedRecords {
  const bytes = new TextEncoder().encode(text);
  const records: LogRecord[] = [];
  const fieldPositions: Record<string, SourcePosition>[] = [];
  let record: LogRecord = {};
  let recordFieldPositions: Record<string, SourcePosition> = {};
  let position = 0;
  while (position < bytes.length) {
    const open = bytes.indexOf(60, position);
    if (open < 0) break;
    const close = bytes.indexOf(62, open + 1);
    if (close < 0)
      throw atPosition("Malformed ADIF tag: missing closing '>'.", bytePosition(text, bytes, open));
    const tag = decoder.decode(bytes.subarray(open + 1, close)).trim();
    position = close + 1;
    if (/^EOH(?::0)?$/i.test(tag)) {
      record = {};
      continue;
    }
    if (/^EOR(?::0)?$/i.test(tag)) {
      if (Object.keys(record).length > 0) {
        records.push(record);
        fieldPositions.push(recordFieldPositions);
      }
      record = {};
      recordFieldPositions = {};
      continue;
    }
    const match = /^([A-Z0-9_]+):(\d+)(?::[^>]*)?$/i.exec(tag);
    if (!match) throw atPosition(`Malformed ADIF tag: <${tag}>.`, bytePosition(text, bytes, open));
    const length = Number(match[2]);
    if (!Number.isSafeInteger(length) || position + length > bytes.length) {
      throw atPosition(
        `Invalid byte length for ADIF field ${match[1]}.`,
        bytePosition(text, bytes, open),
      );
    }
    const field = match[1].toUpperCase();
    try {
      record[field] = decoder.decode(bytes.subarray(position, position + length));
    } catch (error) {
      const location = bytePosition(text, bytes, open);
      throw new Error(`ADIF field ${field} must contain valid UTF-8 (line ${location.line}).`, {
        cause: error,
      });
    }
    recordFieldPositions[field] = bytePosition(text, bytes, open);
    position += length;
  }
  if (Object.keys(record).length)
    throw atPosition(
      'Incomplete ADIF record: missing <EOR>.',
      bytePosition(text, bytes, bytes.length),
    );
  return { records, fieldPositions };
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

function parseCabrillo(text: string): ParsedLog & ParsedRecords {
  const h = headers(text, ':');
  const metadata: LogRecord = {
    STATION_CALLSIGN: h.CALLSIGN ?? '',
    MY_GRIDSQUARE: h['GRID-LOCATOR'] ?? '',
    CONTEST_ID: h.CONTEST ?? '',
  };
  const records: LogRecord[] = [];
  const fieldPositions: Record<string, SourcePosition>[] = [];
  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const match = /^\s*QSO\s*: ?(.*)$/i.exec(rawLine);
    if (!match) continue;
    const dataPosition = { line: lineIndex + 1 };
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
        throw atPosition('Malformed Cabrillo QSO record.', dataPosition);
      }
      const ownCall = isCallsign(tokens[4]);
      const workedIndex = tokens.findIndex(
        (token, index) => index >= (ownCall ? 5 : 4) && isCallsign(token),
      );
      if (workedIndex < 0)
        throw atPosition('Unable to locate contacted station in Cabrillo QSO.', dataPosition);
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
        throw atPosition(`Unsupported Cabrillo frequency "${frequency}".`, dataPosition);
      }
      record.FREQ = String(Number(frequency) / 1000);
    }
    fieldPositions.push(
      Object.fromEntries(Object.keys(record).map((field) => [field, dataPosition])),
    );
    for (const [key, value] of Object.entries(metadata))
      if (value && !record[key]) record[key] = value;
    records.push(record);
  }
  return { format: 'cabrillo', records, metadata, fieldPositions };
}

function parseEdi(text: string): ParsedLog & ParsedRecords {
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
    if (!band)
      throw atPosition(
        `Unsupported EDI PBand value: "${h.PBAND}".`,
        findHeaderPosition(text, 'PBAND', '='),
      );
    common.BAND = band.name;
    const frequency = ediFrequencyMhz(h.PBAND);
    if (frequency)
      common.FREQ = band.name === '70cm' ? bandFrequencyMhz(band) : frequency;
  }
  const records: LogRecord[] = [];
  const fieldPositions: Record<string, SourcePosition>[] = [];
  let reading = false;
  let expected: number | undefined;
  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    const linePosition = { line: lineIndex + 1 };
    const section = /^\[QSORecords;(\d+)\]$/i.exec(line);
    if (section) {
      if (expected !== undefined)
        throw atPosition('Multiple EDI QSORecords sections are not supported.', linePosition);
      expected = Number(section[1]);
      reading = true;
      continue;
    }
    if (line.startsWith('[')) reading = false;
    if (!reading || !line || line.startsWith('#')) continue;
    const c = line.split(';').map((value) => value.trim());
    if (c.length < 10) throw atPosition('Malformed EDI QSO record.', linePosition);
    // Older exporters omit the empty received-exchange column before the locator.
    if (/^[A-R]{2}\d{2}(?:[A-X]{2})?$/i.test(c[8]) && !/^[A-R]{2}\d{2}/i.test(c[9])) {
      c.splice(8, 0, '');
    }
    const record: LogRecord = {
      ...common,
      QSO_DATE: ediDate(c[0], h.TDATE, linePosition),
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
      if (!ediModes[c[3]]) throw atPosition(`Unknown EDI mode "${c[3]}".`, linePosition);
      record.MODE = ediModes[c[3]];
      if (c[3] === '3' || c[3] === '4') record.APP_HAMLOGPARSE_EDI_MODE = c[3];
    }
    records.push(record);
    fieldPositions.push(
      Object.fromEntries(Object.keys(record).map((field) => [field, linePosition])),
    );
  }
  if (expected === undefined)
    throw atPosition('Missing EDI QSORecords section.', sourcePosition(text, text.length));
  if (records.length !== expected)
    throw atPosition(
      `EDI declares ${expected} QSOs but contains ${records.length}.`,
      findHeaderPosition(text, 'QSORecords', '['),
    );
  return { format: 'edi', records, metadata, fieldPositions };
}

function findHeaderPosition(text: string, name: string, separator: string): SourcePosition {
  const match = new RegExp(`^[ \\t]*${separator === '[' ? '\\[' : ''}${name}`, 'im').exec(text);
  return sourcePosition(text, match?.index ?? 0);
}

function ediDate(value: string, contestDates = '', position: SourcePosition): string {
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
      throw atPosition(`Ambiguous EDI QSO date "${value}" for TDate=${contestDates}.`, position);
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

function validateRecords(
  records: LogRecord[],
  fieldPositions: Record<string, SourcePosition>[],
): void {
  for (const [index, record] of records.entries()) {
    const position = (field: string) => fieldPositions[index]?.[field] ?? { line: 1 };
    const date = record.QSO_DATE?.trim();
    if (date) {
      const iso = /^\d{8}$/.test(date)
        ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
        : '';
      const parsed = new Date(`${iso}T00:00:00Z`);
      if (!iso || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
        throw atPosition(
          `Invalid QSO date "${date}" in record ${index + 1}.`,
          position('QSO_DATE'),
        );
      }
    }
    const time = record.TIME_ON?.trim();
    if (time && !/^(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?$/.test(time)) {
      throw atPosition(`Invalid QSO time "${time}" in record ${index + 1}.`, position('TIME_ON'));
    }
    if (record.FREQ && (!/^\d+(?:\.\d+)?$/.test(record.FREQ.trim()) || Number(record.FREQ) <= 0)) {
      throw atPosition(`Invalid frequency in record ${index + 1}.`, position('FREQ'));
    }
    // Some exporters put a frequency in MHz in ADIF BAND instead of an ADIF band name.
    let band = bandNamed(record.BAND?.trim() ?? '');
    if (record.BAND && !/[a-z]/i.test(record.BAND)) {
      band = bandAt(Number(record.BAND));
      if (!band)
        throw atPosition(
          `Unsupported ADIF band "${record.BAND}" in record ${index + 1}.`,
          position('BAND'),
        );
      record.BAND = band.name;
    }
    if (!record.FREQ?.trim() && band) record.FREQ = bandFrequencyMhz(band, record.MODE);
  }
}

export function parseLog(input: LogInput, format?: SupportedLogFormat): ParsedLog {
  const text = asText(input);
  const selectedFormat = format ?? detectFormat(text);
  if (!supportedLogFormats.includes(selectedFormat))
    throw new Error(`Unsupported log format: ${String(selectedFormat)}.`);
  const parsed =
    selectedFormat === 'adif'
      ? { format: selectedFormat, ...parseAdif(text) }
      : selectedFormat === 'cabrillo'
        ? parseCabrillo(text)
        : parseEdi(text);
  validateRecords(parsed.records, parsed.fieldPositions);
  for (const record of parsed.records) {
    record.FREQ_BAND = printingBand(record.BAND, record.FREQ);
    if ('BAND_RX' in record || 'FREQ_RX' in record)
      record.FREQ_BAND_RX = printingBand(record.BAND_RX, record.FREQ_RX);
    else delete record.FREQ_BAND_RX;
  }
  return {
    format: parsed.format,
    records: parsed.records,
    ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
  };
}

export function selectFields(input: LogInput, format?: SupportedLogFormat): string[] {
  return [
    ...new Set(parseLog(input, format).records.flatMap((record) => Object.keys(record))),
  ].sort();
}
