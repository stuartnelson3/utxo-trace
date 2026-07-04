export interface UTXONode {
  id: string; // txid:vout
  txid: string;
  vout: number;
  amountSats: number;
  timestamp: number;

  priceBtcUsd: number;     // USD price from mempool.space at block time
  usdToEur: number;        // ECB USD/EUR rate for that date
  manualPriceUsd?: number; // user override, always stored in USD
  isOverride: boolean;
  memo?: string;

  children: UTXONode[];
}
