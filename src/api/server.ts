import { serve } from "@hono/node-server";
import { createTursoClient } from "../db/client";
import { createApiApp } from "./app";

async function main(): Promise<void> {
  const client = await createTursoClient();
  const app = createApiApp(client);
  const port = Number(process.env.PORT) || 8787;

  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Radar 2.4 read API listening on ${info.port}`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
