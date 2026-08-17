export function num(value: unknown): number {
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`Expected number, got ${String(value)}`);
}

export function numOrNull(value: unknown): number | null {
  if (value == null) {
    return null;
  }
  return num(value);
}

export function str(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`Expected string, got ${String(value)}`);
}

export function strOrNull(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  return str(value);
}

export function bool01(value: unknown): boolean {
  return num(value) === 1;
}

export function bool01OrNull(value: unknown): boolean | null {
  if (value == null) {
    return null;
  }
  return bool01(value);
}

export function to01(value: boolean | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  return value ? 1 : 0;
}
