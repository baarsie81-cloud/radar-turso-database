export type MarketSnapshotInput = {
  price: number;
  capturedAt: number;
  marketCap?: number | null;
  liquidityUsd?: number | null;
};
