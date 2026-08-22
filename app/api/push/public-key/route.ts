import { handlePushPublicKey } from "../../../../src/push/publicKeyRoute";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return handlePushPublicKey();
}
