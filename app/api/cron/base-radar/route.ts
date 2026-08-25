import { handleBaseRadarCron } from "../../../../src/research/survivor/baseRadar";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleBaseRadarCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleBaseRadarCron(request);
}
