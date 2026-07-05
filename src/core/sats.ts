export class ParseError extends Error {
  constructor(
    message: string,
    public readonly input: string
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

const DECIMAL_BTC = /^(-)?(\d+)(?:\.(\d+))?$/;

// Exact decimal-string -> integer sats. No floating-point math: the decimal
// digits are parsed directly into a BigInt before converting to a JS number,
// so there's no intermediate binary-float rounding at all.
export function parseBtcToSats(s: string): number {
  const trimmed = s.trim();
  const match = DECIMAL_BTC.exec(trimmed);
  if (!match) {
    throw new ParseError(`not a valid decimal BTC amount: ${JSON.stringify(s)}`, s);
  }
  const [, negSign, intPart, fracPart = ''] = match;
  // Round to the nearest satoshi rather than rejecting excess decimal
  // digits: real exchange ledgers legitimately carry more precision than a
  // satoshi actually has (Kraken's ledger does this for trade fills, which
  // settle against its internal balance accounting before ever touching
  // the chain — e.g. "0.0054436263" is a real row, not garbage padding).
  // A difference of a fraction of a sat has no material effect on cost
  // basis, so rounding is the correct, robust behavior here, not rejection.
  let magnitude: bigint;
  if (fracPart.length <= 8) {
    const fracPadded = fracPart.padEnd(8, '0');
    magnitude = BigInt(intPart) * 10n ** 8n + BigInt(fracPadded || '0');
  } else {
    const kept = fracPart.slice(0, 8);
    const roundUp = fracPart[8] >= '5';
    magnitude = BigInt(intPart) * 10n ** 8n + BigInt(kept) + (roundUp ? 1n : 0n);
  }
  const signed = negSign ? -magnitude : magnitude;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ParseError(`amount exceeds the safe integer range: ${JSON.stringify(s)}`, s);
  }
  return Number(signed);
}

// Sats -> exact decimal BTC string, always padded to 8 decimal places
// (matches the app's existing display convention of toFixed(8)).
export function formatSats(n: number): string {
  assertSats(n);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const intPart = Math.floor(abs / 1e8);
  const fracPart = String(abs % 1e8).padStart(8, '0');
  return `${sign}${intPart}.${fracPart}`;
}

// Guardrail for core boundaries: sats are always a safe integer. Throws
// rather than silently truncating a value that has drifted into float land.
export function assertSats(n: number): void {
  if (!Number.isSafeInteger(n)) {
    throw new Error(`not a safe-integer sats value: ${n}`);
  }
}
