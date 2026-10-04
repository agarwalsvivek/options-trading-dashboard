import type { ColDef, EditableCallbackParams, ValueFormatterParams } from 'ag-grid-community';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';

// Passed as the grid's `context`, available to column callbacks
export interface BlotterContext {
  isLive: () => boolean;
}

type NumberFormatterParams = ValueFormatterParams<OrderRow, number>;

// Edits are only allowed while the stream is live; otherwise they'd be rejected
const editableWhenLive = (p: EditableCallbackParams<OrderRow>) =>
  (p.context as BlotterContext).isLive();

export const columnDefs: ColDef<OrderRow>[] = [
  { field: 'orderId', pinned: 'left', width: 120 },
  { field: 'underlying', filter: true, width: 120 },
  {
    field: 'price',
    editable: editableWhenLive,
    valueFormatter: (p: NumberFormatterParams) => p.value?.toFixed(2) ?? '0.00',
    cellClassRules: { 'grid-numeric-flash': () => true },
  },
  {
    field: 'quantity',
    editable: editableWhenLive,
    valueFormatter: (p: NumberFormatterParams) => p.value?.toLocaleString() ?? '0',
  },
  {
    field: 'delta',
    valueFormatter: (p: NumberFormatterParams) => p.value?.toFixed(3) ?? '0.000',
  },
];
