import { describe, expect, it } from 'vitest';
import { parseLog, serializeLog, supportedLogFormats, type LogRecord } from '../src/index';

const qso: LogRecord = {
  CALL: 'DL1AA',
  STATION_CALLSIGN: 'DL0ME',
  QSO_DATE: '20261010',
  TIME_ON: '123456',
  BAND: '2m',
  FREQ: '144.3',
  MODE: 'CW',
  RST_SENT: '599',
  RST_RCVD: '579',
  STX_STRING: '001',
  SRX_STRING: '023',
  GRIDSQUARE: 'JO70AA',
  MY_GRIDSQUARE: 'JO70BB',
};

describe('log serialization', () => {
  it.each(supportedLogFormats)('writes a parseable %s log', (format) => {
    const result = serializeLog({ records: [qso] }, format);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].qsoCount).toBe(1);
    const parsed = parseLog(result.files[0].content);
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({
      CALL: 'DL1AA',
      STATION_CALLSIGN: 'DL0ME',
      QSO_DATE: '20261010',
      MODE: 'CW',
      RST_SENT: '599',
      RST_RCVD: '579',
      STX_STRING: '001',
      SRX_STRING: '023',
    });
  });

  it('splits EDI by band without losing contacts', () => {
    const result = serializeLog({ records: [qso, { ...qso, BAND: '70cm', FREQ: '432.1' }] }, 'edi');
    expect(result.files.map((file) => file.band)).toEqual(['2m', '70cm']);
    expect(result.files.map((file) => file.qsoCount)).toEqual([1, 1]);
    expect(result.files[1].content).toContain('PBand=435 MHz\r\n');
    expect(result.files.every((file) => file.content.includes('[QSORecords;1]'))).toBe(true);
  });

  it('leaves missing EDI headers and QSO values blank, including antenna height', () => {
    const result = serializeLog({ records: [{ CALL: 'DL1AA' }] }, 'edi');
    expect(result.files[0].content).toContain('SAntH=\r\n');
    expect(result.files[0].content).toContain('PCall=\r\n');
    expect(result.files[0].content).toContain('PBand=\r\n');
    expect(result.files[0].content).toContain(';;DL1AA;;;;;;;;;;;;');
    expect(parseLog(result.files[0].content).records[0]).toMatchObject({
      CALL: 'DL1AA',
      RST_SENT: '',
    });
    expect(result.warnings.join(' ')).toContain('unknown bands');
  });

  it('retains absent Cabrillo fields as blank fixed-width columns', () => {
    const result = serializeLog({ records: [{ CALL: 'DL1AA' }] }, 'cabrillo');
    expect(parseLog(result.files[0].content).records[0]).toMatchObject({
      CALL: 'DL1AA',
      STATION_CALLSIGN: '',
      RST_SENT: '',
      SRX_STRING: '',
      QSO_DATE: '',
      TIME_ON: '',
    });
    expect(result.files[0].content).not.toContain('599');
  });

  it('preserves ADIF length-delimited UTF-8 data and arbitrary fields', () => {
    const result = serializeLog(
      { records: [{ CALL: 'DL1AA', NAME: 'René', COMMENT: '<EOR>' }] },
      'adif',
    );
    expect(result.files[0].content).toContain('<NAME:5>René');
    expect(parseLog(result.files[0].content).records[0]).toMatchObject({
      NAME: 'René',
      COMMENT: '<EOR>',
    });
  });

  it('uses the proper EDI received exchange and locator columns', () => {
    const text = serializeLog({ records: [{ ...qso, SRX_STRING: '023 ABC' }] }, 'edi').files[0]
      .content;
    expect(text).toContain(';579;023;ABC;JO70AA;');
    expect(parseLog(text).records[0].SRX_STRING).toBe('023 ABC');
  });

  it('preserves EDI cross-mode codes on a round trip', () => {
    const parsed = parseLog(
      '[REG1TEST;1]\nPBand=144\n[QSORecords;1]\n261010;1234;DL1AA;3;59;001;599;023;;JO70AA;;;;;',
    );
    expect(serializeLog(parsed, 'edi').files[0].content).toContain(';DL1AA;3;');
  });

  it('warns explicitly about unsupported and oversized values', () => {
    const result = serializeLog(
      { records: [{ ...qso, MODE: 'UNKNOWN', STX_STRING: 'TOO-LONG-EXCHANGE', COMMENT: 'test' }] },
      'cabrillo',
    );
    expect(result.warnings.join(' ')).toContain('COMMENT');
    expect(result.warnings.join(' ')).toContain('Mode "UNKNOWN"');
    expect(result.warnings.join(' ')).toContain('6-character limit');
    expect(parseLog(result.files[0].content).records[0].STX_STRING).toBe('');
  });

  it('does not allow metadata to inject new target-format lines', () => {
    const result = serializeLog(
      { records: [qso], metadata: { CONTEST_ID: 'Test\nQSO: injected' } },
      'edi',
    );
    expect(result.files[0].content).not.toContain('\nQSO: injected');
    expect(result.warnings.join(' ')).toContain('Unsupported characters');
  });

  it('rejects an empty log', () => {
    expect(() => serializeLog({ records: [] }, 'adif')).toThrow('no QSOs');
  });

  it.each(['19860501', '19991231', '20000101', '20261010'])(
    'preserves the century for EDI date %s through TDate',
    (date) => {
      const file = serializeLog({ records: [{ ...qso, QSO_DATE: date }] }, 'edi').files[0];
      expect(parseLog(file.content).records[0].QSO_DATE).toBe(date);
    },
  );

  it('resolves two-digit years across a century boundary using TDate', () => {
    const file = serializeLog(
      {
        records: [
          { ...qso, QSO_DATE: '19991231' },
          { ...qso, QSO_DATE: '20000101' },
        ],
      },
      'edi',
    ).files[0];
    expect(parseLog(file.content).records.map((r) => r.QSO_DATE)).toEqual(['19991231', '20000101']);
  });
});
