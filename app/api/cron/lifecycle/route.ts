import { handleLifecycleCron } from "../../../../src/collector/cronLifecycle";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleLifecycleCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleLifecycleCron(request);
}
