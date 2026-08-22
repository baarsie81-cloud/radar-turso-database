import type { Client } from "@libsql/client";
import { getPushSubscriptions } from "../db/repositories/push";
import {
  processPushDeliveries,
  type ProcessPushDeliveriesDeps,
} from "./deliver";
import type { PushDeliverySummary } from "./types";
import {
  createWebPushSender,
  type VapidEnv,
  type WebPushTransport,
} from "./webpush";

export type ProcessPushWithWebPushDeps = {
  client: Client;
  env?: VapidEnv;
  transport?: WebPushTransport;
  limit?: number;
  now?: () => number;
};

/**
 * Connect PASS delivery tracking to the real Web Push transport.
 * Called by the push cron when RADAR24_PUSH_ENABLED === "true".
 */
export async function processPushDeliveriesWithWebPush(
  deps: ProcessPushWithWebPushDeps,
): Promise<PushDeliverySummary> {
  const sendPush = createWebPushSender({
    getSubscriptions: () => getPushSubscriptions(deps.client),
    env: deps.env,
    transport: deps.transport,
  });

  const runDeps: ProcessPushDeliveriesDeps = {
    client: deps.client,
    sendPush,
    limit: deps.limit,
    now: deps.now,
  };

  return processPushDeliveries(runDeps);
}
