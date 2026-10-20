import { describe, expect, it } from 'vitest';
import { parseLog, serializeLog, sortLog, type ParsedLog, type SortDirection } from '../src/index';

function logWith(field: string, values: (string | undefined)[]): ParsedLog {
  return {
    format: 'adif',
    records: values.map((value, index) => ({
      ID: String(index),
      ...(value === undefined ? {} : { [field]: value }),
    })),
  };
}

describe('sorting logs', () => {
  it('sorts callsigns alphabetically, ignoring case and surrounding whitespace', () => {
    const log = logWith('CALL', ['OK1AAA', ' dl1aa ', 'F1BAR']);
    expect(sortLog(log, ' call ').records.map((record) => record.CALL)).toEqual([
      ' dl1aa ',
      'F1BAR',
      'OK1AAA',
    ]);
  });

  it('sorts bands by increasing frequency instead of their text or wavelength', () => {
    const log = logWith('BAND', ['2m', '20m', '70cm', '80m', '40m', '23cm', '1mm']);
    expect(sortLog(log, 'BAND').records.map((record) => record.BAND)).toEqual([
      '80m',
      '40m',
      '20m',
      '2m',
      '70cm',
      '23cm',
      '1mm',
    ]);
  });

  it('recognizes numeric MHz and GHz band values using existing band rules', () => {
    const log = logWith('BAND', ['1,3 GHz', '144', '80M']);
    expect(sortLog(log, 'BAND').records.map((record) => record.ID)).toEqual(['2', '1', '0']);
  });

  it('sorts numeric values numerically, including decimals and leading zeroes', () => {
    const log = logWith('FREQ', ['144', '14', '7.1', '3.5', '014.0']);
    expect(sortLog(log, 'FREQ').records.map((record) => record.ID)).toEqual([
      '3',
      '2',
      '1',
      '4',
      '0',
    ]);
  });

  it('supports arbitrary field names and orders numbers before text in ascending order', () => {
    const log = logWith('CUSTOM', ['Zoo', '10', 'Alpha', '2']);
    expect(sortLog(log, 'CUSTOM').records.map((record) => record.CUSTOM)).toEqual([
      '2',
      '10',
      'Alpha',
      'Zoo',
    ]);
  });

  it.each<SortDirection>(['asc', 'desc'])(
    'keeps missing, empty, and whitespace-only values last in %s order',
    (direction) => {
      const log = logWith('CALL', [undefined, 'B', '', 'A', '  ']);
      expect(sortLog(log, 'CALL', direction).records.map((record) => record.ID)).toEqual(
        direction === 'asc' ? ['3', '1', '0', '2', '4'] : ['1', '3', '0', '2', '4'],
      );
    },
  );

  it('supports descending band order and stable ties', () => {
    const log = logWith('BAND', ['80m', '2m', '80M', '20m']);
    expect(sortLog(log, 'BAND', 'desc').records.map((record) => record.ID)).toEqual([
      '1',
      '3',
      '0',
      '2',
    ]);
  });

  it('handles unknown band names deterministically without breaking numeric order', () => {
    const log = logWith('BAND', ['unknown', '2m', 'custom', '80m']);
    expect(sortLog(log, 'BAND').records.map((record) => record.ID)).toEqual(['3', '1', '2', '0']);
  });

  it('does not mutate the input and preserves record and metadata references', () => {
    const log = logWith('CALL', ['B', 'A']);
    log.metadata = { STATION_CALLSIGN: 'OK1AAA' };
    const result = sortLog(log, 'CALL');
    expect(result).not.toBe(log);
    expect(result.records).not.toBe(log.records);
    expect(log.records.map((record) => record.CALL)).toEqual(['B', 'A']);
    expect(result.records[0]).toBe(log.records[1]);
    expect(result.metadata).toBe(log.metadata);
    expect(result.format).toBe('adif');
  });

  it('leaves records in their original order when the field is absent throughout', () => {
    const log = logWith('CALL', ['B', 'A']);
    expect(sortLog(log, 'NAME').records).toEqual(log.records);
  });

  it('accepts empty logs', () => {
    expect(sortLog({ format: 'edi', records: [] }, 'CALL')).toEqual({
      format: 'edi',
      records: [],
    });
  });

  it('rejects empty field names and invalid directions', () => {
    const log = logWith('CALL', ['A']);
    expect(() => sortLog(log, '  ')).toThrow('Sort field must not be empty.');
    // @ts-expect-error Exercise validation for JavaScript callers.
    expect(() => sortLog(log, 'CALL', 'invalid')).toThrow('Unsupported sort direction');
  });

  it('can sort parsed input and serialize the sorted result', () => {
    const parsed = parseLog('<CALL:5>OK1AA<EOR><CALL:5>DL1AA<EOR>');
    const sorted = sortLog(parsed, 'CALL');
    const output = serializeLog(sorted, 'adif').files[0].content;
    expect(parseLog(output).records.map((record) => record.CALL)).toEqual(['DL1AA', 'OK1AA']);
  });
});
