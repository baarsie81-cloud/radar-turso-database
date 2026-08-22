import { createTursoClient } from "../db/client";
import {
  parseBrowserPushSubscription,
  savePushSubscription,
} from "./subscription";

export type PushSubscribeDeps = {
  createClient?: typeof createTursoClient;
};

/**
 * Store a browser PushSubscription in Turso.
 * Does not send notifications.
 */
export async function handlePushSubscribe(
  request: Request,
  deps: PushSubscribeDeps = {},
): Promise<Response> {
  if (!deps.createClient && !process.env.TURSO_DATABASE_URL) {
    return Response.json(
      { error: "TURSO_DATABASE_URL is required" },
      { status: 500 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const parsed = parseBrowserPushSubscription(body);
  if (!parsed) {
    return Response.json({ error: "Invalid subscription" }, { status: 400 });
  }

  const userAgent = request.headers.get("user-agent");
  const createClient = deps.createClient ?? createTursoClient;
  const client = await createClient();
  try {
    const subscription = await savePushSubscription(client, {
      ...parsed,
      userAgent: parsed.userAgent ?? userAgent,
    });
    return Response.json({
      ok: true,
      endpoint: subscription.endpoint,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  } finally {
    client.close();
  }
}
