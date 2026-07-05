import { z } from 'zod';
import { EsploraTx } from './providers';

// Validates only the fields the app reads (see providers.ts) so unrelated
// shape differences between mempool.space, Blockstream Esplora, and a
// self-hosted esplora/electrs don't break parsing.
export const EsploraTxSchema = z.object({
  txid: z.string(),
  status: z.object({ block_time: z.number() }),
  vin: z.array(
    z.object({
      txid: z.string().optional(),
      vout: z.number().optional(),
    })
  ),
  vout: z.array(
    z.object({
      value: z.number(),
      scriptpubkey_address: z.string().optional(),
    })
  ),
}) satisfies z.ZodType<EsploraTx>;

export function parseEsploraTx(data: unknown): EsploraTx {
  return EsploraTxSchema.parse(data);
}
