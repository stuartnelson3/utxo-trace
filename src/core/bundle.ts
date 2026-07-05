import { z } from 'zod';
import { EsploraTxSchema } from './esplora';

// Parsed rows only — never raw CSVs. Timestamps are ISO strings (JSON has
// no Date type); application code converts at the boundary.
const SerializedLedgerEntrySchema = z.object({
  txid: z.string(),
  refid: z.string(),
  time: z.iso.datetime(),
  type: z.string(),
  amountSats: z.number().int(),
  feeSats: z.number().int(),
});

const SerializedTradeEntrySchema = z.object({
  txid: z.string(),
  pair: z.string(),
  price: z.number().finite(),
});

const SerializedSwanLotSchema = z.object({
  date: z.iso.datetime(),
  btcSats: z.number().int(),
  priceUsd: z.number().finite(),
  source: z.enum(['trades', 'transfers']),
});

const SerializedSwanWithdrawalSchema = z.object({
  txid: z.string(),
  btcSats: z.number().int(),
  date: z.iso.datetime(),
});

const OverrideRecordSchema = z.object({
  nodeId: z.string(),
  txid: z.string(),
  vout: z.number().int().nonnegative(),
  priceUsd: z.number().finite(),
  previousPriceUsd: z.number().finite().nullable(),
  previousSource: z.string(),
  memo: z.string().min(1),
  assertedAt: z.number().int(),
});

const PruneRecordSchema = z.object({
  nodeId: z.string(),
  txid: z.string(),
  vout: z.number().int().nonnegative(),
  amountSats: z.number().int(),
  reason: z.string().min(1),
  prunedAt: z.number().int(),
});

const SettingsSchema = z.object({
  txSourceMode: z.enum(['mempool', 'custom']),
  customEsploraUrl: z.string(),
  priceCrossCheck: z.boolean(),
});

// Deviates from the plan's literal single `ledger` field: this app supports
// two exchanges with genuinely different data shapes (Kraken's FIFO ledger
// vs. Swan's lots+withdrawals), so both are captured — a bundle from a
// Swan-only session would otherwise be unreproducible.
export const EvidenceBundleSchema = z.object({
  schemaVersion: z.literal(1),
  app: z.object({ version: z.string(), commit: z.string() }),
  createdAt: z.iso.datetime(),
  inputs: z.object({
    rootTxid: z.string().regex(/^[0-9a-f]{64}$/),
    selectedVout: z.number().int().nonnegative(),
    disposal: z
      .object({
        timestamp: z.number().int(),
        priceDisplay: z.number().finite().nullable(),
        currency: z.enum(['EUR', 'USD']),
      })
      .nullable(),
  }),
  krakenLedger: z.array(SerializedLedgerEntrySchema),
  // Needed alongside the ledger to re-derive attributions exactly (trades
  // supply the CSV-verified pricePer for lots the ledger alone can't price).
  krakenTrades: z.array(SerializedTradeEntrySchema),
  swanLots: z.array(SerializedSwanLotSchema),
  swanWithdrawals: z.array(SerializedSwanWithdrawalSchema),
  // Keyed `${sourceLabel}:${txid}` (matches api.ts's actual cache key, which
  // is source-qualified so switching sources can't serve stale data).
  txCache: z.record(z.string(), EsploraTxSchema),
  priceCache: z.array(z.object({ source: z.string(), day: z.string(), usd: z.number().finite() })),
  fxCache: z.array(z.object({ day: z.string(), usdToEur: z.number().finite() })),
  tree: z.object({ expandedIds: z.array(z.string()) }),
  matches: z.array(
    z.object({
      nodeId: z.string(),
      refid: z.string(),
      amountBasis: z.enum(['net', 'net-minus-fee', 'net-plus-fee']),
    })
  ),
  overrides: z.array(OverrideRecordSchema),
  prunedBranches: z.array(PruneRecordSchema),
  settings: SettingsSchema.optional(),
});

export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;

// Canonical JSON: recursively sorted object keys, no whitespace. Array order
// is preserved (order is meaningful — e.g. ledger rows). Relies on the
// schema's `.finite()` refinements to guarantee no NaN/Infinity reaches
// JSON.stringify (which would silently emit `null`, breaking the hash's
// claim to represent the actual numbers).
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Excludes createdAt so re-exporting an unchanged session yields the same
// hash regardless of when the export button happened to be clicked.
export async function hashBundle(bundle: EvidenceBundle): Promise<string> {
  const { createdAt: _createdAt, ...rest } = bundle;
  return sha256Hex(canonicalJson(rest));
}

const VersionOnlySchema = z.object({ schemaVersion: z.number() });

// v1 -> current is the identity migration (v1 is the only version that has
// ever existed). Future schema bumps add cases above this line; validation
// failures always surface the zod error path list, never a silent partial
// import.
export function migrate(raw: unknown): EvidenceBundle {
  const { schemaVersion } = VersionOnlySchema.parse(raw);
  if (schemaVersion === 1) {
    return EvidenceBundleSchema.parse(raw);
  }
  throw new Error(`unsupported evidence bundle schemaVersion: ${schemaVersion}`);
}
