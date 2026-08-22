import type { Client } from "@libsql/client";
import { listUndeliveredPassPlus10Decisions } from "../db/repositories/push";
import type { PushCandidate } from "./types";

/**
 * Select undelivered PASS @ PLUS_10 @ radar 2.4 decisions for push.
 * Reject / other stages / other versions / already-delivered rows are excluded.
 */
export async function selectPassPushCandidates(
  client: Client,
  limit = 50,
): Promise<PushCandidate[]> {
  return listUndeliveredPassPlus10Decisions(client, limit);
}
