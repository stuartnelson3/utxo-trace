// Single source of truth for every rule that affects a number in the
// report. This is BOTH configuration (price.ts and match.ts import their
// numeric constants from here) and documentation (the report renders this
// object as prose) — so the two cannot drift apart. See the "no drift"
// test in methodology.test.ts.
export const METHODOLOGY = {
  version: 1,
  priceOracle: {
    source: 'mempool.space /api/v1/historical-price (USD, daily)',
    snapRule: 'timestamps floored to 16:00 UTC of the price day',
    snapAnchorUtcHour: 16,
  },
  fx: {
    source: 'ECB reference rate via api.frankfurter.dev (daily fixing)',
    rule: 'USD->EUR at the ECB rate of the price day; cached per day',
  },
  attribution: {
    rule:
      'FIFO: exchange acquisitions consumed oldest-first per exchange ledger ' +
      '(BMF-Schreiben v. 10.05.2022, Rz. 61)',
    scope: 'per exchange account',
  },
  matching: {
    amountToleranceSats: 2,
    timeWindowBeforeMs: 72 * 3600 * 1000,
    timeWindowAfterMs: 1 * 3600 * 1000,
    feeBases: ['net', 'net-minus-fee', 'net-plus-fee'] as const,
    rule:
      'on-chain outputs matched to ledger withdrawals by amount (three fee ' +
      'interpretations) within tolerance and time window; ambiguities resolved ' +
      'manually by the user and recorded',
  },
  holdingPeriod: {
    rule_us:
      '26 U.S.C. §1222: held more than one year -> long-term. Holding period ' +
      'begins the day after acquisition, so the first long-term disposal date ' +
      'is one year and one day after acquisition. FIFO is the IRS default ' +
      'basis method (Treas. Reg. §1.1012-1) absent a contemporaneous ' +
      'specific-identification election; basis tracked wallet-by-wallet ' +
      'consistent with Rev. Proc. 2024-28.',
    rule_de:
      '§23 Abs. 1 Nr. 2 EStG: Veräußerung nach mehr als einem Jahr seit ' +
      'Anschaffung ist nicht steuerbar. Fristbeginn am Tag nach der ' +
      'Anschaffung (§187 Abs. 1 BGB analog); Fristende mit Ablauf des Tages, ' +
      'der dem Anschaffungstag im Folgejahr entspricht (§188 Abs. 2 BGB ' +
      'analog) — Anschaffung 10.05.2023 -> steuerfrei ab Veräußerung am ' +
      '11.05.2024.',
  },
  provenanceTiers: {
    'trades-csv': 'price verified against user-supplied exchange records',
    mempool: 'price estimated from public daily price history',
    mixed: 'aggregate of both tiers',
    override: 'price manually asserted by the user (see Manual price assertions table)',
  },
  // What this report actually is: FIFO on the exchange side (the exchange
  // ledger doesn't preserve which specific coin funded which withdrawal),
  // specific-evidence attribution on the chain side (the user proves which
  // UTXO descends from which withdrawal by tracing the transaction graph).
  // Neither "all FIFO" nor "all specific identification" is honest; these
  // labels say exactly what's true, per display currency.
  labels: {
    en_usd:
      'FIFO lot attribution — the IRS default basis method (Treas. Reg. ' +
      '§1.1012-1) absent a contemporaneous specific-identification election; ' +
      'on-chain attribution by specific evidence. Note: this report documents ' +
      'FIFO results; it is not itself a specific-ID election, which must be ' +
      'made at or before the time of sale.',
    en_eur:
      'FIFO consumption per exchange account (German BMF guidance); ' +
      'on-chain attribution by specific evidence',
    de:
      'FIFO-Verbrauchsfolge je Börsenkonto (BMF-Schreiben v. 10.05.2022, ' +
      'Rz. 61); Zuordnung on-chain per Einzelnachweis',
  },
} as const;
