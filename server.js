// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import sqlite3 from "sqlite3";
import multer from "multer";
import crypto from "crypto";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ------------------------ DB (SQLite) ------------------------ */
const db = new sqlite3.Database("./db.sqlite");
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS banners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    file TEXT NOT NULL,
    public_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

/* --------------------- Cloudinary config --------------------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* -------------------- Multer Storages ------------------------ */
/** Storage GAMBAR (banner/artikel) – public image */
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "agudasco/images",
    resource_type: "image",
    type: "upload",
    access_mode: "public",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});

/** Storage DOKUMEN (laporan) – RAW upload (file utuh, public_id PAKAI EKSTENSI) */
const fileStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const base = path.parse(file.originalname).name;       // nama tanpa ekstensi
    const ext  = path.extname(file.originalname) || "";    // mis. ".pdf"
    return {
      folder: "agudasco/reports",
      resource_type: "raw",
      type: "upload",
      access_mode: "public",
      public_id: `${base}${ext}`, // SIMPAN DENGAN EKSTENSI — penting agar cocok dg asset lama
      // format: untuk resource_type raw tidak perlu dipaksa
    };
  },
});

const uploadImage = multer({ storage: imageStorage });
const uploadFile  = multer({ storage: fileStorage });

/* ------------------------- Middleware ------------------------ */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// Iframe hanya dari origin sendiri (pakai viewer PDF native browser)
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "frame-src 'self'",
      "child-src 'self'",
      "object-src 'none'",
    ].join("; ")
  );
  next();
});

/* --------------------------- Helpers -------------------------- */
/** URL sekali-pakai via Upload API: private_download (stabil untuk RAW). */
async function requestPrivateDownloadUrl(publicIdWithExt, fallbackFileUrl = "") {
  const { cloud_name, api_key, api_secret } = cloudinary.config();

  // pisahkan public_id (tanpa ekstensi) & format
  let base = publicIdWithExt;
  let format = "";
  const m = publicIdWithExt.match(/^(.*)\.([^.\/]+)$/);
  if (m) {
    base = m[1];       // tanpa ekstensi
    format = m[2];     // pdf/docx/...
  } else if (fallbackFileUrl) {
    try {
      const name = decodeURIComponent(new URL(fallbackFileUrl).pathname.split("/").pop() || "");
      const m2 = name.match(/\.([^.\/]+)$/);
      if (m2) format = m2[1];
    } catch {}
  }
  if (!format) format = "pdf"; // default

  const endpoint = `https://api.cloudinary.com/v1_1/${cloud_name}/raw/upload/private_download`;
  const form = new URLSearchParams({ public_id: base, format });

  const resp = await axios.post(endpoint, form.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    auth: { username: api_key, password: api_secret },
    validateStatus: () => true,
  });

  return resp; // { status, data:{ url? } }
}

/** Dapatkan public_id final untuk dipakai Admin API */
function getPublicIdFromRecord(report) {
  let pid = (report.public_id || "").trim();

  if (!pid) {
    const fromUrl = extractPublicIdFromUrl((report.file || "").trim());
    if (!fromUrl) return null;
    pid = fromUrl; // sudah include folder + ekstensi dari URL
  }

  if (!pid.includes("/")) pid = `agudasco/reports/${pid}`;
  // PENTING: JANGAN menghapus ekstensi
  return pid;
}

/** Panggil Admin API untuk minta signed download URL (POST + Basic Auth) */
async function requestAdminSignedUrl(publicId) {
  const { cloud_name, api_key, api_secret } = cloudinary.config();
  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `public_id=${publicId}&resource_type=raw&timestamp=${timestamp}`;
  const signature = crypto.createHash("sha1").update(toSign + api_secret).digest("hex");

  const adminEndpoint = `https://api.cloudinary.com/v1_1/${cloud_name}/resources/raw/upload/download`;
  const form = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    signature,
    api_key
  });

  const resp = await axios.post(adminEndpoint, form.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    auth: { username: api_key, password: api_secret },
    validateStatus: () => true
  });

  return resp; // { status, data: { url? } }
}

/* --------------------------- Routes -------------------------- */
app.get("/health", (req, res) => res.status(200).send("OK"));

/* --- DIAG: cek ENV Cloudinary terbaca --- */
app.get("/diag/cloudinary", (req, res) => {
  const cfg = cloudinary.config();
  res.json({
    cloud_name: cfg.cloud_name,
    api_key_present: !!cfg.api_key,
    api_secret_present: !!cfg.api_secret
  });
});

/* --- DIAG: per report (lihat public_id final & status Admin API) --- */
app.get("/diag/report/:id", (req, res) => {
  db.get("SELECT * FROM reports WHERE id = ?", [req.params.id], async (err, report) => {
    if (err || !report) return res.status(404).json({ error: "Report not found" });

    const publicId = getPublicIdFromRecord(report); // mengandung ekstensi
    let status = null, has_url = false, url = null;

    if (publicId) {
      const r = await requestPrivateDownloadUrl(publicId, report.file);
      status = r.status;
      has_url = !!r.data?.url;
      url = r.data?.url || null;
    }

    res.json({
      id: report.id,
      title: report.title,
      file_from_db: report.file,
      public_id_from_db: report.public_id || null,
      derived_public_id: publicId,
      admin_status: status,              // ini sekarang status private_download
      admin_response_has_url: has_url,
      sample_url: url
    });
  });
});

// HOME
app.get("/", (req, res) => {
  db.all("SELECT * FROM banners ORDER BY id DESC LIMIT 10", [], (e1, banners = []) => {
    db.all("SELECT * FROM articles ORDER BY id DESC LIMIT 6", [], (e2, arts = []) => {
      res.render("home", { title: "AGUDASCO – Beranda", banners, arts });
    });
  });
});

/* ---------- Public: Laporan list & preview ---------- */
app.get("/laporan", (req, res) => {
  db.all("SELECT * FROM reports ORDER BY id DESC", [], (err, reports = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("reports", { title: "Laporan Keuangan", reports });
  });
});

app.get("/laporan/:id", (req, res) => {
  db.get("SELECT * FROM reports WHERE id = ?", [req.params.id], (err, report) => {
    if (err) return res.status(500).send(err.message);
    if (!report) return res.status(404).send("Laporan tidak ditemukan");

    // pakai viewer PDF native (iframe ke proxy kita)
    const pdfUrl = `/file/${report.id}?inline=1`;
    res.render("report_view", { title: report.title, report, pdfUrl });
  });
});

/* ---------- DEBUG: redirect langsung ke signed URL ---------- */
app.get("/file/:id", (req, res) => {
  const wantDownload = "download" in req.query && req.query.download !== "0";
  const wantInline   = "inline" in req.query;

  db.get("SELECT * FROM reports WHERE id = ?", [req.params.id], async (err, report) => {
    if (err) return res.status(500).send("Gagal membuka file.");
    if (!report) return res.status(404).send("File tidak ditemukan.");

    const publicId = getPublicIdFromRecord(report);
    if (!publicId) return res.status(500).send("Gagal membaca public_id Cloudinary.");

    try {
      // Minta URL sekali-pakai
      const ticket = await requestPrivateDownloadUrl(publicId, report.file);
      if (ticket.status < 200 || ticket.status >= 300 || !ticket.data?.url) {
        console.error("private_download failed:", ticket.status, ticket.data);
        return res.status(502).send("Gagal membuka file.");
      }

      // Stream ke browser
      const dlUrl = ticket.data.url;
      const fileStream = await axios.get(dlUrl, { responseType: "stream", validateStatus: () => true });
      if (fileStream.status < 200 || fileStream.status >= 300) {
        console.error("Signed URL fetch failed:", fileStream.status);
        return res.status(502).send("Gagal membuka file.");
      }

      res.setHeader(
        "Content-Disposition",
        wantDownload
          ? `attachment; filename="${encodeURIComponent((report.title || "file") + ".pdf")}"`
          : (wantInline ? "inline" : "inline")
      );
      res.setHeader("Content-Type", fileStream.headers["content-type"] || "application/pdf");
      fileStream.data.pipe(res);
    } catch (e) {
      console.error("Proxy exception:", e?.message);
      res.status(502).send("Gagal membuka file.");
    }
  });
});

/* --------- PROXY download/preview (fix 401 “Blocked for delivery”) --------- */
app.get("/file/:id", (req, res) => {
  const wantDownload = "download" in req.query && req.query.download !== "0";
  const wantInline   = "inline" in req.query;

  db.get("SELECT * FROM reports WHERE id = ?", [req.params.id], async (err, report) => {
    if (err) return res.status(500).send("Gagal membuka file.");
    if (!report) return res.status(404).send("File tidak ditemukan.");

    const publicId = getPublicIdFromRecord(report);
    if (!publicId) return res.status(500).send("Gagal membaca public_id Cloudinary.");

    try {
      // 1) minta signed URL dari Admin API
      const ticket = await requestAdminSignedUrl(publicId);
      if (ticket.status < 200 || ticket.status >= 300 || !ticket.data?.url) {
        console.error("Admin download failed:", ticket.status, ticket.data);
        return res.status(502).send("Gagal membuka file.");
      }

      // 2) stream file ke browser
      const signedUrl = ticket.data.url;
      const fileStream = await axios.get(signedUrl, { responseType: "stream", validateStatus: () => true });
      if (fileStream.status < 200 || fileStream.status >= 300) {
        console.error("Signed URL fetch failed:", fileStream.status);
        return res.status(502).send("Gagal membuka file.");
      }

      res.setHeader(
        "Content-Disposition",
        wantDownload
          ? `attachment; filename="${encodeURIComponent((report.title || "file") + ".pdf")}"`
          : (wantInline ? "inline" : "inline")
      );
      res.setHeader("Content-Type", fileStream.headers["content-type"] || "application/pdf");

      return fileStream.data.pipe(res);
    } catch (e) {
      console.error("Admin download exception:", e?.message);
      return res.status(502).send("Gagal membuka file.");
    }
  });
});

/* --------------------------- Admin --------------------------- */
app.get("/admin", (req, res) =>
  res.render("admin/dashboard", { title: "Dashboard" })
);

/* ---- Admin: Artikel ---- */
app.get("/admin/articles", (req, res) => {
  db.all("SELECT * FROM articles ORDER BY id DESC", [], (err, articles = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("admin/articles", { title: "Kelola Artikel", articles });
  });
});

app.post("/admin/articles", uploadImage.single("image"), (req, res) => {
  const { title, content } = req.body;
  const image = req.file ? req.file.path : null;
  if (!title) return res.status(400).send("Judul wajib diisi");

  db.run(
    "INSERT INTO articles (title, content, image) VALUES (?, ?, ?)",
    [title, content || "", image],
    (err) => {
      if (err) return res.status(500).send(err.message);
      res.redirect("/admin/articles");
    }
  );
});

app.post("/admin/articles/:id/delete", (req, res) => {
  db.run("DELETE FROM articles WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect("/admin/articles");
  });
});

/* ---- Admin: Banner ---- */
app.get("/admin/banners", (req, res) => {
  db.all("SELECT * FROM banners ORDER BY id DESC", [], (err, banners = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("admin/banners", { title: "Kelola Banner", banners });
  });
});

app.post("/admin/banners", uploadImage.single("image"), (req, res) => {
  const image = req.file ? req.file.path : null;
  if (!image) return res.status(400).send("File gambar belum dipilih");

  db.run("INSERT INTO banners (image) VALUES (?)", [image], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect("/admin/banners");
  });
});

/* ---- Admin: Laporan ---- */
app.get("/admin/reports", (req, res) => {
  db.all("SELECT * FROM reports ORDER BY id DESC", [], (err, reports = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("admin/reports", { title: "Kelola Laporan", reports });
  });
});

app.post("/admin/reports", uploadFile.single("file"), (req, res) => {
  const { title } = req.body;
  const file = req.file ? req.file.path : null;

  // public_id dari multer-storage-cloudinary → filename (sesuai yg kita set, SUDAH pakai ekstensi)
  let pid = req.file ? (req.file.filename || req.file.public_id || null) : null;
  if (pid && !pid.includes("/")) pid = `agudasco/reports/${pid}`;

  if (!title || !file) return res.status(400).send("Judul dan file wajib diisi");

  db.run(
    "INSERT INTO reports (title, file, public_id) VALUES (?, ?, ?)",
    [title, file, pid],
    (err) => {
      if (err) return res.status(500).send(err.message);
      res.redirect("/admin/reports");
    }
  );
});

app.post("/admin/reports/:id/delete", (req, res) => {
  db.run("DELETE FROM reports WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect("/admin/reports");
  });
});

/* ------------------- 404 & Error Handlers ------------------- */
app.use((req, res) => res.status(404).send("Not Found"));
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err?.stack || err);
  res.status(500).send(err?.message || "Server Error");
});

/* --------------------------- Start --------------------------- */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`Server running at http://localhost:${PORT}`)
);
