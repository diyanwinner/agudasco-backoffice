import { sanitizeContent } from "./lib/sanitizer.js";
import express from "express";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import bcrypt from "bcrypt";
import methodOverride from "method-override";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import fs from "fs";
import ejsMate from "ejs-mate";

// === Cloudinary (akan terpakai saat online) ===
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// === DB ===
const DATA_DIR = process.env.DATA_DIR || __dirname; // Render bisa set DATA_DIR=/var/data
let db;
async function initDB() {
  db = await open({
    filename: path.join(DATA_DIR, "data.sqlite"),
    driver: sqlite3.Database,
  });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT UNIQUE,
      password_hash TEXT,
      role TEXT DEFAULT 'EDITOR'
    );
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE,
      content TEXT,
      cover_image TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      published INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT,
      originalname TEXT,
      mimetype TEXT,
      size INTEGER,
      url TEXT,
      public_id TEXT,
      uploaded_at TEXT DEFAULT (datetime('now'))
    );
  `);
}
await initDB();

// === View engine & middleware ===
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));
app.use(methodOverride("_method"));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "agudasco-secret",
    resave: false,
    saveUninitialized: false,
  })
);

app.use("/public", express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// pastikan folder uploads ada (untuk fallback lokal)
fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });

// === Multer storage: Cloudinary jika kredensial ada, kalau tidak fallback ke disk ===
let storage;
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  storage = new CloudinaryStorage({
    cloudinary,
    params: (req, file) => ({
      folder: "agudasco",
      allowed_formats: ["jpg","jpeg","png","webp"],
      public_id: Date.now() + "_" + file.originalname.replace(/[^\w.-]+/g, "_"),
      transformation: [{ quality: "auto", fetch_format: "auto" }],
    }),
  });
  console.log("Using Cloudinary storage");
} else {
  storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads")),
    filename: (req, file, cb) => {
      const time = Date.now();
      const safe = file.originalname.replace(/[^\w.\-]+/g, "_");
      cb(null, `${time}_${safe}`);
    },
  });
  console.log("Using local disk storage");
}
const upload = multer({ storage });

// === Auth helpers ===
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect("/admin/login");
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.redirect("/admin/login");
  if (req.session.user.role !== "ADMIN") return res.status(403).send("Forbidden");
  next();
}

// === Public site ===
app.get("/", async (req, res) => {
  const arts = await db.all("SELECT * FROM articles WHERE published = 1 ORDER BY created_at DESC LIMIT 10");
  res.render("public/home", { title: "AGUDASCO – Beranda", arts });
});
app.get("/article/:slug", async (req, res) => {
  const art = await db.get("SELECT * FROM articles WHERE slug = ?", req.params.slug);
  if (!art || !art.published) return res.status(404).send("Not found");
  res.render("public/article", { title: `${art.title} – AGUDASCO`, art });
});

// Public APIs
app.get("/api/articles", async (req, res) => {
  const rows = await db.all("SELECT * FROM articles WHERE published = 1 ORDER BY created_at DESC");
  res.json(rows);
});
app.get("/api/media", async (req, res) => {
  const rows = await db.all("SELECT * FROM media ORDER BY uploaded_at DESC");
  res.json(rows);
});

// === Admin ===
app.get("/admin/login", (req, res) => {
  res.render("admin/login", { title: "Login – AGUDASCO", error: null });
});
app.post("/admin/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await db.get("SELECT * FROM users WHERE email = ?", email);
  if (!user) return res.render("admin/login", { title: "Login – AGUDASCO", error: "User not found" });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.render("admin/login", { title: "Login – AGUDASCO", error: "Wrong password" });
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  res.redirect("/admin");
});
app.post("/admin/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/admin/login"));
});

app.get("/admin", requireAuth, async (req, res) => {
  const stats = {
    articles: (await db.get("SELECT COUNT(*) as c FROM articles")).c,
    media: (await db.get("SELECT COUNT(*) as c FROM media")).c,
  };
  res.render("admin/dashboard", { title: "Dashboard – AGUDASCO", user: req.session.user, stats });
});

// === Articles CRUD ===
function slugify(text) {
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, "-").replace(/[^\w\-]+/g, "").replace(/\-\-+/g, "-");
}
app.get("/admin/articles", requireAuth, async (req, res) => {
  const rows = await db.all("SELECT * FROM articles ORDER BY created_at DESC");
  res.render("admin/articles/index", { title: "Artikel – AGUDASCO", rows, user: req.session.user });
});
app.get("/admin/articles/new", requireAuth, (req, res) => {
  res.render("admin/articles/new", { title: "Artikel Baru – AGUDASCO", user: req.session.user });
});
app.post("/admin/articles", requireAuth, async (req, res) => {
  const { title, content, published } = req.body;
  const slug = slugify(title);
  await db.run(
    "INSERT INTO articles (title, slug, content, published) VALUES (?,?,?,?)",
    title, slug, content, published ? 1 : 0
  );
  res.redirect("/admin/articles");
});
app.get("/admin/articles/:id/edit", requireAuth, async (req, res) => {
  const art = await db.get("SELECT * FROM articles WHERE id = ?", req.params.id);
  if (!art) return res.status(404).send("Not found");
  res.render("admin/articles/edit", { title: "Edit Artikel – AGUDASCO", art, user: req.session.user });
});
app.post("/admin/articles/:id", requireAuth, async (req, res) => {
  const { title, content, published } = req.body;
  const slug = slugify(title);
  await db.run(
    "UPDATE articles SET title=?, slug=?, content=?, published=?, updated_at=datetime('now') WHERE id=?",
    title, slug, content, published ? 1 : 0, req.params.id
  );
  res.redirect("/admin/articles");
});
app.post("/admin/articles/:id/delete", requireAuth, async (req, res) => {
  await db.run("DELETE FROM articles WHERE id = ?", req.params.id);
  res.redirect("/admin/articles");
});

// === Media ===
app.get("/admin/media", requireAuth, async (req, res) => {
  const rows = await db.all("SELECT * FROM media ORDER BY uploaded_at DESC");
  res.render("admin/media/index", { title: "Media – AGUDASCO", rows, user: req.session.user });
});
app.post("/admin/media/upload", requireAuth, upload.single("file"), async (req, res) => {
  const f = req.file;
  await db.run(
    "INSERT INTO media (filename, originalname, mimetype, size, url, public_id) VALUES (?,?,?,?,?,?)",
    f.filename, f.originalname || "", f.mimetype || "", f.size || 0,
    f.path || null, f.filename || null
  );
  res.redirect("/admin/media");
});
app.post("/admin/media/:id/delete", requireAuth, async (req, res) => {
  const row = await db.get("SELECT * FROM media WHERE id = ?", req.params.id);
  if (row) {
    try {
      if (row.public_id) {
        await cloudinary.uploader.destroy(row.public_id);
      } else if (row.filename) {
        const p = path.join(__dirname, "uploads", row.filename);
        try { await fs.promises.unlink(p); } catch {}
      }
      await db.run("DELETE FROM media WHERE id = ?", req.params.id);
    } catch (e) { console.error(e); }
  }
  res.redirect("/admin/media");
});

// === Users (admin only) ===
app.get("/admin/users", requireAdmin, async (req, res) => {
  const rows = await db.all("SELECT id,name,email,role FROM users ORDER BY id DESC");
  res.render("admin/users/index", { title: "Pengguna – AGUDASCO", rows, user: req.session.user });
});
app.get("/admin/users/new", requireAdmin, (req, res) => {
  res.render("admin/users/new", { title: "Tambah Pengguna – AGUDASCO", user: req.session.user });
});
app.post("/admin/users", requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;
  const hash = await bcrypt.hash(password, 10);
  await db.run(
    "INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)",
    name, email, hash, role || "EDITOR"
  );
  res.redirect("/admin/users");
});

app.listen(PORT, () => {
  console.log(`AGUDASCO backoffice running on port ${PORT}`);
});
