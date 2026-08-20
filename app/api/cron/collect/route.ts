import { handleCollectCron } from "../../../../src/collector/cronCollect";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleCollectCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleCollectCron(request);
}
