import { handleBaseRadarTestCron } from "../../../../src/research/survivor/baseRadar";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleBaseRadarTestCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleBaseRadarTestCron(request);
}
