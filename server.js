// server.js
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
// ❌ (hapus) import sqlite3 from "sqlite3";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

// ✅ Postgres (Neon)
import pkg from "pg";
const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/* ------------------------------------------------------------------
   DB (Postgres / Neon)
------------------------------------------------------------------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // diperlukan untuk Neon
});

// helper query
async function q(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows;
}
async function q1(sql, params = []) {
  const { rows } = await pool.query(sql, params);
  return rows[0] || null;
}

// (opsional) bootstrap tabel agar aman di env baru
async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS articles (
      id         BIGSERIAL PRIMARY KEY,
      title      TEXT NOT NULL,
      content    TEXT,
      image      TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_articles_created_at ON articles (created_at DESC);

    CREATE TABLE IF NOT EXISTS banners (
      id         BIGSERIAL PRIMARY KEY,
      image      TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS reports (
      id         BIGSERIAL PRIMARY KEY,
      title      TEXT NOT NULL,
      cover      TEXT,
      pdf_url    TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS adarts (
      id         BIGSERIAL PRIMARY KEY,
      title      TEXT NOT NULL,
      cover      TEXT,
      pdf_url    TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
ensureTables().catch((e) => {
  console.error("ensureTables error:", e);
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

// aset statis di /public
app.use("/public", express.static(path.join(__dirname, "public")));

// View engine
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// build id untuk cache busting
app.locals.buildId = process.env.RAILWAY_GIT_COMMIT_SHA || Date.now().toString();
app.use((req, res, next) => {
  res.locals.buildId = app.locals.buildId;
  res.locals.active = res.locals.active || "";
  res.locals.title = res.locals.title || "AGUDASCO";
  next();
});

// CSP (longgar agar Cloudinary bisa load)
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

// render aman fallback
function renderSafe(res, viewName, props = {}) {
  const full = path.join(__dirname, "views", `${viewName}.ejs`);
  if (fs.existsSync(full)) return res.render(viewName, props);
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

app.get("/", async (req, res) => {
  try {
    const banners = await q("SELECT * FROM banners ORDER BY id DESC LIMIT 10");
    const arts = await q("SELECT * FROM articles ORDER BY id DESC LIMIT 6");
    res.render("home", {
      title: "AGUDASCO – Beranda",
      active: "home",
      banners,
      arts,
    });
  } catch (err) {
    console.error("Home error:", err);
    res.status(500).send("Server error");
  }
});

/* ---- Artikel ---- */
app.get("/artikel", async (req, res) => {
  try {
    const articles = await q("SELECT * FROM articles ORDER BY id DESC");
    res.render("articles", { title: "Artikel", active: "artikel", articles });
  } catch (err) {
    console.error("Artikel list error:", err);
    res.status(500).send("Server error");
  }
});

app.get("/artikel/:id", async (req, res) => {
  try {
    const article = await q1("SELECT * FROM articles WHERE id = $1", [req.params.id]);
    if (!article) return res.status(404).send("Artikel tidak ditemukan");
    res.render("article_view", { title: article.title, active: "artikel", article });
  } catch (err) {
    console.error("Artikel view error:", err);
    res.status(500).send("Server error");
  }
});

/* ---- Laporan ---- */
app.get("/laporan", async (req, res) => {
  try {
    const reports = await q("SELECT * FROM reports ORDER BY id DESC");
    res.render("reports", { title: "Laporan Keuangan", active: "laporan", reports });
  } catch (err) {
    console.error("Laporan list error:", err);
    res.status(500).send("Server error");
  }
});

app.get("/laporan/:id", async (req, res) => {
  try {
    const report = await q1("SELECT * FROM reports WHERE id = $1", [req.params.id]);
    if (!report) return res.status(404).send("Laporan tidak ditemukan");
    const fixed = { ...report, pdf_url: normalizePdfUrl(report.pdf_url) };
    res.render("report_view", { title: report.title, active: "laporan", report: fixed });
  } catch (err) {
    console.error("Laporan view error:", err);
    res.status(500).send("Server error");
  }
});

/* ---- AD/ART (public) ---- */
app.get("/adart", async (req, res) => {
  try {
    const adarts = await q("SELECT * FROM adarts ORDER BY id DESC");
    res.render("adart", { title: "AD/ART", active: "adart", adarts });
  } catch (err) {
    console.error("ADART list error:", err);
    res.status(500).send("Server error");
  }
});

app.get("/adart/:id", async (req, res) => {
  try {
    const item = await q1("SELECT * FROM adarts WHERE id = $1", [req.params.id]);
    if (!item) return res.status(404).send("Dokumen AD/ART tidak ditemukan");
    const fixed = { ...item, pdf_url: normalizePdfUrl(item.pdf_url) };
    res.render("adart_view", { title: item.title, active: "adart", item: fixed });
  } catch (err) {
    console.error("ADART view error:", err);
    res.status(500).send("Server error");
  }
});

/* ---- Menu statis ---- */
app.get("/anggota", (req, res) =>
  renderSafe(res, "anggota", { title: "Anggota", active: "anggota", anggota: [] })
);
app.get("/galeri", (req, res) =>
  renderSafe(res, "galeri", { title: "Galeri", active: "galeri", fotos: [] })
);
app.get("/tentang", (req, res) =>
  renderSafe(res, "tentang", { title: "Tentang", active: "tentang" })
);
app.get("/kontak", (req, res) =>
  renderSafe(res, "kontak", { title: "Kontak", active: "kontak" })
);

/* ------------------------------------------------------------------
   Routes – Admin
------------------------------------------------------------------- */
app.get("/admin", (req, res) => res.render("admin/dashboard", { title: "Dashboard" }));

// Admin: Artikel
app.get("/admin/articles", async (req, res) => {
  try {
    const articles = await q("SELECT * FROM articles ORDER BY id DESC");
    res.render("admin/articles", { title: "Kelola Artikel", articles });
  } catch (err) {
    console.error("Admin list articles error:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/articles", uploadImage.single("image"), async (req, res) => {
  try {
    const { title, content } = req.body;
    const image = req.file ? req.file.path : null;
    if (!title) return res.status(400).send("Judul wajib diisi");

    await q(
      "INSERT INTO articles (title, content, image) VALUES ($1, $2, $3)",
      [title.trim(), content || "", image]
    );
    res.redirect("/admin/articles");
  } catch (err) {
    console.error("Admin create article error:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/articles/:id/delete", async (req, res) => {
  try {
    await q("DELETE FROM articles WHERE id = $1", [req.params.id]);
    res.redirect("/admin/articles");
  } catch (err) {
    console.error("Admin delete article error:", err);
    res.status(500).send("Server error");
  }
});

// Admin: Banner
app.get("/admin/banners", async (req, res) => {
  try {
    const banners = await q("SELECT * FROM banners ORDER BY id DESC");
    res.render("admin/banners", { title: "Kelola Banner", banners });
  } catch (err) {
    console.error("Admin list banners error:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/banners", uploadImage.single("image"), async (req, res) => {
  try {
    const image = req.file ? req.file.path : null;
    if (!image) return res.status(400).send("File gambar belum dipilih");

    await q("INSERT INTO banners (image) VALUES ($1)", [image]);
    res.redirect("/admin/banners");
  } catch (err) {
    console.error("Admin create banner error:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/banners/:id/delete", async (req, res) => {
  try {
    await q("DELETE FROM banners WHERE id = $1", [req.params.id]);
    res.redirect("/admin/banners");
  } catch (err) {
    console.error("Admin delete banner error:", err);
    res.status(500).send("Server error");
  }
});

// Admin: Reports
app.get("/admin/reports", async (req, res) => {
  try {
    const reports = await q("SELECT * FROM reports ORDER BY id DESC");
    res.render("admin/reports", { title: "Kelola Laporan", reports });
  } catch (err) {
    console.error("Admin list reports error:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/reports", uploadImage.single("cover"), async (req, res) => {
  try {
    const { title, pdf_url } = req.body;
    const cover = req.file ? req.file.path : null;
    if (!title) return res.status(400).send("Judul wajib diisi");

    const fixedPdf = normalizePdfUrl(pdf_url || "");
    await q(
      "INSERT INTO reports (title, cover, pdf_url) VALUES ($1, $2, $3)",
      [title.trim(), cover, fixedPdf]
    );
    res.redirect("/admin/reports");
  } catch (err) {
    console.error("Admin create report error:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/reports/:id/delete", async (req, res) => {
  try {
    await q("DELETE FROM reports WHERE id = $1", [req.params.id]);
    res.redirect("/admin/reports");
  } catch (err) {
    console.error("Admin delete report error:", err);
    res.status(500).send("Server error");
  }
});

// Admin: AD/ART
app.get("/admin/adart", async (req, res) => {
  try {
    const adarts = await q("SELECT * FROM adarts ORDER BY id DESC");
    res.render("admin/adart", { title: "Kelola AD/ART", adarts });
  } catch (err) {
    console.error("Admin list adart error:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/adart", uploadImage.single("cover"), async (req, res) => {
  try {
    const { title, pdf_url } = req.body;
    const cover = req.file ? req.file.path : null;
    if (!title) return res.status(400).send("Judul wajib diisi");

    const fixedPdf = normalizePdfUrl(pdf_url || "");
    await q(
      "INSERT INTO adarts (title, cover, pdf_url) VALUES ($1, $2, $3)",
      [title.trim(), cover, fixedPdf]
    );
    res.redirect("/admin/adart");
  } catch (err) {
    console.error("Admin create adart error:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/adart/:id/delete", async (req, res) => {
  try {
    await q("DELETE FROM adarts WHERE id = $1", [req.params.id]);
    res.redirect("/admin/adart");
  } catch (err) {
    console.error("Admin delete adart error:", err);
    res.status(500).send("Server error");
  }
});

/* ------------------------------------------------------------------
   404 & Error handlers
------------------------------------------------------------------- */
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

/* ------------------------------------------------------------------
   ANGGOTA – PUBLIC PAGES
------------------------------------------------------------------- */

/** List publik: /anggota */
app.get("/anggota", async (req, res) => {
  try {
    const { rows: members } = await pool.query(
      "SELECT id, name, avatar, created_at FROM members ORDER BY name ASC"
    );
    res.render("members", {
      title: "Anggota",
      active: "anggota",
      members
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Gagal memuat anggota");
  }
});

/** Detail publik: /anggota/:id */
app.get("/anggota/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const { rows: mrows } = await pool.query("SELECT * FROM members WHERE id=$1", [id]);
    if (!mrows.length) return res.status(404).send("Anggota tidak ditemukan");

    const member = mrows[0];
    const { rows: families } = await pool.query(
      "SELECT id, fullname, relation FROM member_families WHERE member_id=$1 ORDER BY id ASC",
      [id]
    );
    const { rows: photos } = await pool.query(
      "SELECT id, image_url, caption FROM member_photos WHERE member_id=$1 ORDER BY id DESC",
      [id]
    );

    res.render("member_view", {
      title: member.name,
      active: "anggota",
      member,
      families,
      photos
    });
  } catch (e) {
    console.error(e);
    res.status(500).send("Gagal memuat detail anggota");
  }
});

/* ------------------------------------------------------------------
   ANGGOTA – ADMIN PAGES  (dilindungi Basic Auth via /admin middleware)
------------------------------------------------------------------- */

/** Admin list + form tambah anggota */
app.get("/admin/members", async (req, res) => {
  try {
    const { rows: members } = await pool.query(
      "SELECT id, name, avatar, created_at FROM members ORDER BY created_at DESC"
    );
    res.render("admin/members", { title: "Kelola Anggota", members });
  } catch (e) {
    console.error(e);
    res.status(500).send("Gagal memuat anggota");
  }
});

/** Create anggota (name + avatar image) */
app.post("/admin/members", uploadImage.single("avatar"), async (req, res) => {
  const { name, bio } = req.body;
  const avatar = req.file ? req.file.path : null;
  if (!name) return res.status(400).send("Nama wajib diisi");

  try {
    await pool.query(
      "INSERT INTO members (name, avatar, bio) VALUES ($1,$2,$3)",
      [name.trim(), avatar, bio || ""]
    );
    res.redirect("/admin/members");
  } catch (e) {
    console.error(e);
    res.status(500).send("Gagal menambah anggota");
  }
});

/** Hapus anggota */
app.post("/admin/members/:id/delete", async (req, res) => {
  try {
    await pool.query("DELETE FROM members WHERE id=$1", [Number(req.params.id)]);
    res.redirect("/admin/members");
  } catch (e) {
    console.error(e);
    res.status(500).send("Gagal menghapus anggota");
  }
});

/** Halaman kelola 1 anggota: keluarga + foto */
app.get("/admin/members/:id", async (req, res) => {
  const id = Number(req.params.id);
  try {
    const { rows: mrows } = await pool.query("SELECT * FROM members WHERE id=$1", [id]);
    if (!mrows.length) return res.status(404).send("Anggota tidak ditemukan");
    const member = mrows[0];

    const { rows: families } = await pool.query(
      "SELECT * FROM member_families WHERE member_id=$1 ORDER BY id ASC",
      [id]
    );
    const { rows: photos } = await pool.query(
      "SELECT * FROM member_photos WHERE member_id=$1 ORDER BY id DESC",
      [id]
    );

    res.render("admin/member_detail", { title: `Kelola: ${member.name}`, member, families, photos });
  } catch (e) {
    console.error(e);
    res.status(500).send("Gagal memuat data anggota");
  }
});

/** Tambah keluarga */
app.post("/admin/members/:id/family", async (req, res) => {
  const memberId = Number(req.params.id);
  const { fullname, relation } = req.body;
  if (!fullname) return res.status(400).send("Nama keluarga wajib diisi");

  try {
    await pool.query(
      "INSERT INTO member_families (member_id, fullname, relation) VALUES ($1,$2,$3)",
      [memberId, fullname.trim(), (relation || "").trim()]
    );
    res.redirect(`/admin/members/${memberId}`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Gagal menambah keluarga");
  }
});

/** Hapus keluarga */
app.post("/admin/members/:id/family/:fid/delete", async (req, res) => {
  const memberId = Number(req.params.id);
  const fid = Number(req.params.fid);
  try {
    await pool.query("DELETE FROM member_families WHERE id=$1 AND member_id=$2", [fid, memberId]);
    res.redirect(`/admin/members/${memberId}`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Gagal menghapus data keluarga");
  }
});

/** Upload foto anggota */
app.post("/admin/members/:id/photo", uploadImage.single("photo"), async (req, res) => {
  const memberId = Number(req.params.id);
  const { caption } = req.body;
  const imageUrl = req.file ? req.file.path : null;
  if (!imageUrl) return res.status(400).send("Foto belum dipilih");

  try {
    await pool.query(
      "INSERT INTO member_photos (member_id, image_url, caption) VALUES ($1,$2,$3)",
      [memberId, imageUrl, caption || ""]
    );
    res.redirect(`/admin/members/${memberId}`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Gagal menambah foto");
  }
});

/** Hapus foto anggota */
app.post("/admin/members/:id/photo/:pid/delete", async (req, res) => {
  const memberId = Number(req.params.id);
  const pid = Number(req.params.pid);
  try {
    await pool.query("DELETE FROM member_photos WHERE id=$1 AND member_id=$2", [pid, memberId]);
    res.redirect(`/admin/members/${memberId}`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Gagal menghapus foto");
  }
});
