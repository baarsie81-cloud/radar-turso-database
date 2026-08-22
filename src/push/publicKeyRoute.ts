import { readVapidPublicKey } from "./publicKey";
import type { VapidEnv } from "./webpush";

export type PublicKeyRouteDeps = {
  env?: Pick<VapidEnv, "VAPID_PUBLIC_KEY">;
};

/**
 * Expose VAPID public key only — never the private key.
 */
export async function handlePushPublicKey(
  deps: PublicKeyRouteDeps = {},
): Promise<Response> {
  const publicKey = readVapidPublicKey(deps.env);
  if (!publicKey) {
    return Response.json(
      { error: "VAPID public key is not configured" },
      { status: 503 },
    );
  }

  return Response.json({ publicKey });
}
