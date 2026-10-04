import { OrderBlotter } from '../features/blotter/OrderBlotter.tsx';
import { StreamProvider } from '../stream/StreamProvider.tsx';
import { StatusBar } from '../ui/StatusBar.tsx';
import { Toasts } from '../ui/Toasts.tsx';
import './App.css';

export default function App() {
  return (
    <StreamProvider>
      <div className="app">
        <h2 className="app-title">Real-Time Options Flow (1,000 ops Data Engine Sim)</h2>
        <div className="app-blotter">
          <OrderBlotter />
        </div>
        <StatusBar />
      </div>
      <Toasts />
    </StreamProvider>
  );
}
