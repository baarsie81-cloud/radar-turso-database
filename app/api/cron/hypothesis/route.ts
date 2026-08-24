import { handleHypothesisCron } from "../../../../src/hypothesis/cronHypothesis";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleHypothesisCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleHypothesisCron(request);
}
