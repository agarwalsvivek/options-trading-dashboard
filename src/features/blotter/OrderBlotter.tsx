import { useEffect, useMemo, useRef } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, ModuleRegistry, themeAlpine, type GridOptions } from 'ag-grid-community';
import type { OrderRow } from '../../../shared/protocol/order-row.ts';
import { setUi } from '../../state/uiStore.ts';
import { useConnectionStatus } from '../../stream/streamContext.ts';
import { columnDefs, type BlotterContext } from './columnDefs.ts';
import { useEditTracking } from './useEditTracking.ts';
import { useGridSink } from './useGridSink.ts';
import './OrderBlotter.css';

ModuleRegistry.registerModules([AllCommunityModule]);

// Bound to the app's CSS tokens, which switch with data-theme. Applied to both AG Grid modes
// (data-ag-theme-mode) so the grid's own dark defaults don't override them.
const themeParams = {
  backgroundColor: 'var(--surface)',
  foregroundColor: 'var(--text)',
  headerBackgroundColor: 'var(--surface-raised)',
  headerTextColor: 'var(--text-strong)',
  borderColor: 'var(--border)',
  accentColor: 'var(--accent)',
  fontFamily: 'var(--sans)',
  wrapperBorderRadius: 8,
  // Subtle: every order ticks about twice a second, so a strong flash would tint the whole grid
  valueChangeValueHighlightBackgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)',
};
const gridTheme = themeAlpine.withParams(themeParams).withParams(themeParams, 'dark');

export function OrderBlotter() {
  const { onGridReady, gridApiRef } = useGridSink();
  const { editContext, onCellEditingStopped } = useEditTracking(gridApiRef);
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
      context: { isLive: () => isLiveRef.current, ...editContext } satisfies BlotterContext,
      loading: true,
      rowBuffer: 25,
      asyncTransactionWaitMillis: 16,
      // Brief tick flash (defaults are 500ms + 1000ms fade)
      cellFlashDuration: 120,
      cellFadeDuration: 380,
      // Columns share the available width instead of overflowing into a horizontal scrollbar
      defaultColDef: { flex: 1, minWidth: 90 },
      rowSelection: { mode: 'singleRow', checkboxes: false, enableClickSelection: true },
      onSelectionChanged: (event) => {
        setUi({ selectedOrderId: event.api.getSelectedRows()[0]?.orderId ?? null });
      },
      onGridReady,
      onCellEditingStopped,
    }),
    [onGridReady, editContext, onCellEditingStopped],
  );

  return (
    // data-state drives the dimmed look when the data on screen isn't live
    <div className="blotter" data-state={status.state}>
      <AgGridReact theme={gridTheme} columnDefs={columnDefs} gridOptions={gridOptions} />
    </div>
  );
}
