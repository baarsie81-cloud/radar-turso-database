export type DiscoveredToken = {
  mint: string;
  symbol: string | null;
  name: string | null;
  firstSeenAt: number;
  price: number;
  marketCap?: number | null;
  liquidityUsd?: number | null;
  sourceEventId?: string | null;
};
