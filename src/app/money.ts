import { z } from 'zod';

export const Money = z.string()
  .regex(/^-?(?:0|[1-9]\d*)\.\d{2}$/, 'Money must be a canonical decimal string such as "125.00" or "-4.25".')
  .describe('Exact signed decimal amount with exactly two fractional digits; never a JSON number.');

export function cents(value: string): bigint {
  const sign = value.startsWith('-') ? -1n : 1n;
  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const [whole, fraction] = unsigned.split('.');
  return sign * (BigInt(whole) * 100n + BigInt(fraction));
}

export function money(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
