import postgres, { type Sql } from "postgres";

let connection: Sql | undefined;

export function database(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL no está configurada.");
  }
  connection ??= postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    transform: { undefined: null }
  });
  return connection;
}

export async function closeDatabase(): Promise<void> {
  if (connection) {
    await connection.end({ timeout: 5 });
    connection = undefined;
  }
}
