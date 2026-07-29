import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { database, closeDatabase } from "./database.js";

const migrationsDir = resolve(process.cwd(), "migrations");
const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();
const sql = database();

await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
for (const file of files) {
  const applied = await sql`select 1 from schema_migrations where name = ${file}`;
  if (applied.length) continue;
  await sql.begin(async (transaction) => {
    await transaction.file(resolve(migrationsDir, file));
    await transaction`insert into schema_migrations (name) values (${file})`;
  });
  console.log(`Aplicada ${file}`);
}
await closeDatabase();