import {
  supportedLogFormats,
  type LogInput,
  type LogRecord,
  type ParsedLog,
  type SupportedLogFormat,
} from './types';

const decoder = new TextDecoder('utf-8', { fatal: true });

function asText(input: LogInput): string {
  try {
    return typeof input === 'string' ? input : decoder.decode(input);
  } catch (error) {
    throw new Error('Log data must be valid UTF-8.', { cause: error });
  }
}

function detectFormat(text: string): SupportedLogFormat {
  if (/<\s*(?:EOH|EOR)\s*>/i.test(text)) return 'adif';
  if (/^\s*\[REG1TEST\s*;/im.test(text)) return 'edi';
  if (/^\s*(?:START-OF-LOG:|QSO:)/im.test(text)) return 'cabrillo';
  throw new Error('Unable to detect log format; specify format explicitly.');
}

function parseAdif(text: string): LogRecord[] {
  const bytes = new TextEncoder().encode(text);
  const records: LogRecord[] = [];
  let record: LogRecord = {};
  let position = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  let inHeader = false;
  const firstTag = findByte(bytes, 60, position);
  if (firstTag >= 0) {
    const close = findByte(bytes, 62, firstTag + 1);
    if (
      close >= 0 &&
      /^(?:ADIF|PROGRAMID|CREATED_TIMESTAMP)$/i.test(ascii(bytes, firstTag + 1, close))
    ) {
      inHeader = true;
    }
  }

  while (position < bytes.length) {
    const open = findByte(bytes, 60, position);
    if (open < 0) break;
    const close = findByte(bytes, 62, open + 1);
    if (close < 0) throw new Error("Malformed ADIF tag: missing closing '>'.");
    const tag = ascii(bytes, open + 1, close).trim();
    position = close + 1;
    if (/^EOH$/i.test(tag)) {
      inHeader = false;
      record = {};
      continue;
    }
    if (/^EOR$/i.test(tag)) {
      if (!inHeader && Object.keys(record).length > 0) records.push(record);
      record = {};
      inHeader = false;
      continue;
    }

    const match = /^([A-Z0-9_]+):(\d+)(?::[^>]*)?$/i.exec(tag);
    if (!match) continue;
    const length = Number(match[2]);
    if (!Number.isSafeInteger(length) || position + length > bytes.length) {
      throw new Error(`Invalid byte length for ADIF field ${match[1]}.`);
    }
    const name = match[1].toUpperCase();
    const value = decoder.decode(bytes.subarray(position, position + length));
    position += length;
    if (!inHeader) record[name] = value;
  }

  return records;
}

function parseCabrillo(text: string): LogRecord[] {
  const records: LogRecord[] = [];
  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!/^QSO\s*:/i.test(line)) continue;
    const tokens = line
      .replace(/^QSO\s*:\s*/i, '')
      .trim()
      .split(/\s+/);
    if (tokens.length < 8) {
      throw new Error(`Malformed Cabrillo QSO record on line ${lineIndex + 1}.`);
    }
    const workedCallIndex = tokens.findIndex((token, index) => index > 4 && isCallsign(token));
    if (workedCallIndex < 0 || workedCallIndex + 1 >= tokens.length) {
      throw new Error(
        `Unable to locate contacted station in Cabrillo QSO on line ${lineIndex + 1}.`,
      );
    }
    const sentExchange = tokens.slice(5, workedCallIndex);
    const receivedExchange = tokens.slice(workedCallIndex + 2);
    const record: LogRecord = {
      FREQ: normalizeFrequency(tokens[0]),
      MODE: cabrilloMode(tokens[1]),
      QSO_DATE: normalizeDate(tokens[2]),
      TIME_ON: normalizeTime(tokens[3]),
      STATION_CALLSIGN: tokens[4],
      CALL: tokens[workedCallIndex],
      RST_RCVD: tokens[workedCallIndex + 1],
    };
    if (sentExchange.length > 0) {
      if (sentExchange.length > 1 && /^\d{2,3}$/.test(sentExchange[0])) {
        record.RST_SENT = sentExchange[0];
        record.STX_STRING = sentExchange.slice(1).join(' ');
      } else {
        record.STX_STRING = sentExchange.join(' ');
      }
    }
    if (receivedExchange.length > 0) record.SRX_STRING = receivedExchange.join(' ');
    records.push(record);
  }
  return records;
}

function parseEdi(text: string): LogRecord[] {
  const records: LogRecord[] = [];
  const header = text.split(/^\s*\[QSORecords(?:;|\])/im)[0];
  const headerFields: LogRecord = {};
  for (const [key, field] of [
    ['PCall', 'STATION_CALLSIGN'],
    ['PWWLo', 'MY_GRIDSQUARE'],
  ]) {
    const value = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*([^\\r\\n]*)`, 'im')
      .exec(header)?.[1]
      .trim();
    if (value) headerFields[field] = value;
  }
  const band = /^[ \t]*PBand[ \t]*=[ \t]*([^\r\n]*)/im.exec(header)?.[1].trim();
  if (band) {
    const frequency = /^(\d+(?:\.\d+)?)\s*(MHz|GHz)$/i.exec(band);
    if (!frequency) throw new Error(`Unsupported EDI PBand value: "${band}". Expected MHz or GHz.`);
    const mhz = Number(frequency[1]) * (frequency[2].toLowerCase() === 'ghz' ? 1000 : 1);
    const adifBand = ediBand(mhz);
    if (!adifBand)
      throw new Error(`EDI PBand "${band}" does not correspond to a supported ADIF band.`);
    headerFields.BAND = adifBand;
  }
  let readingQsos = false;
  for (const [lineIndex, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (/^\[QSORecords(?:;|\])/i.test(line)) {
      readingQsos = true;
      continue;
    }
    if (line.startsWith('[') && readingQsos) readingQsos = false;
    if (!readingQsos || !line || line.startsWith('#')) continue;

    const columns = line.split(';').map((value) => value.trim());
    if (columns.length < 10) {
      throw new Error(`Malformed EDI QSO record on line ${lineIndex + 1}.`);
    }
    const record: LogRecord = {
      ...headerFields,
      QSO_DATE: normalizeDate(columns[0]),
      TIME_ON: normalizeTime(columns[1]),
      CALL: columns[2],
      RST_SENT: columns[4],
      STX_STRING: columns[5],
      RST_RCVD: columns[6],
      SRX_STRING: columns[7],
      GRIDSQUARE: columns[9],
    };
    if (columns[3]) record.MODE = ediMode(columns[3]);
    records.push(record);
  }
  return records;
}

function ediBand(mhz: number): string | undefined {
  const bands: [number, number, string][] = [
    [50, 54, '6m'],
    [70, 71, '4m'],
    [144, 148, '2m'],
    [222, 225, '1.25m'],
    [420, 450, '70cm'],
    [902, 928, '33cm'],
    [1240, 1300, '23cm'],
    [2300, 2450, '13cm'],
    [3300, 3500, '9cm'],
    [5650, 5925, '6cm'],
    [10000, 10500, '3cm'],
    [24000, 24250, '1.25cm'],
    [47000, 47200, '6mm'],
    [75500, 81000, '4mm'],
    [119980, 123000, '2.5mm'],
    [134000, 149000, '2mm'],
    [241000, 250000, '1mm'],
  ];
  return bands.find(([min, max]) => mhz >= min && mhz <= max)?.[2];
}

function findByte(bytes: Uint8Array, value: number, from: number): number {
  for (let index = from; index < bytes.length; index++) {
    if (bytes[index] === value) return index;
  }
  return -1;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let result = '';
  for (let index = start; index < end; index++) result += String.fromCharCode(bytes[index]);
  return result;
}

function normalizeDate(value: string): string {
  const compact = value.replace(/-/g, '');
  return compact.length === 6 ? `20${compact}` : compact;
}

function normalizeTime(value: string): string {
  return value.replace(/:/g, '');
}

function cabrilloMode(value: string): string {
  switch (value.toUpperCase()) {
    case 'PH':
      return 'SSB';
    case 'RY':
      return 'RTTY';
    default:
      return value.toUpperCase();
  }
}

function ediMode(value: string): string {
  switch (value.toUpperCase()) {
    case '1':
      return 'SSB';
    case '2':
      return 'CW';
    case '3':
      return 'FM';
    default:
      return value.toUpperCase();
  }
}

function isCallsign(value: string): boolean {
  return /^(?=.*\d)[A-Z0-9]*\d[A-Z]+[A-Z0-9]*(?:\/[A-Z0-9]+)*$/i.test(value);
}

function normalizeFrequency(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 1000 ? String(numeric / 1000) : value;
}

export function parseLog(input: LogInput, format?: SupportedLogFormat): ParsedLog {
  const text = asText(input);
  const selectedFormat = format ?? detectFormat(text);
  if (!supportedLogFormats.includes(selectedFormat)) {
    throw new Error(`Unsupported log format: ${String(selectedFormat)}.`);
  }
  const records =
    selectedFormat === 'adif'
      ? parseAdif(text)
      : selectedFormat === 'cabrillo'
        ? parseCabrillo(text)
        : parseEdi(text);
  return { format: selectedFormat, records };
}

export function selectFields(input: LogInput, format?: SupportedLogFormat): string[] {
  const fields = new Set<string>();
  for (const record of parseLog(input, format).records) {
    for (const field of Object.keys(record)) fields.add(field);
  }
  return [...fields].sort();
}
