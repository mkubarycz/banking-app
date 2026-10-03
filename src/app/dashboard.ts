import type { ResourceEnvelope } from '../framework/types.js';
import { cents, money } from './money.js';

export interface DashboardGroup {
  status: string;
  revenue: string;
  expenses: string;
  operatingCashFlow: string;
  activeEntryCount: number;
}

export function summarizeLedger(entries: ResourceEnvelope[], year: string) {
  const matching = entries.filter((entry) => reportingYear(entry) === year);
  const grouped = new Map<string, { revenue: bigint; expenses: bigint; count: number }>();
  for (const entry of matching) {
    const status = String(entry.spec.status);
    const group = grouped.get(status) ?? { revenue: 0n, expenses: 0n, count: 0 };
    group.revenue += cents(String(entry.spec.revenue));
    group.expenses += cents(String(entry.spec.expenses));
    group.count += 1;
    grouped.set(status, group);
  }
  const groups: DashboardGroup[] = [...grouped].map(([status, values]) => ({
    status,
    revenue: money(values.revenue),
    expenses: money(values.expenses),
    operatingCashFlow: money(values.revenue - values.expenses),
    activeEntryCount: values.count,
  }));
  const totalRevenue = groups.reduce((sum, group) => sum + cents(group.revenue), 0n);
  const totalExpenses = groups.reduce((sum, group) => sum + cents(group.expenses), 0n);
  return {
    year,
    groups,
    total: {
      revenue: money(totalRevenue),
      expenses: money(totalExpenses),
      operatingCashFlow: money(totalRevenue - totalExpenses),
      activeEntryCount: matching.length,
    },
  };
}

export function reportingYear(entry: ResourceEnvelope): string {
  const source = entry.spec.source;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const worksheet = (source as Record<string, unknown>).worksheet;
    if (typeof worksheet === 'string') {
      const match = worksheet.match(/^(\d{4}) Ledger$/);
      if (match) return match[1];
    }
  }
  return String(entry.spec.date).slice(0, 4);
}
