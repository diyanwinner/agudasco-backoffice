// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import sqlite3 from "sqlite3";
import multer from "multer";
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

/** Storage khusus GAMBAR (banner/artikel) */
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "agudasco/images",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});

/** Storage khusus DOKUMEN (laporan) */
const fileStorage = new CloudinaryStorage({
  cloudinary,
  // "auto" biar PDF/DOC/DOCX/XLS/XLSX/PPT/PPTX dll aman
  params: {
    folder: "agudasco/reports",
    resource_type: "auto",
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

// (opsional) izinkan iframe dari docs.google.com & res.cloudinary.com
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "frame-src 'self' https://docs.google.com https://res.cloudinary.com; child-src 'self' https://docs.google.com https://res.cloudinary.com; object-src 'none';"
  );
  next();
});

/* --------------------------- Routes -------------------------- */

// Healthcheck
app.get("/health", (req, res) => res.status(200).send("OK"));

// HOME
app.get("/", (req, res) => {
  db.all("SELECT * FROM banners ORDER BY id DESC LIMIT 10", [], (e1, banners = []) => {
    db.all("SELECT * FROM articles ORDER BY id DESC LIMIT 6", [], (e2, arts = []) => {
      res.render("home", {
        title: "AGUDASCO – Beranda",
        banners,
        arts,
      });
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

// Detail + Preview (siapkan pdfSrc untuk embed PDF via proxy lokal)
app.get("/laporan/:id", (req, res) => {
  db.get("SELECT * FROM reports WHERE id = ?", [req.params.id], (err, report) => {
    if (err) return res.status(500).send(err.message);
    if (!report) return res.status(404).send("Laporan tidak ditemukan");

    const url = (report.file || "");
    const lower = url.toLowerCase();
    const isPDF = lower.endsWith(".pdf");

    // Google Viewer untuk Office files
    const googleViewer =
      "https://docs.google.com/gview?embedded=1&url=" + encodeURIComponent(url);

    // Proxy PDF agar pasti inline (Content-Type/Disposition kita yang atur)
    const pdfSrc = `/laporan/${req.params.id}/raw`;

    res.render("report_view", {
      title: report.title,
      report,
      isPDF,
      googleViewer,
      pdfSrc
    });
  });
});

// PROXY PDF: stream dari Cloudinary, paksa header inline supaya <object> tampil
app.get("/laporan/:id/raw", async (req, res) => {
  try {
    db.get("SELECT * FROM reports WHERE id = ?", [req.params.id], async (err, report) => {
      if (err) return res.status(500).send(err.message);
      if (!report) return res.status(404).send("Laporan tidak ditemukan");

      const url = report.file || "";
      if (!url.toLowerCase().endsWith(".pdf")) {
        // kalau bukan PDF, langsung redirect (biar download/view default)
        return res.redirect(url);
      }

      const upstream = await fetch(url);
      if (!upstream.ok || !upstream.body) {
        return res.status(502).send("Gagal mengambil file dari Cloudinary");
      }

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", "inline; filename=report.pdf");

      upstream.body.pipe(res);
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Gagal memuat PDF");
  }
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
  const image = req.file ? req.file.path : null; // URL Cloudinary

  if (!title) return res.status(400).send("Judul wajib diisi");

  db.run(
    "INSERT INTO articles (title, content, image) VALUES (?, ?, ?)",
    [title, content || "", image],
    (err) => {
      if (err) {
        console.error("Insert article error:", err.message);
        return res.status(500).send(err.message);
      }
      res.redirect("/admin/articles");
    }
  );
});

app.post("/admin/articles/:id/delete", (req, res) => {
  db.run("DELETE FROM articles WHERE id = ?", [req.params.id], (err) => {
    if (err) {
      console.error("Delete article error:", err.message);
      return res.status(500).send(err.message);
    }
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
    if (err) {
      console.error("Insert banner error:", err.message);
      return res.status(500).send(err.message);
    }
    res.redirect("/admin/banners");
  });
});

app.post("/admin/banners/:id/delete", (req, res) => {
  db.run("DELETE FROM banners WHERE id = ?", [req.params.id], (err) => {
    if (err) {
      console.error("Delete banner error:", err.message);
      return res.status(500).send(err.message);
    }
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
  const file = req.file ? req.file.path : null; // URL Cloudinary (secure)

  if (!title || !file) return res.status(400).send("Judul dan file wajib diisi");

  db.run("INSERT INTO reports (title, file) VALUES (?, ?)", [title, file], (err) => {
    if (err) {
      console.error("Insert report error:", err.message);
      return res.status(500).send(err.message);
    }
    res.redirect("/admin/reports");
  });
});

app.post("/admin/reports/:id/delete", (req, res) => {
  db.run("DELETE FROM reports WHERE id = ?", [req.params.id], (err) => {
    if (err) {
      console.error("Delete report error:", err.message);
      return res.status(500).send(err.message);
    }
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
