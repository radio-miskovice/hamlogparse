# API reference

This document describes the package's public exports. Import them from
`hamlogparse4print`:

```ts
import {
  createTemplateLayout,
  normalizeTemplate,
  parseLog,
  parseTemplate,
  selectFields,
  serializeLog,
  supportedLogFormats,
  TemplateError,
} from 'hamlogparse4print';
```

The package is synchronous, performs no filesystem or network access, and
requires Node.js 18 or later.

## Log types

### `supportedLogFormats`

Runtime constant with the supported formats, in order:

```ts
['adif', 'cabrillo', 'edi'] as const;
```

### `SupportedLogFormat`

Union of the supported format names: `'adif' | 'cabrillo' | 'edi'`.

### `LogInput`

`string | Uint8Array`. Byte inputs must contain valid UTF-8.

### `LogRecord`

`Record<string, string>`. Record keys are field names (usually ADIF-style,
uppercase); values are strings. No fixed set of fields is required.

### `ParsedLog`

```ts
interface ParsedLog {
  format: SupportedLogFormat;
  records: LogRecord[];
  metadata?: LogRecord;
}
```

`metadata` is present for Cabrillo and EDI input. Available station callsign,
station locator, and contest name values are also copied into QSO records when
they are available. ADIF parsing does not return a metadata object.

## Parsing logs

### `parseLog(input, format?)`

```ts
function parseLog(input: LogInput, format?: SupportedLogFormat): ParsedLog;
```

Parses an ADIF, Cabrillo, or IARU Region 1 EDI log. If `format` is omitted, the
parser detects it from the input; provide a format to bypass detection. ADIF
refers to the length-delimited ADI text format, not XML ADX. ADIF field lengths
are measured in UTF-8 bytes.

The result's `records` contain the parsed QSOs. Date and time values are
validated when present. An invalid date, time, frequency, band, malformed
input, or unsupported format throws an `Error`. Errors that identify a source
location include a one-based `(line N)` suffix. Invalid UTF-8 byte input also
throws an error with a line number.

Format-specific behavior:

- **ADIF:** Reads length-delimited tags, ignores header fields before `<EOH>`,
  and ends a QSO at `<EOR>`. Empty values are retained. Field names are
  uppercased. UTF-8 byte lengths are respected. A recognized `BAND` without
  `FREQ` is supplemented with a nominal frequency in MHz; 80 m SSB/LSB/USB
  uses 3.7 MHz, other 80 m modes use 3.5 MHz, and 2 m FM uses 145 MHz.
  Numeric `BAND` values are interpreted as frequencies in MHz and converted
  to a known band.
- **Cabrillo:** Reads `QSO:` records and common `CALLSIGN`, `GRID-LOCATOR`, and
  `CONTEST` headers. Phone (`PH`), RTTY (`RY`), digital (`DG`), and FM modes
  are mapped to common mode names. Both fixed-width and generic whitespace
  QSO layouts are supported. A recognized VHF-or-higher Cabrillo band designator
  becomes `BAND`; other positive numeric frequencies are converted from kHz
  to MHz in `FREQ`.
- **EDI:** Reads `[REG1TEST;...]`, its header fields, and the
  `[QSORecords;N]` section. `PCall`, `PWWLo`, and `TName` are exposed as
  station callsign, station locator, and contest name. `PBand` accepts known
  band names or numeric MHz/GHz frequencies (including decimal commas), and
  sets the corresponding `BAND` and normalized `FREQ` when recognized.
  EDI mode codes 1–9 are mapped to common modes; codes 3/4 also set
  `APP_HAMLOGPARSE_EDI_MODE` so a cross-mode value can be serialized again.
  Older rows without the empty received-exchange column are supported.
  The declared QSO count must match the records read. Two-digit years are
  resolved against `TDate` when possible and otherwise use 2000–2099; an
  ambiguous century is rejected.

`parseLog` does not guarantee that a parsed log is suitable for contest
submission or contains every field required by a particular contest.

### `selectFields(input, format?)`

```ts
function selectFields(input: LogInput, format?: SupportedLogFormat): string[];
```

Parses the log and returns the sorted, unique field names present across its
QSO records. It accepts the same input and optional format as `parseLog`, and
propagates its errors.

## Serializing logs

### `serializeLog(log, format)`

```ts
function serializeLog(
  log: Pick<ParsedLog, 'records' | 'metadata'>,
  format: SupportedLogFormat,
): SerializedLog;
```

Serializes records to ADIF, Cabrillo, or EDI. `records` must contain at least
one QSO. Optional `metadata` provides fallback station and contest values.
Serialization returns in-memory text; it does not write files.

Throws `Error` for an unsupported output format or an empty `records` array.
Values that cannot be represented are reported in `warnings`; they may be
replaced with spaces or left blank, rather than causing serialization to fail.
Warnings are unique strings.

Format behavior and limitations:

- **ADIF:** Returns one `.adi` file. Record fields are written as length-
  delimited tags, preserving arbitrary field names and values. Tags with empty
  values are omitted; each record ends with `<EOR>`.
- **Cabrillo:** Returns one `.cbr` file using the generic fixed-width exchange
  layout. Times are truncated to minutes. The output uses common QSO data,
  generic mode mappings, and band designators for VHF+ frequencies. Contest-
  specific layouts, scoring, and categories are not reconstructed.
- **EDI:** Returns one `.edi` file per band, with a separate
  `unknown-band` file for records whose band cannot be determined. Files
  include the standard EDI header keys, with unknown or uncomputed values left
  blank. Exact frequencies are not retained; the band is serialized instead.
  Times are truncated to minutes. Digital modes use generic MGM code 7.
  Numeric sent/received serials are zero-padded to three digits; serials are
  not generated. EDI output for HF bands may not be accepted by contest
  software.

### `SerializedLog`

```ts
interface SerializedLog {
  files: SerializedLogFile[];
  warnings: string[];
}
```

### `SerializedLogFile`

```ts
interface SerializedLogFile {
  content: string;
  extension: 'adi' | 'cbr' | 'edi';
  band?: string;
  qsoCount: number;
}
```

`band` is set for EDI files (`unknown-band` when no recognized band is
available); it is omitted for ADIF and Cabrillo.

Warnings can report:

- Fields outside the common QSO data omitted from Cabrillo/EDI.
- Contest-specific data not reconstructed, and missing values left blank.
- Format-specific loss of precision or unsupported modes.
- Unknown bands, mixed station/contest header values, unsupported characters,
  or values exceeding a target column's character limit.
- EDI output on HF bands, which may not be accepted by contest software.

## Label templates

All template dimensions and offsets are in millimetres.

### `TemplateError`

An `Error` subclass used for invalid templates and layouts. YAML syntax errors
from `parseTemplate` are wrapped in `TemplateError` with the original error as
`cause`.

### `TemplateInput`

`string | LabelTemplate`. Strings are parsed as YAML; objects are validated
directly.

### `parseTemplate(input)`

```ts
function parseTemplate(input: TemplateInput): LabelTemplate;
```

Parses and validates a YAML template string or validates an object. Field
names are trimmed and converted to uppercase. Numeric dimensions must be
finite; sizes and font sizes must be positive; offsets, gaps, margins, and
safety insets must be non-negative. `labels.columns` and `labels.rows` must
also be integers.

The template must contain a non-empty `fields` list. Every field item must set
exactly one of `field` or `text`, and exactly one of `left` or `right`.
Alignment, if specified, must be `left`, `center`, or `right`. Legacy `x` and
`xFrom` properties are rejected. If both `paper.margin` and legacy
`labels.margin` are supplied, validation fails.

### `normalizeTemplate(template)`

```ts
function normalizeTemplate(template: LabelTemplate): NormalizedTemplate;
```

Resolves paper dimensions, orientation, margins, safety insets, and label
gaps. Defaults to A4 portrait, zero margins, zero safety insets, and zero
gaps. Landscape orientation swaps paper width and height. Checks that the
label grid plus margins fits the paper and that safety insets leave a
printable area. Throws `TemplateError` when these constraints are violated.

`labels.margin` remains supported as a legacy alternative to `paper.margin`;
the normalized result exposes the resolved values under `labels.margin`.

### `createTemplateLayout(paper, label, grid)`

```ts
function createTemplateLayout(
  paper: NonNullable<PaperTemplate['size']> | PaperSettings,
  label: LabelSize,
  grid: GridLayout,
): TemplateLayout;
```

Creates paper and label-grid settings, centering the grid by dividing any
remaining horizontal and vertical space equally into margins. It does not
create the template's `fields` array. Defaults to A4 portrait; gaps default to
zero. Throws `TemplateError` for invalid dimensions, counts, gaps, paper
settings, or a grid that exceeds the paper.

Built-in paper dimensions (width × height, portrait) are A3 297 × 420 mm,
A4 210 × 297 mm, A5 148 × 210 mm, Letter 215.9 × 279.4 mm, and Legal
215.9 × 355.6 mm. Custom paper requires positive `width` and `height`.

### Template and layout types

```ts
interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface PaperTemplate {
  size?: 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal' | 'custom';
  orientation?: 'portrait' | 'landscape';
  width?: number;
  height?: number;
  margin?: Partial<Insets>;
}

interface LabelLayout {
  width: number;
  height: number;
  columns: number;
  rows: number;
  gapX?: number;
  gapY?: number;
  margin?: Partial<Insets>; // deprecated; use PaperTemplate.margin
  safety?: Partial<Insets>;
}

type TemplateItem = {
  field?: string;
  text?: string;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  font?: string;
  align?: 'left' | 'center' | 'right';
} & ({ left: number; right?: never } | { right: number; left?: never });

interface LabelTemplate {
  paper?: PaperTemplate;
  labels: LabelLayout;
  fields: TemplateItem[];
}

type PaperSettings = Omit<PaperTemplate, 'margin'>;
type LabelSize = Pick<LabelLayout, 'width' | 'height'>;
type GridLayout = Pick<LabelLayout, 'columns' | 'rows' | 'gapX' | 'gapY'>;

interface TemplateLayout {
  paper: PaperSettings & {
    size: NonNullable<PaperTemplate['size']>;
    orientation: NonNullable<PaperTemplate['orientation']>;
    margin: Insets;
  };
  labels: LabelSize & GridLayout;
}

interface NormalizedTemplate {
  paperWidth: number;
  paperHeight: number;
  labels: {
    width: number;
    height: number;
    columns: number;
    rows: number;
    gapX: number;
    gapY: number;
    margin: Insets;
    safety: Insets;
  };
  fields: TemplateItem[];
}
```

`TemplateItem.field` names a log field to print. `TemplateItem.text` is literal
template text (which may contain substitutions handled by the consuming
application). Exactly one must be set. Position is measured from the selected
left or right edge and from the top (`y`) of the label.

## Complete exported type list

The package exports these types from its root entry point:

`GridLayout`, `Insets`, `LabelLayout`, `LabelSize`, `LabelTemplate`,
`LogInput`, `LogRecord`, `PaperSettings`, `PaperTemplate`, `ParsedLog`,
`SerializedLog`, `SerializedLogFile`, `SupportedLogFormat`, `TemplateInput`,
`TemplateItem`, and `TemplateLayout`, as well as `NormalizedTemplate`.
