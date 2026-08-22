import { handlePushCron } from "../../../../src/push/cronPush";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handlePushCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return handlePushCron(request);
}
