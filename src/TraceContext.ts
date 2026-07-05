import { createContext, useContext } from 'react';
import { APP_CONFIG, DisplayCurrency } from './config';
import { KrakenWithdrawalAttribution } from './core/kraken';
import { KrakenMatch } from './core/match';
import { SwanWithdrawalAttribution } from './core/swan';
import { OverrideRecord, PruneRecord } from './core/tree';

interface TraceContextValue {
  displayCurrency: DisplayCurrency;
  disposalTimestamp: number;
  disposalDate: string | null;
  disposalPriceDisplay: number | null; // in displayCurrency
  krakenAttributions: Map<string, KrakenWithdrawalAttribution>; // keyed by ledgerTxid
  // nodeId → confirmed match; populated once the user confirms a candidate
  krakenMatches: Map<string, KrakenMatch>;
  // refid -> ledgerTxid, to resolve a persisted match into krakenAttributions
  krakenRefidIndex: Map<string, string>;
  swanAttributions: Map<string, SwanWithdrawalAttribution>;
  overrideRecords: Map<string, OverrideRecord>; // nodeId -> record
  pruneRecords: Map<string, PruneRecord>; // nodeId -> record
  excludedSats: number; // total sats moved out by pruning
}

// This default is only reached if a component reads the context outside
// <TraceContext.Provider> (App.tsx always wraps rendering with the real
// value) — but it should still derive from the constant, not duplicate it,
// so it can't silently fall out of sync if the default currency changes.
export const TraceContext = createContext<TraceContextValue>({
  displayCurrency: APP_CONFIG.CURRENCY,
  disposalTimestamp: 0,
  disposalDate: null,
  disposalPriceDisplay: null,
  krakenAttributions: new Map(),
  krakenMatches: new Map(),
  krakenRefidIndex: new Map(),
  swanAttributions: new Map(),
  overrideRecords: new Map(),
  pruneRecords: new Map(),
  excludedSats: 0,
});

export const useTraceContext = () => useContext(TraceContext);
