// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import pkg from "pg";
const { Pool } = pkg;

// Tangkap error global biar yang di-print cuma pesannya
process.on("uncaughtException", (err) => {
  console.error("Uncaught:", err?.message || String(err));
});
process.on("unhandledRejection", (reason) => {
  const msg = (reason && reason.message) ? reason.message : String(reason);
  console.error("UnhandledRejection:", msg);
});

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

// alias lebih singkat untuk dokumen (PDF, dsb)
app.use(
  "/docs",
  express.static(path.join(__dirname, "public", "docs"), {
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
  res.locals.active    = "";
  res.locals.title     = "AGUDASCO";
  res.locals.CLOUD_BASE = app.locals.CLOUD_BASE;
  next();
});

/* === Floating WhatsApp locals === */
app.use((req, res, next) => {
  res.locals.showWhatsAppFloat = !req.path.startsWith("/admin");
  res.locals.waNumber = (process.env.WHATSAPP_NUMBER || "62895340169646").replace(/\D/g, "");
  res.locals.waText   = process.env.WHATSAPP_TEXT
    || "Halo Admin AGUDASCO, saya ingin mengajukan kritik & saran.";
  next();
});

/* === CSP === */
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self' https:",
      "img-src 'self' https: data: blob:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src  'self' 'unsafe-inline' https:",
      "worker-src 'self' blob: https:",
      "connect-src 'self' https: blob:",
      "object-src 'none'"
    ].join("; ")
  );
  next();
});

// ---- Footer contact loader (NO CACHE) ----
app.use(async (_req, res, next) => {
  try {
    res.locals.footerContact = await q1("SELECT * FROM site_info WHERE id=1") || {};
  } catch (e) {
    console.error("footerContact load err:", e?.message || String(e));
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

/* ============================================================
   [BARU] ROUTES GALERI (DISISIPKAN DI SINI)
   Biar aman dan langsung jalan sebelum masuk ke route lain
============================================================ */

// 1. DAFTAR ALBUM (Halaman Utama Admin Galeri)
app.get("/admin/galeri", adminAuth, async (req, res) => {
  try {
    // Ambil semua album, urutkan tanggal acara terbaru
    // Sekalian hitung jumlah foto per album (pake subquery simpel)
    const sql = `
      SELECT a.*, 
      (SELECT COUNT(*) FROM gallery_photos WHERE album_id = a.id) as photo_count
      FROM albums a 
      ORDER BY event_date DESC
    `;
    const albums = await q(sql);
    
    // Render view: views/admin/galeri/index.ejs
    res.render("admin/galeri/index", { 
      title: "Kelola Galeri",
      albums 
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Gagal memuat galeri.");
  }
});

// 2. CREATE ALBUM BARU
// Disini kita gabung: kalau GET tampilin form (opsional), 
// kalau POST langsung proses buat album.
// Kita pakai POST aja biar simpel (formnya di index.ejs)
app.post("/admin/galeri/create", adminAuth, uploadImage.single("cover"), async (req, res) => {
  try {
    const { title, event_date, description } = req.body;
    const cover = req.file ? req.file.path : null; // Ambil url gambar dari Cloudinary

    await pool.query(
      `INSERT INTO albums (title, event_date, description, cover_image) 
       VALUES ($1, $2, $3, $4)`,
      [title, event_date, description, cover]
    );

    res.redirect("/admin/galeri");
  } catch (err) {
    console.error(err);
    res.status(500).send("Gagal membuat album.");
  }
});

// 3. HAPUS ALBUM
app.get("/admin/galeri/delete/:id", adminAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM albums WHERE id = $1", [req.params.id]);
    res.redirect("/admin/galeri");
  } catch (err) {
    console.error(err);
    res.status(500).send("Gagal menghapus album.");
  }
});

// 4. BUKA ALBUM (Lihat & Upload Foto)
app.get("/admin/galeri/:id/photos", adminAuth, async (req, res) => {
  try {
    const albumId = req.params.id;
    // Ambil info album
    const album = await q1("SELECT * FROM albums WHERE id = $1", [albumId]);
    // Ambil foto-foto di dalamnya
    const photos = await q("SELECT * FROM gallery_photos WHERE album_id = $1 ORDER BY id DESC", [albumId]);

    if (!album) return res.status(404).send("Album tidak ditemukan");

    // Render view: views/admin/galeri/photos.ejs
    res.render("admin/galeri/photos", { 
      title: `Foto: ${album.title}`,
      album, 
      photos 
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Error membuka album.");
  }
});

// 5. UPLOAD FOTO KE ALBUM (Bisa Banyak Sekaligus/Multiple)
app.post("/admin/galeri/:id/upload", adminAuth, uploadImage.array("photos"), async (req, res) => {
  try {
    const albumId = req.params.id;
    
    // Loop semua file yang diupload dan masukkan ke database
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await pool.query(
          "INSERT INTO gallery_photos (album_id, image_url) VALUES ($1, $2)",
          [albumId, file.path]
        );
      }
    }
    
    // Balik lagi ke halaman foto tadi
    res.redirect(`/admin/galeri/${albumId}/photos`);
  } catch (err) {
    console.error(err);
    res.status(500).send("Gagal upload foto.");
  }
});

// 6. HAPUS FOTO
app.get("/admin/galeri/photo/delete/:id", adminAuth, async (req, res) => {
  try {
    // Cek dulu foto ini punya album mana (buat redirect balik)
    const photo = await q1("SELECT album_id FROM gallery_photos WHERE id = $1", [req.params.id]);
    
    if (photo) {
      await pool.query("DELETE FROM gallery_photos WHERE id = $1", [req.params.id]);
      res.redirect(`/admin/galeri/${photo.album_id}/photos`);
    } else {
      res.redirect("/admin/galeri");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Gagal hapus foto.");
  }
});

/* ------------------------------------------------------------
   ROUTES BAWAAN (LOADER)
------------------------------------------------------------ */
import publicRoutes from "./routes/public.js";
import adminRoutes  from "./routes/admin.js";

// healthcheck
app.get("/health", (_req, res) => res.status(200).send("OK"));

// Pasang route
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
