import { createContext, useContext } from 'react';
import { DisplayCurrency } from './config';
import { KrakenWithdrawalAttribution } from './core/kraken';
import { SwanWithdrawalAttribution } from './core/swan';

interface TraceContextValue {
  displayCurrency: DisplayCurrency;
  disposalTimestamp: number;
  disposalDate: string | null;
  disposalPriceDisplay: number | null; // in displayCurrency
  krakenAttributions: Map<string, KrakenWithdrawalAttribution>;
  // nodeId → withdrawal ledger txid; populated when user clicks [match kraken]
  krakenMatches: Map<string, string>;
  swanAttributions: Map<string, SwanWithdrawalAttribution>;
}

export const TraceContext = createContext<TraceContextValue>({
  displayCurrency: 'EUR',
  disposalTimestamp: 0,
  disposalDate: null,
  disposalPriceDisplay: null,
  krakenAttributions: new Map(),
  krakenMatches: new Map(),
  swanAttributions: new Map(),
});

export const useTraceContext = () => useContext(TraceContext);
