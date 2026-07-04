import { createContext, useContext } from 'react';
import { DisplayCurrency } from './config';
import { KrakenWithdrawalAttribution } from './core/kraken';
import { KrakenMatch } from './core/match';
import { SwanWithdrawalAttribution } from './core/swan';

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
}

export const TraceContext = createContext<TraceContextValue>({
  displayCurrency: 'EUR',
  disposalTimestamp: 0,
  disposalDate: null,
  disposalPriceDisplay: null,
  krakenAttributions: new Map(),
  krakenMatches: new Map(),
  krakenRefidIndex: new Map(),
  swanAttributions: new Map(),
});

export const useTraceContext = () => useContext(TraceContext);
