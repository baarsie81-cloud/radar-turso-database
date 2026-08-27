import { runMicrocapRadar } from "../../../../src/microcap/run";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(request:Request){const u=new URL(request.url);if(u.searchParams.get("key")!=="microcap-smoke-827b")return Response.json({ok:false},{status:401});try{return Response.json({ok:true,...await runMicrocapRadar()});}catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:String(e)},{status:500});}}
