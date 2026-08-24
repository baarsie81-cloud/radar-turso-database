import { handleEarlyCron } from "../../../../src/early/cronEarly";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleEarlyCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleEarlyCron(request);
}
