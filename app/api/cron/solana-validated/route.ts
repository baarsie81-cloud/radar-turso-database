import { handleSolanaValidatedCron } from "../../../../src/solanaValidated/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSolanaValidatedCron(request);
}
