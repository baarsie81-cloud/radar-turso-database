import { handleSurvivorResearchCron } from "../../../../src/research/survivor/cronSurvivor";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleSurvivorResearchCron(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleSurvivorResearchCron(request);
}
