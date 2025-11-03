// server.js
import express from "express";
import path from "path";
// import fs from "fs"; // (tidak dipakai)
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import pkg from "pg";
const { Pool } = pkg;

/* ------------------------------------------------------------
   PATH / APP SETUP
------------------------------------------------------------ */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.set("trust proxy", true); // Render/Reverse proxy friendly

/* ------------------------------------------------------------
   DATABASE (Postgres / Neon)
------------------------------------------------------------ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// query helpers
const q  = async (sql, params = []) => (await pool.query(sql, params)).rows;
const q1 = async (sql, params = []) => (await pool.query(sql, params)).rows[0] || null;

// ensure tables
async function ensureTables() {
  await pool.query(`
    -- Articles
    CREATE TABLE IF NOT EXISTS articles (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles (created_at DESC);

    -- Banners
    CREATE TABLE IF NOT EXISTS banners (
      id BIGSERIAL PRIMARY KEY,
      image TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Settings (legacy key-value)
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Reports
    CREATE TABLE IF NOT EXISTS reports (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      cover TEXT,
      pdf_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- AD/ART
    CREATE TABLE IF NOT EXISTS adarts (
      id BIGSERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      cover TEXT,
      pdf_url TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Members
    CREATE TABLE IF NOT EXISTS members (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT,
      bio TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_members_name ON members (name);

    -- Member Families
    CREATE TABLE IF NOT EXISTS member_families (
      id BIGSERIAL PRIMARY KEY,
      member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      fullname TEXT NOT NULL,
      relation TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Member Photos
    CREATE TABLE IF NOT EXISTS member_photos (
      id BIGSERIAL PRIMARY KEY,
      member_id BIGINT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      image_url TEXT NOT NULL,
      caption TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Legacy single-row (dibiarkan untuk kompatibilitas)
    CREATE TABLE IF NOT EXISTS site_info (
      id INT PRIMARY KEY DEFAULT 1,
      org_name   TEXT,
      email      TEXT,
      phone      TEXT,
      whatsapp   TEXT,
      address    TEXT,
      maps_url   TEXT,
      instagram  TEXT,
      facebook   TEXT,
      x_handle   TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO site_info (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

    -- New canonical table for contact (dipakai publik/admin)
    CREATE TABLE IF NOT EXISTS site_contact (
      id INT PRIMARY KEY DEFAULT 1,
      org_name   TEXT,
      email      TEXT,
      phone      TEXT,
      whatsapp   TEXT,
      address    TEXT,
      maps_url   TEXT,
      instagram  TEXT,
      facebook   TEXT,
      x_handle   TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO site_contact (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  `);

  // Migrasi ringan: copy dari site_info -> site_contact bila contact kosong
  await pool.query(`
    DO $$
    DECLARE
      has_contact boolean;
      si record;
    BEGIN
      SELECT EXISTS(SELECT 1 FROM site_contact WHERE id=1
                    AND (org_name IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL
                         OR whatsapp IS NOT NULL OR address IS NOT NULL OR maps_url IS NOT NULL
                         OR instagram IS NOT NULL OR facebook IS NOT NULL OR x_handle IS NOT NULL))
      INTO has_contact;

      IF NOT has_contact THEN
        SELECT * INTO si FROM site_info WHERE id=1;
        IF FOUND THEN
          UPDATE site_contact SET
            org_name  = COALESCE(si.org_name,  site_contact.org_name),
            email     = COALESCE(si.email,     site_contact.email),
            phone     = COALESCE(si.phone,     site_contact.phone),
            whatsapp  = COALESCE(si.whatsapp,  site_contact.whatsapp),
            address   = COALESCE(si.address,   site_contact.address),
            maps_url  = COALESCE(si.maps_url,  site_contact.maps_url),
            instagram = COALESCE(si.instagram, site_contact.instagram),
            facebook  = COALESCE(si.facebook,  site_contact.facebook),
            x_handle  = COALESCE(si.x_handle,  site_contact.x_handle),
            updated_at = now()
          WHERE id = 1;
        END IF;
      END IF;
    END $$;
  `);
}
ensureTables().catch(err => console.error("ensureTables error:", err));

/* ------------------------------------------------------------
   CLOUDINARY + MULTER (image only)
------------------------------------------------------------ */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
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

// Non-static responses: jangan di-cache
app.use((req, res, next) => {
  if (!req.path.startsWith("/public")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});

/* ------------------------------------------------------------
   APP MIDDLEWARE & VIEW ENGINE
------------------------------------------------------------ */
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(express.json({ limit: "5mb" }));

// static assets (cache; cache-busting via buildId)
app.use(
  "/public",
  express.static(path.join(__dirname, "public"), {
    maxAge: "7d",
    immutable: true,
  })
);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// globals
app.locals.buildId    = process.env.RAILWAY_GIT_COMMIT_SHA || Date.now().toString();
app.locals.CLOUD_BASE = process.env.CLOUDINARY_CLOUD_NAME
  ? `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}`
  : "";

// per-request locals
app.use((req, res, next) => {
  res.locals.buildId   = app.locals.buildId;
  res.locals.active    = "";          // nav highlight (set di routes)
  res.locals.title     = "AGUDASCO";  // default title
  res.locals.CLOUD_BASE = app.locals.CLOUD_BASE;
  next();
});

// CSP yang ramah CDN/image (Cloudinary dll)
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self' https:",
      "img-src 'self' https: data:",
      "script-src 'self' 'unsafe-inline' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "object-src 'none'",
    ].join("; ")
  );
  next();
});

// ---- Footer contact loader (NO CACHE) ----
// ganti query footer biar sama dengan halaman /kontak
app.use(async (_req, res, next) => {
  try {
    res.locals.footerContact = await q1("SELECT * FROM site_info WHERE id=1") || {};
  } catch (e) {
    console.error("footerContact load err:", e?.message);
    res.locals.footerContact = {};
  }
  next();
});

/* ------------------------------------------------------------
   BASIC AUTH UNTUK /admin/*
------------------------------------------------------------ */
function adminAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    if (!header.startsWith("Basic ")) throw new Error("no basic");

    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);

    const ok =
      user === (process.env.ADMIN_USERNAME || "") &&
      pass === (process.env.ADMIN_PASSWORD || "");

    if (!ok) throw new Error("bad cred");
    return next();
  } catch {
    res.set("WWW-Authenticate", 'Basic realm="Admin Area"');
    return res.status(401).send("Unauthorized");
  }
}

/* ------------------------------------------------------------
   ROUTES (pisah: public & admin)
------------------------------------------------------------ */
import publicRoutes from "./routes/public.js";
import adminRoutes  from "./routes/admin.js";

// healthcheck
app.get("/health", (_req, res) => res.status(200).send("OK"));

app.use("/",      publicRoutes(q, q1));
app.use("/admin", adminAuth, adminRoutes(q, q1, uploadImage, pool));

/* ------------------------------------------------------------
   ERROR HANDLERS
------------------------------------------------------------ */
app.use((req, res) => res.status(404).send("Not Found"));
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).send(err?.message || "Server Error");
});

/* ------------------------------------------------------------
   START SERVER
------------------------------------------------------------ */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
