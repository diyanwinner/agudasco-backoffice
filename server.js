// server.js
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import sqlite3 from "sqlite3";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ------------------------------------------------------------------
   DB (SQLite) – tabel minimal untuk laman
------------------------------------------------------------------- */
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
    cover TEXT,
    pdf_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS adarts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    cover TEXT,
    pdf_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // migrasi ringan (abaikan error kalau kolom sudah ada)
  db.run(`ALTER TABLE reports ADD COLUMN cover TEXT`, () => {});
  db.run(`ALTER TABLE reports ADD COLUMN pdf_url TEXT`, () => {});
});

/* ------------------------------------------------------------------
   Cloudinary + Multer (image only)
------------------------------------------------------------------- */
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
    type: "upload",
    access_mode: "public",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ quality: "auto", fetch_format: "auto" }],
  },
});
const uploadImage = multer({ storage: imageStorage });

/* ------------------------------------------------------------------
   App config & middleware
------------------------------------------------------------------- */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Opsi B: assets di /public -> diakses via /public/...
import { dirname } from "path";
app.use("/public", express.static(path.join(__dirname, "public")));

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// Build id untuk cache-busting (pakai di layout: ?v=<%= buildId %>)
app.locals.buildId = process.env.RAILWAY_GIT_COMMIT_SHA || Date.now().toString();
app.use((req, res, next) => {
  res.locals.buildId = app.locals.buildId;
  res.locals.active = res.locals.active || "";
  res.locals.title = res.locals.title || "AGUDASCO";
  next();
});

// CSP sederhana (tidak terlalu ketat supaya Cloudinary bisa load)
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self' https:; img-src 'self' https: data:; script-src 'self' 'unsafe-inline' https:; style-src 'self' 'unsafe-inline' https:; object-src 'none'"
  );
  next();
});

/* ------------------------------------------------------------------
   Basic Auth untuk /admin
------------------------------------------------------------------- */
function adminAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Admin Area"');
    return res.status(401).send("Authentication required");
  }
  try {
    const decoded = Buffer.from(header.split(" ")[1], "base64").toString("utf8");
    const sep = decoded.indexOf(":");
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    const ok =
      user === (process.env.ADMIN_USERNAME || "") &&
      pass === (process.env.ADMIN_PASSWORD || "");
    if (!ok) {
      res.set("WWW-Authenticate", 'Basic realm="Admin Area"');
      return res.status(401).send("Unauthorized");
    }
    return next();
  } catch {
    res.set("WWW-Authenticate", 'Basic realm="Admin Area"');
    return res.status(401).send("Invalid auth");
  }
}
app.use("/admin", adminAuth);

/* ------------------------------------------------------------------
   Helpers
------------------------------------------------------------------- */
function normalizePdfUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url.trim());
    const m1 = u.pathname.match(/\/file\/d\/([^/]+)/);
    if (u.hostname.includes("drive.google.com") && m1) {
      return `https://drive.google.com/uc?export=download&id=${m1[1]}`;
    }
    if (u.hostname.includes("drive.google.com") && u.searchParams.get("id")) {
      return `https://drive.google.com/uc?export=download&id=${u.searchParams.get("id")}`;
    }
    return url.trim();
  } catch {
    return url.trim();
  }
}

// Render aman: fallback jika view tidak ada
function renderSafe(res, viewName, props = {}) {
  const full = path.join(__dirname, "views", `${viewName}.ejs`);
  if (fs.existsSync(full)) {
    return res.render(viewName, props);
  }
  return res.render("page", {
    title: props.title || viewName,
    active: props.active || "",
    heading: props.title || viewName,
    content: props.content || "<p>Halaman dalam pengembangan.</p>",
  });
}

/* ------------------------------------------------------------------
   Routes – Public
------------------------------------------------------------------- */
app.get("/health", (req, res) => res.status(200).send("OK"));

app.get("/", (req, res) => {
  db.all("SELECT * FROM banners ORDER BY id DESC LIMIT 10", [], (e1, banners = []) => {
    db.all("SELECT * FROM articles ORDER BY id DESC LIMIT 6", [], (e2, arts = []) => {
      res.render("home", {
        title: "AGUDASCO – Beranda",
        active: "home",
        banners,
        arts,
      });
    });
  });
});

/* ---- Artikel ---- */
app.get("/artikel", (req, res) => {
  db.all("SELECT * FROM articles ORDER BY id DESC", [], (err, articles = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("articles", { title: "Artikel", active: "artikel", articles });
  });
});

app.get("/artikel/:id", (req, res) => {
  db.get("SELECT * FROM articles WHERE id = ?", [req.params.id], (err, article) => {
    if (err) return res.status(500).send(err.message);
    if (!article) return res.status(404).send("Artikel tidak ditemukan");
    res.render("article_view", { title: article.title, active: "artikel", article });
  });
});

/* ---- Laporan ---- */
app.get("/laporan", (req, res) => {
  db.all("SELECT * FROM reports ORDER BY id DESC", [], (err, reports = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("reports", { title: "Laporan Keuangan", active: "laporan", reports });
  });
});

app.get("/laporan/:id", (req, res) => {
  db.get("SELECT * FROM reports WHERE id = ?", [req.params.id], (err, report) => {
    if (err) return res.status(500).send(err.message);
    if (!report) return res.status(404).send("Laporan tidak ditemukan");
    const fixed = { ...report, pdf_url: normalizePdfUrl(report.pdf_url) };
    res.render("report_view", { title: report.title, active: "laporan", report: fixed });
  });
});

/* ---- AD/ART (public) ---- */
app.get("/adart", (req, res) => {
  db.all("SELECT * FROM adarts ORDER BY id DESC", [], (err, adarts = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("adart", { title: "AD/ART", active: "adart", adarts });
  });
});

app.get("/adart/:id", (req, res) => {
  db.get("SELECT * FROM adarts WHERE id = ?", [req.params.id], (err, item) => {
    if (err) return res.status(500).send(err.message);
    if (!item) return res.status(404).send("Dokumen AD/ART tidak ditemukan");
    const fixed = { ...item, pdf_url: normalizePdfUrl(item.pdf_url) };
    res.render("adart_view", { title: item.title, active: "adart", item: fixed });
  });
});

/* ---- Menu statis lainnya ---- */
app.get("/anggota", (req, res) => renderSafe(res, "anggota", { title: "Anggota", active: "anggota", anggota: [] }));
app.get("/galeri",  (req, res) => renderSafe(res, "galeri",  { title: "Galeri",  active: "galeri",  fotos: [] }));
app.get("/tentang", (req, res) => renderSafe(res, "tentang", { title: "Tentang", active: "tentang" }));
app.get("/kontak",  (req, res) => renderSafe(res, "kontak",  { title: "Kontak",  active: "kontak"  }));

/* ------------------------------------------------------------------
   Routes – Admin
------------------------------------------------------------------- */
app.get("/admin", (req, res) => res.render("admin/dashboard", { title: "Dashboard" }));

// Admin: Artikel
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
    [title.trim(), content || "", image],
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

// Admin: Banner
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

// Admin: Reports
app.get("/admin/reports", (req, res) => {
  db.all("SELECT * FROM reports ORDER BY id DESC", [], (err, reports = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("admin/reports", { title: "Kelola Laporan", reports });
  });
});

app.post("/admin/reports", uploadImage.single("cover"), (req, res) => {
  const { title, pdf_url } = req.body;
  const cover = req.file ? req.file.path : null;
  if (!title) return res.status(400).send("Judul wajib diisi");

  const fixedPdf = normalizePdfUrl(pdf_url || "");
  db.run(
    "INSERT INTO reports (title, cover, pdf_url) VALUES (?, ?, ?)",
    [title.trim(), cover, fixedPdf],
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

// Admin: AD/ART
app.get("/admin/adart", (req, res) => {
  db.all("SELECT * FROM adarts ORDER BY id DESC", [], (err, adarts = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("admin/adart", { title: "Kelola AD/ART", adarts });
  });
});

app.post("/admin/adart", uploadImage.single("cover"), (req, res) => {
  const { title, pdf_url } = req.body;
  const cover = req.file ? req.file.path : null;
  if (!title) return res.status(400).send("Judul wajib diisi");

  const fixedPdf = normalizePdfUrl(pdf_url || "");
  db.run(
    "INSERT INTO adarts (title, cover, pdf_url) VALUES (?, ?, ?)",
    [title.trim(), cover, fixedPdf],
    (err) => {
      if (err) return res.status(500).send(err.message);
      res.redirect("/admin/adart");
    }
  );
});

app.post("/admin/adart/:id/delete", (req, res) => {
  db.run("DELETE FROM adarts WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect("/admin/adart");
  });
});

/* ------------------------------------------------------------------
   404 & Error handlers
------------------------------------------------------------------- */
app.get("/health", (req, res) => res.status(200).send("OK")); // readiness
app.use((req, res) => res.status(404).send("Not Found"));
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err?.stack || err);
  res.status(500).send(err?.message || "Server Error");
});

/* ------------------------------------------------------------------
   Start
------------------------------------------------------------------- */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
