import { ResourceRegistry } from '../framework/registry.js';
import { accountResource } from './resources/account.js';
import { categoryResource } from './resources/category.js';
import { ledgerEntryGroupResource } from './resources/ledger-entry-group.js';
import { ledgerEntryResource } from './resources/ledger-entry.js';
import { transactionStagingResource } from './resources/transaction-staging.js';

export function createRegistry(): ResourceRegistry {
  return new ResourceRegistry()
    .register(accountResource)
    .register(categoryResource)
    .register(ledgerEntryGroupResource)
    .register(ledgerEntryResource)
    .register(transactionStagingResource);
}
