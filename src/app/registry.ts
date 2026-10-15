import { ResourceRegistry } from '../framework/registry.js';
import { accountResource } from './resources/account.js';
import { accountKnownValueResource } from './resources/account-known-value.js';
import { budgetResource } from './resources/budget.js';
import { changeSetResource } from './resources/change-set.js';
import { transactionResource } from './resources/transaction.js';

export function createRegistry(): ResourceRegistry {
  return new ResourceRegistry()
    .register(accountResource)
    .register(budgetResource)
    .register(transactionResource)
    .register(accountKnownValueResource)
    .register(changeSetResource);
}
