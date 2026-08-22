import { handlePushSubscribe } from "../../../../src/push/subscribeRoute";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handlePushSubscribe(request);
}
