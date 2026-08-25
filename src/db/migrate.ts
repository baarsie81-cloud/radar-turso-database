import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Client } from "@libsql/client";
import { createTursoClient } from "./client";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../migrations",
);

export async function migrate(client: Client): Promise<string[]> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const appliedRows = await client.execute(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  const applied = new Set(appliedRows.rows.map((row) => String(row.version)));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  const ran: string[] = [];

  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) {
      continue;
    }

    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await client.executeMultiple(sql);
    await client.execute({
      sql: "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
      args: [version, Date.now()],
    });
    ran.push(version);
  }

  return ran;
}

async function runCli(): Promise<void> {
  const client = await createTursoClient();
  const ran = await migrate(client);
  if (ran.length === 0) {
    console.log("No pending migrations.");
  } else {
    console.log(`Applied migrations: ${ran.join(", ")}`);
  }
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(path.resolve(entryPath)).href) {
  runCli().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
