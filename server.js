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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

/* --------------------- Cloudinary config --------------------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

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

/** Storage DOKUMEN (laporan) – biar Cloudinary simpan sebagaimana file asli */
const fileStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const base = path.parse(file.originalname).name;
    const map = {
      "application/pdf": "pdf",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.ms-excel": "xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.ms-powerpoint": "ppt",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    };
    const fmt = map[file.mimetype] || undefined;

    return {
      folder: "agudasco/reports",
      // tetap pakai RAW agar file utuh; meski public delivery di-block,
      // nanti kita ambil via endpoint download yang bertanda tangan
      resource_type: "raw",
      type: "upload",
      access_mode: "public",
      public_id: base,
      format: fmt,
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

// izinkan frame PDF.js dan Cloudinary
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "frame-src 'self' https://mozilla.github.io https://res.cloudinary.com",
      "child-src 'self' https://mozilla.github.io https://res.cloudinary.com",
      "object-src 'none'",
    ].join("; ")
  );
  next();
});

/* --------------------------- Routes -------------------------- */
app.get("/health", (req, res) => res.status(200).send("OK"));

// HOME
app.get("/", (req, res) => {
  db.all("SELECT * FROM banners ORDER BY id DESC LIMIT 10", [], (e1, banners = []) => {
    db.all("SELECT * FROM articles ORDER BY id DESC LIMIT 6", [], (e2, arts = []) => {
      res.render("home", { title: "AGUDASCO – Beranda", banners, arts });
    });
  });
});

// LIST laporan
app.get("/laporan", (req, res) => {
  db.all("SELECT * FROM reports ORDER BY id DESC", [], (err, reports = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("reports", { title: "Laporan Keuangan", reports });
  });
});

// DETAIL + PREVIEW laporan
app.get("/laporan/:id", (req, res) => {
  db.get("SELECT * FROM reports WHERE id = ?", [req.params.id], (err, report) => {
    if (err) return res.status(500).send(err.message);
    if (!report) return res.status(404).send("Laporan tidak ditemukan");

    // PDF viewer akan diarahkan ke /file/:id (proxy kita)
    const pdfUrl = `/file/${report.id}?inline=1`;

    res.render("report_view", {
      title: report.title,
      report,
      pdfUrl
    });
  });
});

/* --------- PROXY download/preview file Cloudinary (fix 401) --------- */
/**
 * Cloudinary account kamu “Blocked for delivery”, jadi res.cloudinary.com 401.
 * Kita pakai endpoint Admin “download” bertanda tangan, lalu stream ke client.
 * Dok: https://cloudinary.com/documentation/admin_api#download_asset
 */
function extractPublicIdFromUrl(rawUrl) {
  // contoh URL: https://res.cloudinary.com/<cloud>/raw/upload/v123456/agudasco/reports/Nama File.pdf
  // ambil bagian setelah '/raw/upload/' lalu buang ekstensi
  try {
    const u = new URL(rawUrl);
    const idx = u.pathname.indexOf("/raw/upload/");
    if (idx === -1) return null;
    const after = u.pathname.slice(idx + "/raw/upload/".length); // v123/....pdf
    const noVer = after.replace(/^v\d+\//, "");                  // agudasco/reports/Nama%20File.pdf
    const withExt = decodeURIComponent(noVer);
    const dot = withExt.lastIndexOf(".");
    return dot === -1 ? withExt : withExt.slice(0, dot);         // agudasco/reports/Nama File
  } catch {
    return null;
  }
}

app.get("/file/:id", (req, res) => {
  const wantDownload = "download" in req.query && req.query.download !== "0";
  const wantInline   = "inline" in req.query;

  db.get("SELECT * FROM reports WHERE id = ?", [req.params.id], async (err, report) => {
    if (err) return res.status(500).send("Gagal membuka file.");
    if (!report) return res.status(404).send("File tidak ditemukan.");

    const fileUrl = (report.file || "").trim();
    if (!fileUrl) return res.status(404).send("URL file kosong.");

    // 1) coba akses langsung (kalau nanti akunmu sudah trusted, ini akan jalan)
    try {
      const head = await axios.head(fileUrl, { timeout: 4000, validateStatus: () => true });
      if (head.status >= 200 && head.status < 300) {
        // direct stream
        const rs = await axios.get(fileUrl, { responseType: "stream" });
        res.setHeader(
          "Content-Disposition",
          wantDownload
            ? `attachment; filename="${encodeURIComponent(report.title)}.pdf"`
            : (wantInline ? "inline" : "inline")
        );
        res.setHeader("Content-Type", head.headers["content-type"] || "application/pdf");
        return rs.data.pipe(res);
      }
    } catch (_) {
      // lanjut fallback
    }

    // 2) fallback: Admin API “download” (signed URL)
    try {
      const cloud_name = cloudinary.config().cloud_name;
      const api_key    = cloudinary.config().api_key;
      const api_secret = cloudinary.config().api_secret;

      const publicId = extractPublicIdFromUrl(fileUrl);
      if (!publicId) return res.status(500).send("Gagal membaca public_id Cloudinary.");

      const timestamp = Math.floor(Date.now() / 1000);
      // per dok: /resources/{resource_type}/{type}/download
      const paramsToSign = `public_id=${publicId}&resource_type=raw&timestamp=${timestamp}`;
      const signature = crypto
        .createHash("sha1")
        .update(paramsToSign + api_secret)
        .digest("hex");

      const adminDownloadUrl =
        `https://api.cloudinary.com/v1_1/${cloud_name}/resources/raw/upload/download` +
        `?public_id=${encodeURIComponent(publicId)}` +
        `&timestamp=${timestamp}` +
        `&signature=${signature}` +
        `&api_key=${api_key}`;

      const resp = await axios.get(adminDownloadUrl, {
        responseType: "stream",
        validateStatus: () => true,
      });

      if (resp.status >= 200 && resp.status < 300) {
        res.setHeader(
          "Content-Disposition",
          wantDownload
            ? `attachment; filename="${encodeURIComponent(report.title)}.pdf"`
            : (wantInline ? "inline" : "inline")
        );
        res.setHeader("Content-Type", "application/pdf");
        return resp.data.pipe(res);
      }

      // kalau admin download pun gagal
      return res.status(502).send("Gagal membuka file.");
    } catch (e) {
      return res.status(502).send("Gagal membuka file.");
    }
  });
});

/* --------------------------- Admin --------------------------- */
app.get("/admin", (req, res) =>
  res.render("admin/dashboard", { title: "Dashboard" })
);

// Artikel
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

// Banner
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

app.post("/admin/banners/:id/delete", (req, res) => {
  db.run("DELETE FROM banners WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect("/admin/banners");
  });
});

// Laporan
app.get("/admin/reports", (req, res) => {
  db.all("SELECT * FROM reports ORDER BY id DESC", [], (err, reports = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("admin/reports", { title: "Kelola Laporan", reports });
  });
});

app.post("/admin/reports", uploadFile.single("file"), (req, res) => {
  const { title } = req.body;
  const file = req.file ? req.file.path : null;
  if (!title || !file) return res.status(400).send("Judul dan file wajib diisi");
  db.run("INSERT INTO reports (title, file) VALUES (?, ?)", [title, file], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect("/admin/reports");
  });
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
