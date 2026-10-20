import { describe, expect, it } from 'vitest';
import { parseLog, selectFields, serializeLog, supportedLogFormats } from '../src/index';
import { bands } from '../src/bands';

function adifRecord(fields: Record<string, string>): string {
  return (
    Object.entries(fields)
      .map(([key, value]) => `<${key}:${new TextEncoder().encode(value).length}>${value}`)
      .join('') + '<EOR>'
  );
}

describe('printing band fields', () => {
  it.each(bands)('labels $name using the existing band table', (band) => {
    const record = parseLog(adifRecord({ BAND: band.name }), 'adif').records[0];
    const expected =
      band.name === '2190m'
        ? '136 kHz'
        : band.name === '630m'
          ? '475 kHz'
          : band.name === '70cm'
            ? '432 MHz'
            : band.edi;
    expect(record.FREQ_BAND).toBe(expected);
    expect(record).not.toHaveProperty('FREQ_BAND_RX');
  });

  it.each([
    ['0.1365', '136 kHz'],
    ['0.474', '475 kHz'],
    ['3.7', '3.5 MHz'],
    ['145.5', '144 MHz'],
    ['432.1', '432 MHz'],
    ['1296.2', '1.3 GHz'],
  ])('derives a nominal band label from frequency %s', (frequency, expected) => {
    expect(parseLog(adifRecord({ FREQ: frequency }), 'adif').records[0].FREQ_BAND).toBe(expected);
  });

  it('prefers a recognized band over a conflicting frequency without modifying either', () => {
    const record = parseLog(adifRecord({ BAND: ' 70CM ', FREQ: '144.3' }), 'adif').records[0];
    expect(record).toMatchObject({
      BAND: ' 70CM ',
      FREQ: '144.3',
      FREQ_BAND: '432 MHz',
    });
  });

  it.each([
    [{ BAND_RX: '23cm' }, '1.3 GHz'],
    [{ FREQ_RX: '432.1' }, '432 MHz'],
    [{ BAND_RX: 'unknown', FREQ_RX: '145.5' }, '144 MHz'],
    [{ BAND_RX: '144' }, '144 MHz'],
    [{ BAND_RX: '' }, ''],
    [{ FREQ_RX: '' }, ''],
    [{ FREQ_RX: 'invalid' }, ''],
  ])('generates the receive label only from receive fields %j', (fields, expected) => {
    const record = parseLog(adifRecord({ BAND: '20m', ...fields }), 'adif').records[0];
    expect(record.FREQ_BAND).toBe('14 MHz');
    expect(record.FREQ_BAND_RX).toBe(expected);
    expect(record).toMatchObject(fields);
  });

  it('uses an empty transmit label when the band cannot be resolved', () => {
    const cases: Record<string, string>[] = [
      { CALL: 'DL1AA' },
      { BAND: 'unknown' },
      { FREQ: '999' },
    ];
    for (const fields of cases) {
      const record = parseLog(adifRecord(fields), 'adif').records[0];
      expect(record.FREQ_BAND).toBe('');
      expect(record).not.toHaveProperty('FREQ_BAND_RX');
    }
  });

  it('recomputes supplied labels and removes receive labels without receive fields', () => {
    const record = parseLog(
      adifRecord({ BAND: '20m', FREQ_BAND: 'stale', FREQ_BAND_RX: 'stale' }),
      'adif',
    ).records[0];
    expect(record.FREQ_BAND).toBe('14 MHz');
    expect(record).not.toHaveProperty('FREQ_BAND_RX');
  });

  it('adds printing labels for Cabrillo and EDI input', () => {
    const cabrillo = parseLog('QSO: 432 CW 2026-10-10 1234 DL0ME 599 001 DL1AA 599 002');
    const edi = parseLog(
      '[REG1TEST;1]\nPBand=1.3 GHz\n[QSORecords;1]\n261010;1234;DL1AA;1;59;001;59;002;;JO70AA;',
    );
    expect(cabrillo.records[0].FREQ_BAND).toBe('432 MHz');
    expect(edi.records[0].FREQ_BAND).toBe('1.3 GHz');
  });

  it('uses the 70cm printing label while preserving the EDI standard frequency', () => {
    const log = parseLog(
      '[REG1TEST;1]\nPBand=435 MHz\n[QSORecords;1]\n261010;1234;DL1AA;1;59;001;59;002;;JO70AA;',
    );
    expect(log.records[0]).toMatchObject({
      BAND: '70cm',
      FREQ: '435',
      FREQ_BAND: '432 MHz',
    });
    expect(serializeLog(log, 'edi').files[0].content).toContain('PBand=435 MHz\r\n');
  });

  it('includes derived printing fields in field selection', () => {
    expect(selectFields(adifRecord({ BAND: '20m', BAND_RX: '2m' }), 'adif')).toEqual([
      'BAND',
      'BAND_RX',
      'FREQ',
      'FREQ_BAND',
      'FREQ_BAND_RX',
    ]);
  });

  it.each(supportedLogFormats)(
    'omits printing fields from %s exports without warnings about them',
    (format) => {
      const log = parseLog(adifRecord({ CALL: 'DL1AA', BAND: '20m', BAND_RX: '2m' }), 'adif');
      const output = serializeLog(log, format);
      for (const file of output.files) expect(file.content).not.toContain('FREQ_BAND');
      expect(output.warnings.join(' ')).not.toContain('FREQ_BAND');
      expect(log.records[0].FREQ_BAND).toBe('14 MHz');
      expect(log.records[0].FREQ_BAND_RX).toBe('144 MHz');
    },
  );
});
