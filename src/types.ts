export const supportedLogFormats = ['adif', 'cabrillo', 'edi'] as const;

export type SupportedLogFormat = (typeof supportedLogFormats)[number];
export type LogInput = string | Uint8Array;
export type LogRecord = Record<string, string>;

export interface ParsedLog {
  format: SupportedLogFormat;
  records: LogRecord[];
  metadata?: LogRecord;
}

export interface SerializedLogFile {
  content: string;
  extension: 'adi' | 'cbr' | 'edi';
  band?: string;
  qsoCount: number;
}

export interface SerializedLog {
  files: SerializedLogFile[];
  warnings: string[];
}

export type TemplateInput = string | LabelTemplate;

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PaperTemplate {
  size?: 'A3' | 'A4' | 'A5' | 'Letter' | 'Legal' | 'custom';
  orientation?: 'portrait' | 'landscape';
  width?: number;
  height?: number;
  margin?: Partial<Insets>;
}

export interface LabelLayout {
  width: number;
  height: number;
  columns: number;
  rows: number;
  gapX?: number;
  gapY?: number;
  /** @deprecated Use paper.margin instead. */
  margin?: Partial<Insets>;
  safety?: Partial<Insets>;
}

export type TemplateItem = {
  field?: string;
  text?: string;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  font?: string;
  align?: 'left' | 'center' | 'right';
} & ({ left: number; right?: never } | { right: number; left?: never });

export interface LabelTemplate {
  paper?: PaperTemplate;
  labels: LabelLayout;
  fields: TemplateItem[];
}

export type PaperSettings = Omit<PaperTemplate, 'margin'>;
export type LabelSize = Pick<LabelLayout, 'width' | 'height'>;
export type GridLayout = Pick<LabelLayout, 'columns' | 'rows' | 'gapX' | 'gapY'>;

export interface TemplateLayout {
  paper: PaperSettings & {
    size: NonNullable<PaperTemplate['size']>;
    orientation: NonNullable<PaperTemplate['orientation']>;
    margin: Insets;
  };
  labels: LabelSize & GridLayout;
}
