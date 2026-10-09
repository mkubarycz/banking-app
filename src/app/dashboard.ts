import type { ResourceEnvelope } from '../framework/types.js';
import { cents, money } from './money.js';

export interface DashboardGroup {
  status: string;
  income: string;
  expense: string;
  operatingCashFlow: string;
  activeEntryCount: number;
}

export function summarizeLedger(entries: ResourceEnvelope[], year: string) {
  const matching = entries.filter((entry) => reportingYear(entry) === year);
  const grouped = new Map<string, { income: bigint; expense: bigint; count: number }>();
  for (const entry of matching) {
    const status = String(entry.spec.status);
    const group = grouped.get(status) ?? { income: 0n, expense: 0n, count: 0 };
    group.income += cents(String(entry.status.income));
    group.expense += cents(String(entry.status.expense));
    group.count += 1;
    grouped.set(status, group);
  }
  const groups: DashboardGroup[] = [...grouped].map(([status, values]) => ({
    status,
    income: money(values.income),
    expense: money(values.expense),
    operatingCashFlow: money(values.income - values.expense),
    activeEntryCount: values.count,
  }));
  const totalIncome = groups.reduce((sum, group) => sum + cents(group.income), 0n);
  const totalExpense = groups.reduce((sum, group) => sum + cents(group.expense), 0n);
  return {
    year,
    groups,
    total: {
      income: money(totalIncome),
      expense: money(totalExpense),
      operatingCashFlow: money(totalIncome - totalExpense),
      activeEntryCount: matching.length,
    },
  };
}

export function reportingYear(entry: ResourceEnvelope): string {
  return String(entry.spec.date).slice(0, 4);
}
