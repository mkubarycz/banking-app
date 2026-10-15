export interface SnapshotAccount {
  id: string;
  name: string;
  institution: string;
  value: string;
}

export const SNAPSHOT_DATE = '2026-10-11';

export const SNAPSHOT_ACCOUNTS: SnapshotAccount[] = [
  { id: '9e1d5591-c400-5be4-bfa4-193ee416fdd8', name: '1777 Bill Pay 2 3k', institution: 'Bank of America', value: '3480.20' },
  { id: 'f5622c61-70c6-56ff-8b8d-5c3c52233612', name: '3608 Bill Pay 1 3k - 3806', institution: 'Bank of America', value: '2884.41' },
  { id: 'b954a650-138d-5d74-8724-93899e7e0a1d', name: '3695 Bill Pay 3 12k', institution: 'Bank of America', value: '12611.38' },
  { id: 'a954ca56-3181-5944-8d73-74f85209a2be', name: '4060 Ingest', institution: 'Bank of America', value: '42366.30' },
  { id: '2fb5ace5-6e85-5455-8b97-71bcef553903', name: 'Avery 4027', institution: 'Bank of America', value: '278.70' },
  { id: 'c0bce72a-6280-5ba1-ab8d-00d25445f3b1', name: 'Elliot - 9896', institution: 'Bank of America', value: '442.11' },
  { id: 'f1b933c4-1aaf-55e3-8433-5580225b3b0e', name: 'Emergency 50k - 1086', institution: 'Bank of America', value: '50014.15' },
  { id: '417970fd-99f5-5f49-93a7-b28f090a986f', name: 'Tate 4086', institution: 'Bank of America', value: '524.76' },
  { id: 'd979af1d-f983-534c-af57-e4001e0c2267', name: 'Mike Steph IRA - 4668', institution: 'Merrill', value: '338149.39' },
  { id: 'ecef343a-5085-5c6a-99fe-beb482833aef', name: 'Mike Steph Roth IRA - 9G86', institution: 'Merrill', value: '1241.87' },
  { id: 'c5380dd7-1b3a-5c86-b47a-532d1b8cee23', name: 'SEP IRA Retirement - 7N04', institution: 'Merrill', value: '49890.88' },
  { id: '818fefae-3e16-57a0-b754-fea519b711fe', name: 'Short Term Cash 121k - 0D81', institution: 'Merrill', value: '146994.38' },
  { id: 'abe6b7e7-64ca-5c97-a867-e39abb699c5f', name: 'Avery College - 8970', institution: 'Merrill', value: '1539.60' },
  { id: '9fda406f-0d3f-53f2-9de5-9f9e9048da7f', name: 'Elliot College - 9D50', institution: 'Merrill', value: '1581.23' },
  { id: 'd8c333b6-99cf-529e-afba-ae1e9689b004', name: 'Tate College - 9A36', institution: 'Merrill', value: '1539.60' },
];

export const SNAPSHOT_ACCOUNT_BY_ID = new Map(
  SNAPSHOT_ACCOUNTS.map((account) => [account.id, account]),
);

export function stableUuid(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
import { createHash } from 'node:crypto';
