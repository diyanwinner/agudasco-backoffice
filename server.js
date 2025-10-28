// server.js
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import pkg from "pg";
const { Pool } = pkg;

/* ------------------------------------------------------------
   SETUP DASAR
------------------------------------------------------------ */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

/* ------------------------------------------------------------
   DATABASE (Postgres / Neon)
------------------------------------------------------------ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
const q1 = async (sql, params = []) => (await pool.query(sql, params)).rows[0] || null;

/* Buat tabel kalau belum ada */
async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles (created_at DESC);

    CREATE TABLE IF NOT EXISTS banners (
      id BIGSERIAL PRIMARY KEY,
      image TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS reports (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      cover TEXT,
      pdf_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS adarts (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      cover TEXT,
      pdf_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS members (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      bio TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS member_families (
      id BIGSERIAL PRIMARY KEY,
      member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      fullname TEXT NOT NULL,
      relation TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS member_photos (
      id BIGSERIAL PRIMARY KEY,
      member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      caption TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
ensureTables().catch(e => console.error("ensureTables error:", e));

/* ------------------------------------------------------------
   CLOUDINARY + MULTER
------------------------------------------------------------ */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "agudasco/images",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ quality: "auto", fetch_format: "auto" }],
  },
});
const uploadImage = multer({ storage: imageStorage });

/* ------------------------------------------------------------
   APP CONFIG & MIDDLEWARE
------------------------------------------------------------ */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

app.locals.buildId = process.env.RAILWAY_GIT_COMMIT_SHA || Date.now().toString();

app.use((req, res, next) => {
  res.locals.buildId = app.locals.buildId;
  res.locals.active = "";
  res.locals.title = "AGUDASCO";
  next();
});

app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' https:; img-src 'self' https: data:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; object-src 'none'"
  );
  next();
});

/* ------------------------------------------------------------
   BASIC AUTH UNTUK ADMIN
------------------------------------------------------------ */
function adminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Admin Area"');
    return res.status(401).send("Authentication required");
  }
  try {
    const decoded = Buffer.from(header.split(" ")[1], "base64").toString("utf8");
    const [user, pass] = decoded.split(":");
    if (
      user === (process.env.ADMIN_USERNAME || "") &&
      pass === (process.env.ADMIN_PASSWORD || "")
    ) return next();
  } catch {}
  res.set("WWW-Authenticate", 'Basic realm="Admin Area"');
  return res.status(401).send("Unauthorized");
}

/* ------------------------------------------------------------
   IMPORT ROUTES
------------------------------------------------------------ */
import publicRoutes from "./routes/public.js";
import adminRoutes from "./routes/admin.js";

app.use("/", publicRoutes(q, q1));
app.use("/admin", adminAuth, adminRoutes(q, q1, uploadImage, pool));

/* ------------------------------------------------------------
   ERROR HANDLER
------------------------------------------------------------ */
app.use((req, res) => res.status(404).send("Not Found"));
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).send(err?.message || "Server Error");
});

/* ------------------------------------------------------------
   START SERVER
------------------------------------------------------------ */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
