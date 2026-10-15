import { bandAt, bandNamed, type Band } from './bands';
import { cabrilloWidths } from './logs';
import type {
  LogRecord,
  ParsedLog,
  SerializedLog,
  SerializedLogFile,
  SupportedLogFormat,
} from './types';

const ediHeaderKeys = [
  'TName',
  'TDate',
  'PCall',
  'PWWLo',
  'PExch',
  'PAdr1',
  'PAdr2',
  'PSect',
  'PBand',
  'PClub',
  'RName',
  'RCall',
  'RAdr1',
  'RAdr2',
  'RPoCo',
  'RCity',
  'RCoun',
  'RPhon',
  'RHBBS',
  'MOpe1',
  'MOpe2',
  'STXEq',
  'SPowe',
  'SRXEq',
  'SAnte',
  'SAntH',
  'CQSOs',
  'CQSOP',
  'CWWLs',
  'CWWLB',
  'CExcs',
  'CExcB',
  'CDXCs',
  'CDXCB',
  'CToSc',
  'CODXC',
];
const commonFields = new Set([
  'CALL',
  'QSO_DATE',
  'TIME_ON',
  'FREQ',
  'BAND',
  'MODE',
  'RST_SENT',
  'RST_RCVD',
  'STX',
  'SRX',
  'STX_STRING',
  'SRX_STRING',
  'STATION_CALLSIGN',
  'MY_GRIDSQUARE',
  'GRIDSQUARE',
  'CONTEST_ID',
  'APP_HAMLOGPARSE_EDI_MODE',
]);

function bandFor(record: LogRecord): Band | undefined {
  return bandNamed(record.BAND ?? '') ?? bandAt(Number(record.FREQ));
}

function consistent(records: LogRecord[], field: string, metadata?: LogRecord): string {
  const values = new Set(records.map((record) => record[field] || metadata?.[field] || ''));
  return values.size === 1 ? [...values][0] : '';
}

function tag(name: string, value: string): string {
  return value ? `<${name}:${new TextEncoder().encode(value).length}>${value}` : '';
}

function adif(log: Pick<ParsedLog, 'records' | 'metadata'>): SerializedLogFile {
  const records = log.records.map((record) => {
    const merged = { ...log.metadata, ...record };
    if (!merged.BAND && bandFor(record)) merged.BAND = bandFor(record)!.name;
    return (
      Object.entries(merged)
        .map(([key, value]) => tag(key, value))
        .join('') + '<EOR>'
    );
  });
  return {
    content: ['Hamconvert', '<ADIF_VER:5>3.1.6<PROGRAMID:10>Hamconvert<EOH>', ...records, ''].join(
      '\r\n',
    ),
    extension: 'adi',
    qsoCount: log.records.length,
  };
}

function safe(value: string, field: string, warnings: Set<string>, edi = false): string {
  const cleaned = value.replace(edi ? /[^\x20-\x7e]|;/g : /[^\x20-\x7e]/g, ' ');
  if (cleaned !== value)
    warnings.add(`Unsupported characters in ${field} were replaced with spaces.`);
  return cleaned.trim();
}

function limited(value: string, field: string, max: number, warnings: Set<string>): string {
  if (value.length <= max) return value;
  warnings.add(`${field} exceeds the target's ${max}-character limit and was left blank.`);
  return '';
}

function cabrillo(
  log: Pick<ParsedLog, 'records' | 'metadata'>,
  warnings: Set<string>,
): SerializedLogFile {
  const rows = log.records.map((r) => {
    const band = bandFor(r);
    let freq = '';
    if (band && band.min >= 50) freq = band.cabrillo;
    else if (r.FREQ) freq = String(Math.round(Number(r.FREQ) * 1000));
    else if (band) freq = band.cabrillo;
    else if (r.BAND) warnings.add(`Unrecognized band "${r.BAND}" was left blank.`);
    const modes: LogRecord = {
      CW: 'CW',
      SSB: 'PH',
      USB: 'PH',
      LSB: 'PH',
      AM: 'PH',
      FM: 'FM',
      RTTY: 'RY',
      FT8: 'DG',
      FT4: 'DG',
      MFSK: 'DG',
      PSK: 'DG',
      PSK31: 'DG',
      JT65: 'DG',
      JT9: 'DG',
    };
    const mode = modes[r.MODE?.toUpperCase()];
    if (r.MODE && !mode)
      warnings.add(`Mode "${r.MODE}" cannot be represented in Cabrillo and was left blank.`);
    const date = r.QSO_DATE
      ? `${r.QSO_DATE.slice(0, 4)}-${r.QSO_DATE.slice(4, 6)}-${r.QSO_DATE.slice(6, 8)}`
      : '';
    const values = [
      freq,
      mode ?? '',
      date,
      r.TIME_ON?.slice(0, 4) ?? '',
      r.STATION_CALLSIGN || log.metadata?.STATION_CALLSIGN || '',
      r.RST_SENT ?? '',
      r.STX_STRING || r.STX || r.MY_GRIDSQUARE || '',
      r.CALL ?? '',
      r.RST_RCVD ?? '',
      r.SRX_STRING || r.SRX || r.GRIDSQUARE || '',
    ];
    return (
      'QSO: ' +
      values
        .map((value, index) =>
          limited(
            safe(value, `Cabrillo column ${index + 1}`, warnings),
            `Cabrillo column ${index + 1}`,
            cabrilloWidths[index],
            warnings,
          ).padEnd(cabrilloWidths[index]),
        )
        .join(' ')
    );
  });
  return {
    content: [
      'START-OF-LOG: 3.0',
      'CREATED-BY: Hamconvert',
      `CALLSIGN: ${safe(consistent(log.records, 'STATION_CALLSIGN', log.metadata), 'CALLSIGN', warnings)}`,
      `CONTEST: ${safe(consistent(log.records, 'CONTEST_ID', log.metadata), 'CONTEST', warnings)}`,
      ...rows,
      'END-OF-LOG:',
      '',
    ].join('\r\n'),
    extension: 'cbr',
    qsoCount: rows.length,
  };
}

function edi(
  log: Pick<ParsedLog, 'records' | 'metadata'>,
  warnings: Set<string>,
): SerializedLogFile[] {
  const groups = new Map<string, LogRecord[]>();
  for (const record of log.records) {
    const band = bandFor(record)?.name ?? '';
    if (!band)
      warnings.add('QSOs with unknown bands are in a separate EDI file with PBand left blank.');
    const group = groups.get(band) ?? [];
    group.push(record);
    groups.set(band, group);
  }
  return [...groups].map(([name, records]) => {
    const band = bandNamed(name);
    if (band && band.min < 50)
      warnings.add(
        'EDI is intended for VHF and higher bands; HF files may not be accepted by contest software.',
      );
    const dates = records
      .map((r) => r.QSO_DATE)
      .filter(Boolean)
      .sort();
    const values: LogRecord = {
      TName: consistent(records, 'CONTEST_ID', log.metadata),
      TDate: dates.length ? `${dates[0]};${dates[dates.length - 1]}` : '',
      PCall: consistent(records, 'STATION_CALLSIGN', log.metadata),
      PWWLo: consistent(records, 'MY_GRIDSQUARE', log.metadata),
      PBand: band?.edi ?? '',
    };
    for (const field of ['STATION_CALLSIGN', 'MY_GRIDSQUARE', 'CONTEST_ID']) {
      if (
        !consistent(records, field, log.metadata) &&
        records.some((r) => r[field] || log.metadata?.[field])
      ) {
        warnings.add(
          `Mixed ${field} values cannot share an EDI header; the header field was left blank.`,
        );
      }
    }
    const rows = records.map((r) => {
      const modes: LogRecord = {
        SSB: '1',
        USB: '1',
        LSB: '1',
        CW: '2',
        AM: '5',
        FM: '6',
        RTTY: '7',
        MFSK: '7',
        FT8: '7',
        FT4: '7',
        PSK: '7',
        PSK31: '7',
        JT65: '7',
        JT9: '7',
        SSTV: '8',
        ATV: '9',
      };
      const mode = r.APP_HAMLOGPARSE_EDI_MODE || modes[r.MODE?.toUpperCase()];
      if (r.MODE && !mode)
        warnings.add(`Mode "${r.MODE}" cannot be represented in EDI and was left blank.`);
      const sent = r.STX || r.STX_STRING || '';
      const received = r.SRX || r.SRX_STRING || '';
      const serial = (value: string) => (/^\d{1,4}$/.test(value) ? value.padStart(3, '0') : '');
      let grid = r.GRIDSQUARE ?? '';
      if (!grid && /^[A-R]{2}\d{2}(?:[A-X]{2})?$/i.test(received)) grid = received;
      const receivedParts = received.split(/\s+/);
      const receivedSerial = serial(receivedParts[0]);
      const receivedExchange = receivedSerial
        ? receivedParts.slice(1).join(' ')
        : received === grid
          ? ''
          : received;
      if (sent && !serial(sent) && sent !== r.MY_GRIDSQUARE)
        warnings.add(
          'Non-numeric sent exchanges cannot be represented per QSO in EDI and were left blank.',
        );
      const columns = [
        r.QSO_DATE?.slice(2) ?? '',
        r.TIME_ON?.slice(0, 4) ?? '',
        r.CALL ?? '',
        mode ?? '',
        r.RST_SENT ?? '',
        serial(sent),
        r.RST_RCVD ?? '',
        receivedSerial,
        receivedExchange,
        grid,
        '',
        '',
        '',
        '',
        '',
      ];
      const widths = [6, 4, 14, 1, 3, 4, 3, 4, 6, 6, 6, 1, 1, 1, 1];
      return columns
        .map((value, index) =>
          limited(
            safe(value, `EDI column ${index + 1}`, warnings, true),
            `EDI column ${index + 1}`,
            widths[index],
            warnings,
          ),
        )
        .join(';');
    });
    return {
      content: [
        '[REG1TEST;1]',
        ...ediHeaderKeys.map(
          (key) =>
            `${key}=${key === 'TDate' ? values[key] : safe(values[key] ?? '', key, warnings, true)}`,
        ),
        '[Remarks]',
        '[QSORecords;' + rows.length + ']',
        ...rows,
        '',
      ].join('\r\n'),
      extension: 'edi',
      band: name || 'unknown-band',
      qsoCount: rows.length,
    };
  });
}

export function serializeLog(
  log: Pick<ParsedLog, 'records' | 'metadata'>,
  format: SupportedLogFormat,
): SerializedLog {
  if (!['adif', 'cabrillo', 'edi'].includes(format))
    throw new Error(`Unsupported output format: ${String(format)}.`);
  if (!log.records.length) throw new Error('The log contains no QSOs.');
  const warnings = new Set<string>();
  if (format !== 'adif') {
    const omitted = [
      ...new Set(
        log.records.flatMap((r) => Object.keys(r).filter((key) => !commonFields.has(key))),
      ),
    ].sort();
    if (omitted.length)
      warnings.add(`Fields outside the common QSO data are not exported: ${omitted.join(', ')}.`);
    warnings.add(
      'Contest-specific headers, scoring, and categories are not reconstructed. Review before submitting.',
    );
    warnings.add('Times are exported to minute precision. Missing values remain blank.');
    if (format === 'edi')
      warnings.add(
        'EDI preserves bands, not exact frequencies; digital modes use the generic MGM code.',
      );
    else
      warnings.add(
        'Cabrillo uses a generic RST/exchange layout, VHF+ band designators, and generic phone/digital modes. Contest-specific layouts may differ.',
      );
  }
  const files =
    format === 'adif'
      ? [adif(log)]
      : format === 'cabrillo'
        ? [cabrillo(log, warnings)]
        : edi(log, warnings);
  return { files, warnings: [...warnings] };
}
