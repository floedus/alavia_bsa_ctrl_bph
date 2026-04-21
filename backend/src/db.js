import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;
const password = process.env.PGPASSWORD;

export const pool = new Pool({
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "postgres",
  password: typeof password === "string" ? password : undefined,
  database: process.env.PGDATABASE ?? "alavia_bsa_ctrl_bph"
});

export async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result.rows;
}
