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

  // reports: cover (image Cloudinary) + pdf_url (link eksternal)
  db.run(`CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    cover TEXT,
    pdf_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // AD/ART (terpisah dari reports)
  db.run(`CREATE TABLE IF NOT EXISTS adart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    cover TEXT,
    pdf_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Anggota (publik)
  db.run(`CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT,
    photo TEXT,
    bio TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Galeri foto
  db.run(`CREATE TABLE IF NOT EXISTS gallery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image TEXT NOT NULL,
    caption TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // migrasi ringan (abaikan error jika sudah ada)
  db.run(`ALTER TABLE reports ADD COLUMN cover TEXT`, () => {});
  db.run(`ALTER TABLE reports ADD COLUMN pdf_url TEXT`, () => {});
  db.run(`ALTER TABLE members ADD COLUMN bio TEXT`, () => {});
});

/* --------------------- Cloudinary config --------------------- */
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/* -------------------- Multer (images only) ------------------- */
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

/* ------------------------- Middleware ------------------------ */
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// CSP
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    ["frame-src 'self'", "child-src 'self'", "object-src 'none'"].join("; ")
  );
  next();
});

/* ---------------------- Basic Auth /admin -------------------- */
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

/* --------------------------- Helpers ------------------------- */
// Normalize Google Drive link -> direct download
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

/* --------------------------- Routes -------------------------- */
app.get("/health", (req, res) => res.status(200).send("OK"));

app.get("/diag/cloudinary", (req, res) => {
  const cfg = cloudinary.config();
  res.json({
    cloud_name: cfg.cloud_name,
    api_key_present: !!cfg.api_key,
    api_secret_present: !!cfg.api_secret,
  });
});

/* ------------------------------ HOME ------------------------------ */
app.get("/", (req, res) => {
  db.all("SELECT * FROM banners ORDER BY id DESC LIMIT 10", [], (e1, banners = []) => {
    db.all("SELECT * FROM articles ORDER BY id DESC LIMIT 6", [], (e2, arts = []) => {
      res.render("home", { title: "AGUDASCO – Beranda", banners, arts });
    });
  });
});

/* --------------------------- ARTIKEL -------------------------- */
app.get("/artikel", (req, res) => {
  db.all("SELECT * FROM articles ORDER BY id DESC", [], (err, articles = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("articles", { title: "Artikel", articles });
  });
});

app.get("/artikel/:id", (req, res) => {
  db.get("SELECT * FROM articles WHERE id = ?", [req.params.id], (err, article) => {
    if (err) return res.status(500).send(err.message);
    if (!article) return res.status(404).send("Artikel tidak ditemukan");
    res.render("article_view", { title: article.title, article });
  });
});

/* --------------------------- LAPORAN ------------------------- */
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
    const fixed = { ...report, pdf_url: normalizePdfUrl(report.pdf_url) };
    res.render("report_view", { title: report.title, report: fixed });
  });
});

/* ---------------------------- AD/ART -------------------------- */
app.get("/adart", (req, res) => {
  db.all("SELECT * FROM adart ORDER BY id DESC", [], (err, adarts = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("adart", { title: "AD/ART", adarts });
  });
});
app.get("/adart/:id", (req, res) => {
  db.get("SELECT * FROM adart WHERE id = ?", [req.params.id], (err, item) => {
    if (err) return res.status(500).send(err.message);
    if (!item) return res.status(404).send("Dokumen tidak ditemukan");
    const fixed = { ...item, pdf_url: normalizePdfUrl(item.pdf_url) };
    res.render("adart_view", { title: item.title, item: fixed });
  });
});

/* ---------------------------- ANGGOTA ------------------------- */
app.get("/anggota", (req, res) => {
  db.all("SELECT * FROM members ORDER BY id DESC", [], (err, members = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("members", { title: "Anggota", members });
  });
});

/* ----------------------------- GALERI ------------------------- */
app.get("/galeri", (req, res) => {
  db.all("SELECT * FROM gallery ORDER BY id DESC", [], (err, photos = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("gallery", { title: "Galeri", photos });
  });
});

/* ----------------------- TENTANG & KONTAK --------------------- */
app.get("/tentang", (req, res) => res.render("about", { title: "Tentang Kami" }));
app.get("/kontak", (req, res) => res.render("contact", { title: "Kontak" }));

/* ---------------------------- ADMIN --------------------------- */
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

// AD/ART
app.get("/admin/adart", (req, res) => {
  db.all("SELECT * FROM adart ORDER BY id DESC", [], (err, adarts = []) => {
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
    "INSERT INTO adart (title, cover, pdf_url) VALUES (?, ?, ?)",
    [title.trim(), cover, fixedPdf],
    (err) => {
      if (err) return res.status(500).send(err.message);
      res.redirect("/admin/adart");
    }
  );
});
app.post("/admin/adart/:id/delete", (req, res) => {
  db.run("DELETE FROM adart WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect("/admin/adart");
  });
});

// Anggota
app.get("/admin/members", (req, res) => {
  db.all("SELECT * FROM members ORDER BY id DESC", [], (err, members = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("admin/members", { title: "Kelola Anggota", members });
  });
});
app.post("/admin/members", uploadImage.single("photo"), (req, res) => {
  const { name, role, bio } = req.body;
  const photo = req.file ? req.file.path : null;
  if (!name) return res.status(400).send("Nama wajib diisi");
  db.run(
    "INSERT INTO members (name, role, photo, bio) VALUES (?, ?, ?, ?)",
    [name.trim(), (role || "").trim(), photo, (bio || "").trim()],
    (err) => {
      if (err) return res.status(500).send(err.message);
      res.redirect("/admin/members");
    }
  );
});
app.post("/admin/members/:id/delete", (req, res) => {
  db.run("DELETE FROM members WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect("/admin/members");
  });
});

// Galeri
app.get("/admin/gallery", (req, res) => {
  db.all("SELECT * FROM gallery ORDER BY id DESC", [], (err, photos = []) => {
    if (err) return res.status(500).send(err.message);
    res.render("admin/gallery", { title: "Kelola Galeri", photos });
  });
});
app.post("/admin/gallery", uploadImage.single("image"), (req, res) => {
  const { caption } = req.body;
  const image = req.file ? req.file.path : null;
  if (!image) return res.status(400).send("Gambar wajib diunggah");
  db.run(
    "INSERT INTO gallery (image, caption) VALUES (?, ?)",
    [image, (caption || "").trim()],
    (err) => {
      if (err) return res.status(500).send(err.message);
      res.redirect("/admin/gallery");
    }
  );
});
app.post("/admin/gallery/:id/delete", (req, res) => {
  db.run("DELETE FROM gallery WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).send(err.message);
    res.redirect("/admin/gallery");
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
