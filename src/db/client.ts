import { createClient, type Client, type Config } from "@libsql/client";

export type TursoClientConfig = {
  url?: string;
  authToken?: string;
};

export async function createTursoClient(
  config: TursoClientConfig = {},
): Promise<Client> {
  const url = config.url ?? process.env.TURSO_DATABASE_URL;
  const authToken = config.authToken ?? process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error("TURSO_DATABASE_URL is required");
  }

  const clientConfig: Config = { url };
  if (authToken) {
    clientConfig.authToken = authToken;
  }

  const client = createClient(clientConfig);
  await client.execute("PRAGMA foreign_keys = ON");
  return client;
}
