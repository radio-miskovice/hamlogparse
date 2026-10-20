# hamlogparse4print

Parser for amateur radio (ham) log files and QSL label layout templates, written in TypeScript.

Supported log formats: **ADIF**, **Cabrillo** and **EDI** (IARU Region 1). Every QSO is
returned as a record of ADIF-style field names (`CALL`, `QSO_DATE`, `TIME_ON`, `MODE`, …).

## Install

```sh
npm install hamlogparse4print
```

See [API.md](./API.md) for the complete public API reference.

## Usage

### Logs

```ts
import { parseLog, selectFields, sortLog } from 'hamlogparse4print';

// input is a string or UTF-8 bytes (Uint8Array); the format is auto-detected
const { format, records } = parseLog(text);

// or force a format: 'adif' | 'cabrillo' | 'edi'
parseLog(text, 'adif');

// sorted list of all field names used in the log
selectFields(text); // ['CALL', 'MODE', 'QSO_DATE', ...]

// sorted copies; the original log is unchanged
const byCall = sortLog(parseLog(text), 'CALL');
const byBand = sortLog(byCall, 'BAND'); // increasing radio frequency
const descending = sortLog(byBand, 'QSO_DATE', 'desc');
```

`parseLog` also exposes optional `metadata` with station callsign, station locator, and contest
name from Cabrillo/EDI headers. Available metadata is copied into QSO records. Absent values
are not invented. EDI numeric MHz bands and decimal-comma GHz values are accepted, as are
older EDI rows omitting the received-exchange column. Cabrillo supports generic RST/exchange
and locator layouts, including a blank own callsign; a trailing transmitter ID is not an exchange.
EDI code 7 is represented by generic `MFSK` (MGM); codes 3/4 retain the TX mode and an
`APP_HAMLOGPARSE_EDI_MODE` field for cross-mode round trips.

Malformed tags, incomplete ADIF records, invalid dates/times/frequencies, unsupported EDI bands,
and EDI record-count mismatches throw errors instead of returning a partially converted log.
ADIF means the length-delimited ADI format, not XML ADX. Lengths are interpreted as UTF-8 bytes.
When `FREQ` is absent but `BAND` is known, the parser fills in a nominal MHz frequency based on the
band and mode (for example, 80 m SSB uses 3.7 MHz, 80 m CW/digital uses 3.5 MHz, and 2 m FM uses
145 MHz). For EDI, a numeric `PBand` header value is retained as `FREQ`, normalized to MHz, except
that the standard 70cm `PBand=435 MHz` is represented as `432`.

Every parsed QSO also has a printing-only `FREQ_BAND` label, such as `136 kHz`,
`14 MHz`, `432 MHz`, or `1.3 GHz`. `FREQ_BAND_RX` is generated only when
`BAND_RX` or `FREQ_RX` is present. Labels describe the nominal band, not the
precise operating frequency; unresolved bands produce empty labels. These fields
are available to label templates and the host application but are omitted from
all serialized log files. For 70cm, the printing label and derived `FREQ` use
432 MHz; EDI files retain the standard `PBand=435 MHz` value.

### Converting logs

```ts
import { parseLog, serializeLog } from 'hamlogparse4print';

const log = parseLog(text);
const { files, warnings } = serializeLog(log, 'edi');
// files: { content, extension, band?, qsoCount }[]
// Multi-band EDI output is split into one file per band.
```

Serialization is synchronous and entirely in memory, with no filesystem or network access.
Application-specific limits (such as maximum QSO count) belong in the consuming app.
ADIF output preserves record fields except the printing-only labels. Cabrillo/EDI output uses common QSO data, not contest-specific
scoring, categories, or equipment details. Missing values stay blank, including EDI `SAntH=`.
Unknown bands are grouped in a separate EDI file with an empty band header. EDI includes all
header keys but leaves unknown values and uncomputed scores blank; supplied ADIF serials
are zero-padded, never generated. EDI two-digit years use the full dates in `TDate` to resolve
the century (including historical logs and contests spanning a century boundary); without
`TDate`, they default to 2000-2099. An ambiguous date across multiple centuries is rejected.

`warnings` reports dropped fields, unsupported modes, character replacement, oversized fields
left blank, and other format limitations. Cabrillo uses the generic fixed-width RST/exchange
layout (six characters per exchange); EDI uses the standard 15-column QSO layout. EDI cannot
retain exact frequencies; Cabrillo VHF+ frequencies become band designators. Times in these
formats have minute precision and digital modes are generic. Converted logs with missing
required information are not necessarily valid contest submissions.

### Templates

Label templates (YAML string or object) describe the paper, the label grid and the fields
placed on each label. All dimensions are in millimetres.

```ts
import {
  createTemplateLayout,
  normalizeTemplate,
  parseTemplate,
  TemplateError,
} from 'hamlogparse4print';

const template = parseTemplate(yaml); // validates, throws TemplateError on problems
const normalized = normalizeTemplate(template); // resolved paper size, margins, gaps, safety

// build a centred paper/grid layout for given label size and grid
const layout = createTemplateLayout('A4', { width: 70, height: 36 }, { columns: 3, rows: 8 });
```

Example template:

```yaml
paper:
  size: A4 # A3 | A4 | A5 | Letter | Legal | custom (with width/height)
  orientation: portrait
  margin: { top: 10, left: 0, right: 0, bottom: 5 }
labels:
  width: 70
  height: 35
  columns: 3
  rows: 8
  safety: { top: 2, left: 2, right: 2, bottom: 2 }
fields:
  - field: CALL
    left: 2
    y: 2
    width: 40
    height: 6
    fontSize: 12
  - text: '73 de [CALL]'
    right: 2
    y: 12
    width: 40
    height: 5
    fontSize: 9
    align: center
```

## Development

| Command             | Description                              |
| ------------------- | ---------------------------------------- |
| `npm run build`     | Build ESM + CJS bundles and types        |
| `npm run dev`       | Rebuild on change                        |
| `npm test`          | Run tests (Vitest)                       |
| `npm run coverage`  | Run tests with coverage                  |
| `npm run typecheck` | Type-check with `tsc`                    |
| `npm run lint`      | Lint with ESLint                         |
| `npm run format`    | Format with Prettier                     |
| `npm version patch` | Bump the version and update `CHANGES.md` |

## License

MIT
