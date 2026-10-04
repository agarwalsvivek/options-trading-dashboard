import { Root } from 'protobufjs/light';

const protoDefinition = {
  nested: {
    OptionOrder: {
      fields: {
        orderId: { type: 'string', id: 1 },
        underlying: { type: 'string', id: 2 },
        price: { type: 'double', id: 3 },
        quantity: { type: 'int64', id: 4 },
        delta: { type: 'double', id: 5 },
        timestamp: { type: 'uint64', id: 6 },
      },
    },
  },
};

const root = Root.fromJSON(protoDefinition);
const OptionOrder = root.lookupType('OptionOrder');

interface OrderRecord {
  orderId: string;
  underlying: string;
  price: number;
  quantity: number;
  delta: number;
}

type WorkerMessage =
  | { type: 'CONNECT_STREAM' }
  | {
      type: 'USER_MUTATION';
      payload: { orderId: string; field: keyof OrderRecord; value: string | number };
    };

let updateBatch: OrderRecord[] = [];
let streamInterval: ReturnType<typeof setInterval> | null = null;

// Mock tickers to generate live price oscillations
const tickers = ['AAPL', 'TSLA', 'NVDA', 'AMZN', 'MSFT'];
const orderBook: Record<string, OrderRecord> = {};

// Initialize 500 static placeholder orders to mutate
for (let i = 1; i <= 500; i++) {
  const id = `ORD-${String(i).padStart(4, '0')}`;
  orderBook[id] = {
    orderId: id,
    underlying: tickers[Math.floor(Math.random() * tickers.length)],
    price: Math.random() * 150 + 5,
    quantity: Math.floor(Math.random() * 50) * 10,
    delta: Math.random() * 2 - 1,
  };
}

// 60Hz UI Sync Loop
setInterval(() => {
  if (updateBatch.length > 0) {
    const conflatedMap = new Map<string, OrderRecord>();
    for (let i = 0; i < updateBatch.length; i++) {
      conflatedMap.set(updateBatch[i].orderId, updateBatch[i]);
    }
    self.postMessage({ type: 'TICK_BATCH', data: Array.from(conflatedMap.values()) });
    updateBatch = [];
  }
}, 16.67);

self.onmessage = function (event: MessageEvent<WorkerMessage>) {
  const { type } = event.data;

  if (type === 'CONNECT_STREAM') {
    if (streamInterval) return;

    // Simulate 1,000 updates/sec by generating ~17 updates every 1ms
    streamInterval = setInterval(() => {
      for (let k = 0; k < 17; k++) {
        const targetId = `ORD-${String(Math.floor(Math.random() * 500) + 1).padStart(4, '0')}`;
        const record = orderBook[targetId];

        // Slightly fluctuate price and quantity variables
        record.price += (Math.random() - 0.5) * 0.5;
        record.quantity = Math.max(10, record.quantity + (Math.floor(Math.random() * 3) - 1) * 10);
        record.delta = Math.max(-1, Math.min(1, record.delta + (Math.random() - 0.5) * 0.02));

        // Serialize data into binary Protobuf bytes to mimic a real connection
        const message = OptionOrder.create(record);
        const binaryBuffer = OptionOrder.encode(message).finish();

        // Decode the binary data instantly on the background thread
        const decoded = OptionOrder.decode(binaryBuffer) as unknown as OrderRecord;

        updateBatch.push({
          orderId: decoded.orderId,
          underlying: decoded.underlying,
          price: decoded.price,
          quantity: Number(decoded.quantity),
          delta: decoded.delta,
        });
      }
    }, 1);
  }

  if (event.data.type === 'USER_MUTATION') {
    const { payload } = event.data;
    // Intercept user modifications and commit them to the local source of truth
    const record = orderBook[payload.orderId];
    if (record) {
      Object.assign(record, { [payload.field]: payload.value });
      updateBatch.push({ ...record });
    }
  }
};
