import postgres, { type Sql } from "postgres";

let connection: Sql | undefined;
let fleetFileConnection: Sql | undefined;

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

// File reads have their own four-connection ceiling and server-side timeout.
// Neither the pool nor its statement_timeout changes normal application queries.
export function fleetFileDatabase(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL no está configurada.');
  fleetFileConnection ??= postgres(url, {
    max: 4,
    idle_timeout: 20,
    connect_timeout: 10,
    connection: { statement_timeout: 10_000 },
    transform: { undefined: null }
  });
  return fleetFileConnection;
}

export async function closeFleetFileDatabase(): Promise<void> {
  if (fleetFileConnection) {
    await fleetFileConnection.end({ timeout: 5 });
    fleetFileConnection = undefined;
  }
}

export async function closeDatabase(): Promise<void> {
  if (connection) {
    await connection.end({ timeout: 5 });
    connection = undefined;
  }
}
