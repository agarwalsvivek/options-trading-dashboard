import { OrderBlotter } from '../features/blotter/OrderBlotter.tsx';
import './App.css';

export default function App() {
  return (
    <div className="app">
      <h2 className="app-title">Real-Time Options Flow (1,000 ops Data Engine Sim)</h2>
      <div className="app-blotter">
        <OrderBlotter />
      </div>
    </div>
  );
}
