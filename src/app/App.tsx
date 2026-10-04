import { OrderBlotter } from '../features/blotter/OrderBlotter.tsx';
import { useThemeSync } from '../state/theme.ts';
import { StreamProvider } from '../stream/StreamProvider.tsx';
import { Panel } from '../ui/Panel.tsx';
import { StatusBar } from '../ui/StatusBar.tsx';
import { ThemeToggle } from '../ui/ThemeToggle.tsx';
import { Toasts } from '../ui/Toasts.tsx';
import './App.css';

export default function App() {
  useThemeSync();

  return (
    <StreamProvider>
      <div className="app">
        <header className="app-header">
          <h1 className="app-title">Options Flow</h1>
          <div className="app-header-actions">
            <ThemeToggle />
          </div>
        </header>
        <main className="app-blotter">
          <OrderBlotter />
        </main>
        <aside className="app-sidebar">
          <Panel title="Greeks summary">
            <p className="panel-empty">Coming in 5b</p>
          </Panel>
          <Panel title="Order ticket">
            <p className="panel-empty">Coming in 5c</p>
          </Panel>
        </aside>
        <div className="app-status">
          <StatusBar />
        </div>
      </div>
      <Toasts />
    </StreamProvider>
  );
}
