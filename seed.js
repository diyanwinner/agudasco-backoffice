import bcrypt from "bcrypt";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Render bisa set DATA_DIR=/var/data, lokal default ke folder proyek
const DATA_DIR = process.env.DATA_DIR || __dirname;

const email = process.env.ADMIN_EMAIL || "admin@agudasco.org";
const password = process.env.ADMIN_PASSWORD || "admin123";
const name = process.env.ADMIN_NAME || "Admin AGUDASCO";

const db = await open({
  filename: path.join(DATA_DIR, "data.sqlite"),
  driver: sqlite3.Database
});

// pastikan tabel users ada (aman kalau sudah ada)
await db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'ADMIN'
  );
`);

const existing = await db.get("SELECT * FROM users WHERE email = ?", email);
if (!existing) {
  const hash = await bcrypt.hash(password, 10);
  await db.run(
    "INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)",
    name, email, hash, "ADMIN"
  );
  console.log(`✅ Seeded admin: ${email} / ${password}`);
} else {
  console.log(`ℹ️ Admin already exists: ${email}`);
}

await db.close();
