"use client";

import Link from "next/link";
import { useState } from "react";

export type SolanaRadarRow = {
  id:number;
  symbol:string|null;
  mint:string;
  firstSeenAt:number;
  entryLiquidityUsd:number;
  plus5RoiPct:number|null;
  plus10RoiPct:number|null;
  momentum:number|null;
  executionStatus:string|null;
  roundTripLossPct:number|null;
  decision:string|null;
  rejectReason:string|null;
};

function pct(v:number|null){return v==null?"—":`${v>=0?"+":""}${v.toFixed(1)}%`;}

export function SolanaRadarTable({rows}:{rows:SolanaRadarRow[]}){
  const [copied,setCopied]=useState<number|null>(null);
  async function copy(id:number,mint:string){await navigator.clipboard.writeText(mint);setCopied(id);setTimeout(()=>setCopied(x=>x===id?null:x),1200);}
  return <div style={{overflowX:"auto"}}><table style={{borderCollapse:"collapse",width:"100%",fontSize:"0.9rem"}}>
    <thead><tr>{["Coin","Mint","Seen","Entry liq","+5","+10","Momentum","Jupiter","RT loss","Decision"].map(h=><th key={h} style={{textAlign:"left",padding:"0.55rem",borderBottom:"1px solid #ddd"}}>{h}</th>)}</tr></thead>
    <tbody>{rows.map(r=><tr key={r.id}>
      <td style={{padding:"0.55rem",borderBottom:"1px solid #eee"}}><Link href={`/solana-cases/${r.id}`} style={{color:"#111",fontWeight:600,textDecoration:"underline"}}>{r.symbol??r.mint.slice(0,8)}</Link></td>
      <td style={{padding:"0.55rem",borderBottom:"1px solid #eee"}}><button onClick={()=>copy(r.id,r.mint)} style={{cursor:"pointer"}}>{copied===r.id?"Copied":"Copy"}</button></td>
      <td style={{padding:"0.55rem",borderBottom:"1px solid #eee"}}>{new Date(r.firstSeenAt).toLocaleString()}</td>
      <td style={{padding:"0.55rem",borderBottom:"1px solid #eee"}}>${Math.round(r.entryLiquidityUsd).toLocaleString()}</td>
      <td style={{padding:"0.55rem",borderBottom:"1px solid #eee"}}>{pct(r.plus5RoiPct)}</td>
      <td style={{padding:"0.55rem",borderBottom:"1px solid #eee"}}>{pct(r.plus10RoiPct)}</td>
      <td style={{padding:"0.55rem",borderBottom:"1px solid #eee"}}>{pct(r.momentum)}</td>
      <td style={{padding:"0.55rem",borderBottom:"1px solid #eee"}}>{r.executionStatus??"—"}</td>
      <td style={{padding:"0.55rem",borderBottom:"1px solid #eee"}}>{r.roundTripLossPct==null?"—":`${r.roundTripLossPct.toFixed(2)}%`}</td>
      <td style={{padding:"0.55rem",borderBottom:"1px solid #eee"}} title={r.rejectReason??undefined}>{r.decision??"PENDING"}</td>
    </tr>)}</tbody>
  </table></div>;
}
