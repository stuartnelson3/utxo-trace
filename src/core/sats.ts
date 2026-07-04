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
  if (fracPart.length > 8) {
    throw new ParseError(`more than 8 decimal places: ${JSON.stringify(s)}`, s);
  }
  const fracPadded = fracPart.padEnd(8, '0');
  const magnitude = BigInt(intPart) * 10n ** 8n + BigInt(fracPadded || '0');
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
