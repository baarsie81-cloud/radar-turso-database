import type { VapidEnv } from "./webpush";

/**
 * Read only the VAPID public key for browser subscribe.
 * Never returns the private key.
 */
export function readVapidPublicKey(overrides?: VapidEnv): string | null {
  const key =
    (overrides?.VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY)?.trim()
    ?? "";
  return key.length > 0 ? key : null;
}
