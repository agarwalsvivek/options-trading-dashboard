// Plain row shape rendered by the blotter grid.
export interface OrderRow {
  orderId: string;
  underlying: string;
  price: number;
  quantity: number;
  delta: number;
}
