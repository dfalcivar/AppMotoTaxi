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

const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
if (adminEmail && adminPassword) {
  await sql`
    update users
    set email = ${adminEmail},
        password_hash = crypt(${adminPassword}, gen_salt('bf')),
        updated_at = now()
    where role = 'ADMIN'
  `;
  console.log("Credenciales de administrador sincronizadas desde el entorno.");
}

const supportEmail = process.env.SUPPORT_EMAIL;
const supportPassword = process.env.SUPPORT_PASSWORD;
if (supportEmail && supportPassword) {
  await sql`
    update users
    set email = ${supportEmail},
        password_hash = crypt(${supportPassword}, gen_salt('bf')),
        updated_at = now()
    where role = 'SUPPORT'
  `;
  console.log("Credenciales de soporte sincronizadas desde el entorno.");
}

await closeDatabase();
