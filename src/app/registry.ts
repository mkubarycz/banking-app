import { ResourceRegistry } from '../framework/registry.js';
import { ledgerEntryResource } from './resources/ledger-entry.js';

export function createRegistry(): ResourceRegistry {
  return new ResourceRegistry()
    .register(ledgerEntryResource);
}
