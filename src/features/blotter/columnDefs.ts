import type { ColDef, ValueFormatterParams } from 'ag-grid-community';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';

type NumberFormatterParams = ValueFormatterParams<OrderRow, number>;

export const columnDefs: ColDef<OrderRow>[] = [
  { field: 'orderId', pinned: 'left', width: 120 },
  { field: 'underlying', filter: true, width: 120 },
  {
    field: 'price',
    editable: true,
    valueFormatter: (p: NumberFormatterParams) => p.value?.toFixed(2) ?? '0.00',
    cellClassRules: { 'grid-numeric-flash': () => true },
  },
  {
    field: 'quantity',
    editable: true,
    valueFormatter: (p: NumberFormatterParams) => p.value?.toLocaleString() ?? '0',
  },
  {
    field: 'delta',
    valueFormatter: (p: NumberFormatterParams) => p.value?.toFixed(3) ?? '0.000',
  },
];
