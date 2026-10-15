export interface Band {
  name: string;
  min: number;
  max: number;
  cabrillo: string;
  edi: string;
}

export const bands: Band[] = [
  { name: '2190m', min: 0.1357, max: 0.1378, cabrillo: '136', edi: '0.136 MHz' },
  { name: '630m', min: 0.472, max: 0.479, cabrillo: '475', edi: '0.475 MHz' },
  { name: '160m', min: 1.8, max: 2, cabrillo: '1800', edi: '1.8 MHz' },
  { name: '80m', min: 3.5, max: 4, cabrillo: '3500', edi: '3.5 MHz' },
  { name: '60m', min: 5.06, max: 5.45, cabrillo: '5300', edi: '5.3 MHz' },
  { name: '40m', min: 7, max: 7.3, cabrillo: '7000', edi: '7 MHz' },
  { name: '30m', min: 10.1, max: 10.15, cabrillo: '10100', edi: '10.1 MHz' },
  { name: '20m', min: 14, max: 14.35, cabrillo: '14000', edi: '14 MHz' },
  { name: '17m', min: 18.068, max: 18.168, cabrillo: '18068', edi: '18.068 MHz' },
  { name: '15m', min: 21, max: 21.45, cabrillo: '21000', edi: '21 MHz' },
  { name: '12m', min: 24.89, max: 24.99, cabrillo: '24890', edi: '24.89 MHz' },
  { name: '10m', min: 28, max: 29.7, cabrillo: '28000', edi: '28 MHz' },
  { name: '6m', min: 50, max: 54, cabrillo: '50', edi: '50 MHz' },
  { name: '4m', min: 70, max: 71, cabrillo: '70', edi: '70 MHz' },
  { name: '2m', min: 144, max: 148, cabrillo: '144', edi: '144 MHz' },
  { name: '1.25m', min: 222, max: 225, cabrillo: '222', edi: '222 MHz' },
  { name: '70cm', min: 420, max: 450, cabrillo: '432', edi: '435 MHz' },
  { name: '33cm', min: 902, max: 928, cabrillo: '902', edi: '902 MHz' },
  { name: '23cm', min: 1240, max: 1300, cabrillo: '1.2G', edi: '1.3 GHz' },
  { name: '13cm', min: 2300, max: 2450, cabrillo: '2.3G', edi: '2.3 GHz' },
  { name: '9cm', min: 3300, max: 3600, cabrillo: '3.4G', edi: '3.4 GHz' },
  { name: '6cm', min: 5650, max: 5925, cabrillo: '5.7G', edi: '5.7 GHz' },
  { name: '3cm', min: 10000, max: 10500, cabrillo: '10G', edi: '10 GHz' },
  { name: '1.25cm', min: 24000, max: 24250, cabrillo: '24G', edi: '24 GHz' },
  { name: '6mm', min: 47000, max: 47200, cabrillo: '47G', edi: '47 GHz' },
  { name: '4mm', min: 75500, max: 81000, cabrillo: '75G', edi: '76 GHz' },
  { name: '2.5mm', min: 119980, max: 123000, cabrillo: '122G', edi: '120 GHz' },
  { name: '2mm', min: 134000, max: 149000, cabrillo: '134G', edi: '144 GHz' },
  { name: '1mm', min: 241000, max: 250000, cabrillo: '241G', edi: '248 GHz' },
];

export function bandAt(mhz: number): Band | undefined {
  return bands.find(({ min, max }) => mhz >= min && mhz <= max);
}

export function bandNamed(value: string): Band | undefined {
  return bands.find(({ name }) => name === value.toLowerCase());
}

export function bandFrequencyMhz(band: Band, mode = ''): string {
  const normalizedMode = mode.trim().toUpperCase();
  if (band.name === '80m') return ['SSB', 'LSB', 'USB'].includes(normalizedMode) ? '3.7' : '3.5';
  if (band.name === '2m' && normalizedMode === 'FM') return '145';

  const match = /^(\d+(?:\.\d+)?)\s*(MHz|GHz)$/i.exec(band.edi);
  if (!match) throw new Error(`Invalid nominal frequency for band "${band.name}".`);
  return String(Number(match[1]) * (match[2].toLowerCase() === 'ghz' ? 1000 : 1));
}

export function ediFrequencyMhz(value: string): string | undefined {
  const match = /^(\d+(?:[.,]\d+)?)\s*(MHz|GHz)?$/i.exec(value);
  if (!match) return;
  return String(
    Number(match[1].replace(',', '.')) * (match[2]?.toLowerCase() === 'ghz' ? 1000 : 1),
  );
}

export function ediBand(value: string): Band | undefined {
  const frequency = ediFrequencyMhz(value);
  return frequency === undefined ? bandNamed(value) : bandAt(Number(frequency));
}
