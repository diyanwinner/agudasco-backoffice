// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import sqlite3 from "sqlite3";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import fetch from "node-fetch"; // Node 18+ sudah ada fetch global, ini untuk jaga2

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

  // Tambah kolom untuk simpan public_id & format Cloudinary (biar proxy rapi)
  db.run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    file TEXT NOT NULL,         -- secure_url (fallback)
    public_id TEXT,             -- contoh: agudasco/reports/Laporan Keuangan ...
    format TEXT,                -- contoh: pdf, docx, xlsx
    resource_type TEXT,         -- raw / image / auto
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

/* --------------------- Cloudinary config --------------------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/** Storage GAMBAR (banner/artikel) – PUBLIC */
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

/** Storage DOKUMEN (laporan) – gunakan AUTO
 *  - PDF akan tetap bisa dirender sebagai PDF
 *  - Office (docx/xlsx/pptx) tetap ter-upload dengan aman
 */
const fileStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const base = path.parse(file.originalname).name;

    const mime2ext = {
      "application/pdf": "pdf",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.ms-excel": "xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.ms-powerpoint": "ppt",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    };

    const fmt = mime2ext[file.mimetype] || undefined;

    return {
      folder: "agudasco/reports",
      resource_type: "auto",   // BIAR PALING AMAN
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

// Izinkan iframe PDF viewer & Cloudinary
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "frame-src 'self' https://res.cloudinary.com https://mozilla.github.io",
      "child-src 'self' https://res.cloudinary.com https://mozilla.github.io",
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

/* ---------- Public: Laporan list & preview ---------- */
// List laporan
app.get("/laporan", (req, res) => {
  db.all("SELECT * FROM reports ORDER BY id DESC", [], (err, reports = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("reports", { title: "Laporan Keuangan", reports });
  });
});

// Detail + Preview
app.get("/laporan/:id", (req, res) => {
  db.get("SELECT * FROM reports WHERE id = ?", [req.params.id], (err, report) => {
    if (err) return res.status(500).send(err.message);
    if (!report) return res.status(404).send("Laporan tidak ditemukan");

    const url = (report.file || "").trim();
    const isPDF = url.toLowerCase().endsWith(".pdf");

    // PDF.js viewer (fallback kalau direct Cloudinary bermasalah)
    const pdfJsViewer = "https://mozilla.github.io/pdf.js/web/viewer.html?file=" + encodeURIComponent(`/file/${report.id}`);

    res.render("report_view", {
      title: report.title,
      report,
      isPDF,
      pdfJsViewer
    });
  });
});

/**
 * PROXY untuk preview & download file Cloudinary.
 * - Menggunakan signed private download URL dari SDK Cloudinary.
 * - Browser akan render PDF normal.
 * - Tambahkan ?download=1 untuk force download.
 */
function extToMime(ext) {
  const map = {
    pdf:  "application/pdf",
    doc:  "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls:  "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt:  "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext?.toLowerCase()] || "application/octet-stream";
}

app.get("/file/:id", async (req, res) => {
  db.get("SELECT * FROM reports WHERE id = ?", [req.params.id], async (err, r) => {
    if (err) return res.status(500).send(err.message);
    if (!r)  return res.status(404).send("File tidak ditemukan");

    // Ambil public_id & format kalau ada. Kalau tidak, duga dari URL.
    let publicId = r.public_id;
    let format   = r.format;
    let rtype    = r.resource_type || "raw";

    if (!publicId || !format) {
      // coba tebak dari URL
      try {
        const u = new URL(r.file);
        // path .../<resource_type>/upload/.../<public_id>.<format>
        const parts = u.pathname.split("/");
        // ambil segmen setelah "upload"
        const idx = parts.findIndex(p => p === "upload");
        const tail = parts.slice(idx + 1).join("/"); // e.g. agudasco/reports/abc.pdf
        publicId = tail.replace(/\.[^/.]+$/, "");    // tanpa .ext
        format   = (r.file.split(".").pop() || "pdf").toLowerCase();
        if (u.pathname.includes("/image/")) rtype = "image";
        if (u.pathname.includes("/raw/"))   rtype = "raw";
      } catch {}
    }

    try {
      // Buat URL bertanda tangan (valid 5 menit)
      const expiresAt = Math.floor(Date.now()/1000) + 5*60;

      // Gunakan private_download_url agar lolos kalau asset "blocked for delivery"
      const signedUrl = cloudinary.utils.private_download_url(
        publicId,
        format,
        {
          resource_type: rtype,   // 'raw' untuk dokumen
          type: "upload",
          expires_at: expiresAt,
          attachment: false       // jangan paksa download
        }
      );

      const resp = await fetch(signedUrl);
      if (!resp.ok) {
        // fallback terakhir: pakai secure_url apa adanya (mungkin 401, tapi coba saja)
        const raw = await fetch(r.file);
        if (!raw.ok) return res.status(502).send("Gagal membuka file.");
        res.setHeader("Content-Type", extToMime(format));
        if (req.query.download === "1") {
          res.setHeader("Content-Disposition", `attachment; filename="${(r.title || "file")}.${format}"`);
        }
        raw.body.pipe(res);
        return;
      }

      res.setHeader("Content-Type", extToMime(format));
      if (req.query.download === "1") {
        res.setHeader("Content-Disposition", `attachment; filename="${(r.title || "file")}.${format}"`);
      }
      resp.body.pipe(res);
    } catch (e) {
      console.error("Proxy error:", e);
      res.status(500).send("Tidak bisa memuat file.");
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

app.post("/admin/banners/:id/delete", (req, res) => {
  db.run("DELETE FROM banners WHERE id = ?", [req.params.id], (err) => {
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

  // dari multer-storage-cloudinary:
  // req.file.path       -> secure_url
  // req.file.filename   -> public_id
  // req.file.format     -> ext (pdf/docx/...)
  // req.file.resource_type -> raw/image/auto
  const secureUrl    = req.file ? req.file.path : null;
  const publicId     = req.file ? req.file.filename : null;
  const format       = req.file ? req.file.format : null;
  const resourceType = req.file ? (req.file.resource_type || "raw") : null;

  if (!title || !secureUrl) return res.status(400).send("Judul dan file wajib diisi");

  db.run(
    "INSERT INTO reports (title, file, public_id, format, resource_type) VALUES (?, ?, ?, ?, ?)",
    [title, secureUrl, publicId, format, resourceType],
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
