import { runSolanaValidatedRadar } from "../../../../src/solanaValidated/run";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(){try{return Response.json({ok:true,...await runSolanaValidatedRadar()});}catch(error){return Response.json({ok:false,error:error instanceof Error?error.message:String(error)},{status:500});}}
