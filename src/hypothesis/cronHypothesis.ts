import { createTursoClient } from "../db/client";
import { getPushSubscriptions } from "../db/repositories/push";
import {
  createHypothesisObservationWebPushSender,
} from "./observationPush";
import { runHypothesisObservation } from "./run";

const DEFAULT_OWNER = "v24-cron-hypothesis";

function isAuthorized(request: Request, cronSecret: string | undefined): boolean {
  if (!cronSecret || cronSecret.length === 0) return false;
  return request.headers.get("authorization") === `Bearer ${cronSecret}`;
}

export async function handleHypothesisCron(request: Request): Promise<Response> {
  if (!isAuthorized(request, process.env.CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.TURSO_DATABASE_URL) {
    return Response.json(
      { enabled: true, error: "TURSO_DATABASE_URL is required" },
      { status: 500 },
    );
  }

  const env = {
    RADAR24_HYPOTHESIS_ENABLED:
      process.env.RADAR24_HYPOTHESIS_ENABLED ?? "true",
    RADAR24_HYPOTHESIS_OBSERVATION_PUSH:
      process.env.RADAR24_HYPOTHESIS_OBSERVATION_PUSH ?? "true",
  };

  const client = await createTursoClient();
  try {
    const sendObservationPush = createHypothesisObservationWebPushSender({
      getSubscriptions: () => getPushSubscriptions(client),
      env: {
        VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
        VAPID_SUBJECT: process.env.VAPID_SUBJECT,
      },
    });

    const summary = await runHypothesisObservation({
      client,
      owner: DEFAULT_OWNER,
      env,
      sendObservationPush,
    });

    console.info("[hypothesis] cron finished", summary);
    return Response.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[hypothesis] cron failed", { message });
    return Response.json({ enabled: true, error: message }, { status: 500 });
  } finally {
    client.close();
  }
}
