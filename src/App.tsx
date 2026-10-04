/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ClientSideRowModelModule, ModuleRegistry, type ColDef } from 'ag-grid-community';

import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

ModuleRegistry.registerModules([ClientSideRowModelModule]);

export default function App() {
  const gridApiRef = useRef<any>(null);
  const workerRef = useRef<Worker | null>(null);

  const columnDefs = useMemo<ColDef[]>(
    () => [
      { field: 'orderId', pinned: 'left', width: 120 },
      { field: 'underlying', filter: true, width: 120 },
      {
        field: 'price',
        editable: true,
        valueFormatter: (p: any) => p.value?.toFixed(2) ?? '0.00',
        cellClassRules: { 'grid-numeric-flash': () => true },
      },
      {
        field: 'quantity',
        editable: true,
        valueFormatter: (p: any) => p.value?.toLocaleString() ?? '0',
      },
      {
        field: 'delta',
        valueFormatter: (p: any) => p.value?.toFixed(3) ?? '0.000',
      },
    ],
    [],
  );

  const gridOptions = useMemo(
    () => ({
      getRowId: (params: any) => params.data.orderId,
      rowBuffer: 25,
      asyncTransactionWaitMillis: 16,
      onGridReady: (params: any) => {
        gridApiRef.current = params.api;

        // Inject initial row layout skeleton structure
        const initialRows = [];
        for (let i = 1; i <= 500; i++) {
          initialRows.push({
            orderId: `ORD-${String(i).padStart(4, '0')}`,
            underlying: '---',
            price: 0,
            quantity: 0,
            delta: 0,
          });
        }
        params.api.applyTransaction({ add: initialRows });
      },
      onCellEditingStopped: (event: any) => {
        const { data, colDef, newValue } = event;
        workerRef.current?.postMessage({
          type: 'USER_MUTATION',
          payload: { orderId: data.orderId, field: colDef.field, value: Number(newValue) },
        });
      },
    }),
    [],
  );

  useEffect(() => {
    // Vite worker loading instantiation syntax
    workerRef.current = new Worker(new URL('./workers/order-stream.worker.ts', import.meta.url), {
      type: 'module',
    });

    workerRef.current.postMessage({ type: 'CONNECT_STREAM' });

    workerRef.current.onmessage = (event) => {
      const { type, data } = event.data;
      if (type === 'TICK_BATCH' && gridApiRef.current) {
        // Update row states asynchronously, bypassing React entirely
        gridApiRef.current.applyTransactionAsync({ update: data });
      }
    };

    return () => workerRef.current?.terminate();
  }, []);

  return (
    <div
      className="ag-theme-alpine-dark"
      style={{
        height: '100vh',
        width: '100vw',
        padding: '20px',
        boxSizing: 'border-box',
        background: '#1c1f24',
      }}
    >
      <h2 style={{ color: '#fff', margin: '0 0 15px 0', fontFamily: 'sans-serif' }}>
        Real-Time Options Flow (1,000 ops Data Engine Sim)
      </h2>
      <div style={{ height: 'calc(100% - 50px)', width: '100%' }}>
        <AgGridReact columnDefs={columnDefs} gridOptions={gridOptions} />
      </div>
    </div>
  );
}
