import type {
  CellClassParams,
  ColDef,
  EditableCallbackParams,
  ValueFormatterParams,
} from 'ag-grid-community';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import type { EditableField } from '../../../shared/protocol/worker-messages.ts';

// Passed as the grid's `context`, available to column callbacks
export interface BlotterContext {
  isLive: () => boolean;
  isPending: (orderId: string, field: EditableField) => boolean;
  isRejected: (orderId: string, field: EditableField) => boolean;
}

type NumberFormatterParams = ValueFormatterParams<OrderRow, number>;

const blotterContext = (p: { context: unknown }) => p.context as BlotterContext;

// Edits are only allowed while the stream is live; otherwise they'd be rejected
const editableWhenLive = (p: EditableCallbackParams<OrderRow>) => blotterContext(p).isLive();

// Pending: sent, awaiting the server's ack. Rejected: briefly highlighted while it rolls back.
function editStateClasses(field: EditableField) {
  return {
    'cell-pending': (p: CellClassParams<OrderRow>) =>
      !!p.data && blotterContext(p).isPending(p.data.orderId, field),
    'cell-rejected': (p: CellClassParams<OrderRow>) =>
      !!p.data && blotterContext(p).isRejected(p.data.orderId, field),
  };
}

// Standard equity option: one contract covers 100 shares
export const CONTRACT_MULTIPLIER = 100;

// Right-aligned, flashes when a tick changes the value
const numeric: ColDef<OrderRow> = {
  cellDataType: 'number',
  type: 'rightAligned',
  enableCellChangeFlash: true,
};

export const columnDefs: ColDef<OrderRow>[] = [
  { field: 'orderId', pinned: 'left', flex: 0, width: 120 },
  { field: 'underlying', filter: true, flex: 0, width: 130 },
  {
    ...numeric,
    field: 'price',
    editable: editableWhenLive,
    valueFormatter: (p: NumberFormatterParams) => p.value?.toFixed(2) ?? '0.00',
    cellClassRules: editStateClasses('price'),
  },
  {
    ...numeric,
    field: 'quantity',
    editable: editableWhenLive,
    valueFormatter: (p: NumberFormatterParams) => p.value?.toLocaleString() ?? '0',
    cellClassRules: editStateClasses('quantity'),
  },
  {
    ...numeric,
    colId: 'notional',
    headerName: 'Notional',
    valueGetter: (p) => (p.data ? p.data.price * p.data.quantity * CONTRACT_MULTIPLIER : null),
    valueFormatter: (p: NumberFormatterParams) =>
      p.value?.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) ??
      '',
  },
  {
    ...numeric,
    field: 'delta',
    valueFormatter: (p: NumberFormatterParams) => p.value?.toFixed(3) ?? '0.000',
  },
];
