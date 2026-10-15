# hamlogparse

Parser for amateur radio (ham) log files and QSL label layout templates, written in TypeScript.

Supported log formats: **ADIF**, **Cabrillo** and **EDI** (IARU Region 1). Every QSO is
returned as a record of ADIF-style field names (`CALL`, `QSO_DATE`, `TIME_ON`, `MODE`, …).

## Install

```sh
npm install hamlogparse
```

## Usage

### Logs

```ts
import { parseLog, selectFields } from 'hamlogparse';

// input is a string or UTF-8 bytes (Uint8Array); the format is auto-detected
const { format, records } = parseLog(text);

// or force a format: 'adif' | 'cabrillo' | 'edi'
parseLog(text, 'adif');

// sorted list of all field names used in the log
selectFields(text); // ['CALL', 'MODE', 'QSO_DATE', ...]
```

### Templates

Label templates (YAML string or object) describe the paper, the label grid and the fields
placed on each label. All dimensions are in millimetres.

```ts
import { createTemplateLayout, normalizeTemplate, parseTemplate, TemplateError } from 'hamlogparse';

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

| Command             | Description                       |
| ------------------- | --------------------------------- |
| `npm run build`     | Build ESM + CJS bundles and types |
| `npm run dev`       | Rebuild on change                 |
| `npm test`          | Run tests (Vitest)                |
| `npm run coverage`  | Run tests with coverage           |
| `npm run typecheck` | Type-check with `tsc`             |
| `npm run lint`      | Lint with ESLint                  |
| `npm run format`    | Format with Prettier              |

## License

MIT
