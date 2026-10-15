import { parse as parseYaml, YAMLParseError } from 'yaml';
import type {
  Insets,
  GridLayout,
  LabelSize,
  LabelTemplate,
  PaperSettings,
  PaperTemplate,
  TemplateLayout,
  TemplateInput,
  TemplateItem,
} from './types';

export class TemplateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TemplateError';
  }
}

const zeroInsets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export interface NormalizedTemplate {
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

export function parseTemplate(input: TemplateInput): LabelTemplate {
  if (typeof input !== 'string') return validateTemplateObject(input);
  let parsed: unknown;
  try {
    parsed = parseYaml(input);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      throw new TemplateError(`Invalid template YAML: ${error.message}`, { cause: error });
    }
    throw error;
  }
  return validateTemplateObject(parsed);
}

export function normalizeTemplate(template: LabelTemplate): NormalizedTemplate {
  const paper = template.paper ?? {};
  const [paperWidth, paperHeight] = paperDimensions(paper);
  const layout = template.labels;
  if (paper.margin !== undefined && layout.margin !== undefined) {
    throw new TemplateError('Specify paper.margin or legacy labels.margin, not both.');
  }
  const margin = { ...zeroInsets, ...(paper.margin ?? layout.margin) };
  const safety = { ...zeroInsets, ...layout.safety };
  const gapX = layout.gapX ?? 0;
  const gapY = layout.gapY ?? 0;

  if (
    Object.values(margin).some((value) => value < 0) ||
    Object.values(safety).some((value) => value < 0)
  ) {
    throw new TemplateError('Margins cannot be negative.');
  }
  if (
    margin.left + margin.right + layout.columns * layout.width + (layout.columns - 1) * gapX >
      paperWidth + 1e-6 ||
    margin.top + margin.bottom + layout.rows * layout.height + (layout.rows - 1) * gapY >
      paperHeight + 1e-6
  ) {
    throw new TemplateError('Label grid and paper margins exceed the paper dimensions.');
  }
  if (safety.left + safety.right >= layout.width || safety.top + safety.bottom >= layout.height) {
    throw new TemplateError('Sticker safety margins leave no printable area.');
  }

  return {
    paperWidth,
    paperHeight,
    labels: {
      width: layout.width,
      height: layout.height,
      columns: layout.columns,
      rows: layout.rows,
      gapX,
      gapY,
      margin,
      safety,
    },
    fields: template.fields,
  };
}

export function createTemplateLayout(
  paperInput: NonNullable<PaperTemplate['size']> | PaperSettings,
  label: LabelSize,
  grid: GridLayout,
): TemplateLayout {
  const paper = typeof paperInput === 'string' ? { size: paperInput } : paperInput;
  const [paperWidth, paperHeight] = paperDimensions(paper);
  const width = positive(label.width, 'labels.width');
  const height = positive(label.height, 'labels.height');
  const columns = positiveInteger(grid.columns, 'labels.columns');
  const rows = positiveInteger(grid.rows, 'labels.rows');
  const gapX = optionalNonNegative(grid.gapX, 'labels.gapX') ?? 0;
  const gapY = optionalNonNegative(grid.gapY, 'labels.gapY') ?? 0;
  const remainingWidth = paperWidth - columns * width - (columns - 1) * gapX;
  const remainingHeight = paperHeight - rows * height - (rows - 1) * gapY;
  if (remainingWidth < -1e-6 || remainingHeight < -1e-6) {
    throw new TemplateError('Label grid exceeds the paper dimensions.');
  }
  const horizontal = Math.max(0, remainingWidth) / 2;
  const vertical = Math.max(0, remainingHeight) / 2;
  return {
    paper: {
      size: paper.size ?? 'A4',
      orientation: paper.orientation ?? 'portrait',
      ...(paper.size === 'custom' ? { width: paper.width, height: paper.height } : {}),
      margin: { top: vertical, bottom: vertical, left: horizontal, right: horizontal },
    },
    labels: {
      width,
      height,
      columns,
      rows,
      ...(grid.gapX === undefined ? {} : { gapX }),
      ...(grid.gapY === undefined ? {} : { gapY }),
    },
  };
}

function paperDimensions(paper: PaperSettings): [number, number] {
  const size = paper.size ?? 'A4';
  const paperSizes: Record<Exclude<typeof size, 'custom'>, [number, number]> = {
    A3: [297, 420],
    A4: [210, 297],
    A5: [148, 210],
    Letter: [215.9, 279.4],
    Legal: [215.9, 355.6],
  };
  if (size !== 'custom' && !Object.hasOwn(paperSizes, size)) {
    throw new TemplateError('paper.size must be A3, A4, A5, Letter, Legal, or custom.');
  }
  const orientation = paper.orientation ?? 'portrait';
  if (orientation !== 'portrait' && orientation !== 'landscape') {
    throw new TemplateError('paper.orientation must be portrait or landscape.');
  }
  let [paperWidth, paperHeight] =
    size === 'custom'
      ? [positive(paper.width, 'paper.width'), positive(paper.height, 'paper.height')]
      : paperSizes[size];
  if (orientation === 'landscape') {
    [paperWidth, paperHeight] = [paperHeight, paperWidth];
  }
  return [paperWidth, paperHeight];
}

function validateTemplateObject(value: unknown): LabelTemplate {
  if (!isObject(value)) throw new TemplateError('Template must be a YAML mapping.');
  const paper = value.paper;
  if (paper !== undefined) {
    if (!isObject(paper)) throw new TemplateError('paper must be a mapping.');
    if (paper.margin !== undefined) insets(paper.margin, 'paper.margin');
    if (
      paper.size !== undefined &&
      !['A3', 'A4', 'A5', 'Letter', 'Legal', 'custom'].includes(String(paper.size))
    ) {
      throw new TemplateError('paper.size must be A3, A4, A5, Letter, Legal, or custom.');
    }
    if (
      paper.orientation !== undefined &&
      paper.orientation !== 'portrait' &&
      paper.orientation !== 'landscape'
    ) {
      throw new TemplateError('paper.orientation must be portrait or landscape.');
    }
    if (paper.size === 'custom') {
      positive(paper.width, 'paper.width');
      positive(paper.height, 'paper.height');
    }
  }

  const rawLabels = value.labels;
  if (!isObject(rawLabels)) throw new TemplateError('labels must be a mapping.');
  const width = positive(rawLabels.width, 'labels.width');
  const height = positive(rawLabels.height, 'labels.height');
  const columns = positiveInteger(rawLabels.columns, 'labels.columns');
  const rows = positiveInteger(rawLabels.rows, 'labels.rows');
  const gapX = optionalNonNegative(rawLabels.gapX, 'labels.gapX');
  const gapY = optionalNonNegative(rawLabels.gapY, 'labels.gapY');
  if (isObject(paper) && paper.margin !== undefined && rawLabels.margin !== undefined) {
    throw new TemplateError('Specify paper.margin or legacy labels.margin, not both.');
  }
  const margin =
    rawLabels.margin === undefined ? undefined : insets(rawLabels.margin, 'labels.margin');
  const safety = insets(rawLabels.safety, 'labels.safety');
  if (!Array.isArray(value.fields) || value.fields.length === 0) {
    throw new TemplateError('fields must be a non-empty list.');
  }
  const fields = value.fields.map((item, index) => validateItem(item, index));

  return {
    paper: paper as LabelTemplate['paper'],
    labels: { width, height, columns, rows, gapX, gapY, margin, safety },
    fields,
  };
}

function validateItem(value: unknown, index: number): TemplateItem {
  if (!isObject(value)) throw new TemplateError(`fields[${index}] must be a mapping.`);
  const hasField = typeof value.field === 'string' && value.field.trim().length > 0;
  const hasText = typeof value.text === 'string';
  if (hasField === hasText) {
    throw new TemplateError(`fields[${index}] must define exactly one of field or text.`);
  }
  if (value.font !== undefined && typeof value.font !== 'string') {
    throw new TemplateError(`fields[${index}].font must be a string.`);
  }
  if ('x' in value || 'xFrom' in value) {
    throw new TemplateError(`fields[${index}]: replace x and xFrom with left or right.`);
  }
  if ((value.left !== undefined) === (value.right !== undefined)) {
    throw new TemplateError(`fields[${index}] must define exactly one of left or right.`);
  }
  if (
    value.align !== undefined &&
    value.align !== 'left' &&
    value.align !== 'center' &&
    value.align !== 'right'
  ) {
    throw new TemplateError(`fields[${index}].align must be left, center, or right.`);
  }
  return {
    ...(hasField
      ? { field: (value.field as string).trim().toUpperCase() }
      : { text: value.text as string }),
    ...(value.left !== undefined
      ? { left: nonNegative(value.left, `fields[${index}].left`) }
      : { right: nonNegative(value.right, `fields[${index}].right`) }),
    y: nonNegative(value.y, `fields[${index}].y`),
    width: positive(value.width, `fields[${index}].width`),
    height: positive(value.height, `fields[${index}].height`),
    fontSize: positive(value.fontSize, `fields[${index}].fontSize`),
    ...(value.font ? { font: value.font } : {}),
    ...(value.align ? { align: value.align } : {}),
  };
}

function insets(value: unknown, name: string): Partial<Insets> {
  if (value === undefined) return {};
  if (!isObject(value)) throw new TemplateError(`${name} must be a mapping.`);
  const result: Partial<Insets> = {};
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    if (value[side] !== undefined) result[side] = nonNegative(value[side], `${name}.${side}`);
  }
  return result;
}

function positive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TemplateError(`${name} must be a positive number.`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  const result = positive(value, name);
  if (!Number.isInteger(result)) throw new TemplateError(`${name} must be an integer.`);
  return result;
}

function nonNegative(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TemplateError(`${name} must be a non-negative number.`);
  }
  return value;
}

function optionalNonNegative(value: unknown, name: string): number | undefined {
  return value === undefined ? undefined : nonNegative(value, name);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
