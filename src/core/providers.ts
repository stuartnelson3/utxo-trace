// Provider interfaces. Defined here (core stays fetch-free) so the
// computation never depends on which concrete source is behind them;
// implementations live in src/providers/.
export interface TxSource {
  getTx(txid: string): Promise<EsploraTx>;
  label: string; // for provenance display
}

export interface PriceSource {
  getDailyUsd(snappedTs: number): Promise<number>;
  label: string;
}

// Only the fields the app actually reads (verified against api.ts/App.tsx,
// not assumed from the full Esplora spec) — deliberately narrow, so
// unrelated shape differences between mempool.space, Blockstream Esplora,
// and a self-hosted esplora/electrs don't break parsing.
export interface EsploraTx {
  txid: string;
  status: { block_time: number };
  vin: Array<{ txid?: string; vout?: number }>;
  vout: Array<{ value: number; scriptpubkey_address?: string }>;
}
