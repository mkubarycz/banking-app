import type { ResourceEnvelope } from '../framework/types.js';
import { cents, money } from './money.js';

export interface DashboardGroup {
  month: string;
  income: string;
  expense: string;
  transfers: string;
  operatingCashFlow: string;
  transactionCount: number;
}

export function summarizeTransactions(transactions: ResourceEnvelope[], year: string) {
  const matching = transactions.filter(
    (transaction) => reportingYear(transaction) === year
      && transaction.status.deleted !== true,
  );
  const grouped = new Map<string, {
    income: bigint; expense: bigint; transfers: bigint; count: number;
  }>();
  for (const transaction of matching) {
    const month = String(transaction.spec.date).slice(0, 7);
    const group = grouped.get(month) ?? {
      income: 0n, expense: 0n, transfers: 0n, count: 0,
    };
    const amount = cents(String(transaction.spec.amount));
    if (transaction.status.classification === 'Income') group.income += amount;
    else if (transaction.status.classification === 'Expense') group.expense += amount;
    else group.transfers += amount;
    group.count += 1;
    grouped.set(month, group);
  }
  const groups: DashboardGroup[] = [...grouped].sort().map(([month, values]) => ({
    month,
    income: money(values.income),
    expense: money(values.expense),
    transfers: money(values.transfers),
    operatingCashFlow: money(values.income - values.expense),
    transactionCount: values.count,
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
      transactionCount: matching.length,
    },
  };
}

export function reportingYear(entry: ResourceEnvelope): string {
  return String(entry.spec.date).slice(0, 4);
}
