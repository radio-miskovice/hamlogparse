# Changes

## 1.1.3 - 2026-10-20

- Use 432 MHz for 70cm printing labels and derived frequencies, while retaining
  the EDI-standard 435 MHz band value.
- Added printing-only `FREQ_BAND` labels to every parsed QSO and `FREQ_BAND_RX`
  when receive band or frequency fields are present. Labels use kHz, MHz, or GHz
  and are omitted from serialized log files.
- Added `sortLog` to sort parsed logs by a specified field, with ascending or
  descending order, frequency-aware band sorting, numeric comparisons, and stable
  ordering without modifying the input.
- Added [API.md](./API.md), a complete reference for the package's public
  functions, types, parsing and serialization behavior, and template API.
- Added a link to the API reference in the README.

## 1.1.2 - 2026-10-16

- Added source line numbers to log parsing and record-validation errors,
  including invalid UTF-8 input.

## 1.1.1 - 2026-10-15

- Populate `FREQ` when parsing a record with a recognized `BAND` but no
  explicit frequency, using a nominal frequency based on the band and mode.
- Normalize numeric EDI `PBand` values to MHz and include them as `FREQ` on
  parsed QSOs.
- Preserve an explicitly supplied `FREQ` rather than replacing it with a
  nominal band frequency.

## 1.1.0 - 2026-10-15

- Added `serializeLog` to export ADIF, Cabrillo, and EDI logs, with warnings
  for fields or values that cannot be represented. EDI output is split by band.
- Improved Cabrillo and EDI parsing, including station/contest metadata,
  additional QSO layouts, EDI mode handling, and two-digit year resolution.
- Added band and frequency recognition for EDI headers, and exposed parser
  metadata on `ParsedLog` and in QSO records where available.
- Expanded the public API with serialization result types and updated package
  documentation and examples for `hamlogparse4print`.
