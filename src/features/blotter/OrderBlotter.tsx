import { useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import {
  AllCommunityModule,
  ModuleRegistry,
  colorSchemeDark,
  themeAlpine,
  type GridOptions,
} from 'ag-grid-community';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import type { EditableField } from '../../../shared/protocol/worker-messages.ts';
import { useConnectionStatus } from '../../stream/streamContext.ts';
import { columnDefs, type BlotterContext } from './columnDefs.ts';
import { useGridSink } from './useGridSink.ts';
import './OrderBlotter.css';

ModuleRegistry.registerModules([AllCommunityModule]);

const gridTheme = themeAlpine.withPart(colorSchemeDark);

export function OrderBlotter() {
  const { onGridReady, mutate } = useGridSink();
  const status = useConnectionStatus();

  // Read by the grid's `editable` callbacks without re-creating gridOptions
  const isLiveRef = useRef(false);
  useEffect(() => {
    isLiveRef.current = status.state === 'live';
  }, [status]);

  // Rows come from the server snapshot; show the loading overlay until it arrives
  const gridOptions = useMemo<GridOptions<OrderRow>>(
    () => ({
      getRowId: (params) => params.data.orderId,
      context: { isLive: () => isLiveRef.current } satisfies BlotterContext,
      loading: true,
      rowBuffer: 25,
      asyncTransactionWaitMillis: 16,
      onGridReady,
      onCellEditingStopped: (event) => {
        if (!event.data || !event.valueChanged) return;
        mutate(event.data.orderId, event.colDef.field as EditableField, Number(event.newValue));
      },
    }),
    [onGridReady, mutate],
  );

  return (
    // data-state drives the dimmed look when the data on screen isn't live
    <div className="blotter" data-state={status.state}>
      <AgGridReact theme={gridTheme} columnDefs={columnDefs} gridOptions={gridOptions} />
    </div>
  );
}
