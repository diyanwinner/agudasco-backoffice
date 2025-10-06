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

// -------- DB --------
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

// -------- Cloudinary --------
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "agudasco",
    allowed_formats: ["jpg", "png", "jpeg", "pdf", "docx", "xlsx"]
  }
});
const upload = multer({ storage });

// -------- Middleware --------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// -------- Public Routes --------
app.get("/", (req, res) => {
  db.all("SELECT * FROM banners ORDER BY id DESC LIMIT 10", [], (e1, banners = []) => {
    db.all("SELECT * FROM articles ORDER BY id DESC LIMIT 6", [], (e2, arts = []) => {
      res.render("home", { title: "AGUDASCO – Beranda", banners, arts });
    });
  });
});

app.get("/article/:id", (req, res) => {
  db.get("SELECT * FROM articles WHERE id = ?", [req.params.id], (err, article) => {
    if (!article) return res.status(404).send("Artikel tidak ditemukan");
    res.render("article", { title: article.title, article });
  });
});

app.get("/laporan", (req, res) => {
  db.all("SELECT * FROM reports ORDER BY id DESC", [], (err, reports = []) => {
    res.render("reports", { title: "Laporan Keuangan", reports });
  });
});

// -------- Admin Routes --------
app.get("/admin", (req, res) => res.render("admin/dashboard", { title: "Dashboard" }));

// Artikel
app.get("/admin/articles", (req, res) => {
  db.all("SELECT * FROM articles ORDER BY id DESC", [], (err, articles = []) => {
    res.render("admin/articles", { title: "Kelola Artikel", articles });
  });
});
app.post("/admin/articles", upload.single("image"), (req, res) => {
  const { title, content } = req.body;
  const image = req.file ? req.file.path : null;
  db.run("INSERT INTO articles (title, content, image) VALUES (?, ?, ?)", [title, content, image], () => {
    res.redirect("/admin/articles");
  });
});
app.post("/admin/articles/:id/delete", (req, res) => {
  db.run("DELETE FROM articles WHERE id = ?", [req.params.id], () => res.redirect("/admin/articles"));
});

// Banner
app.get("/admin/banners", (req, res) => {
  db.all("SELECT * FROM banners ORDER BY id DESC", [], (err, banners = []) => {
    res.render("admin/banners", { title: "Kelola Banner", banners });
  });
});
app.post("/admin/banners", upload.single("image"), (req, res) => {
  const image = req.file ? req.file.path : null;
  if (!image) return res.redirect("/admin/banners");
  db.run("INSERT INTO banners (image) VALUES (?)", [image], () => res.redirect("/admin/banners"));
});
app.post("/admin/banners/:id/delete", (req, res) => {
  db.run("DELETE FROM banners WHERE id = ?", [req.params.id], () => res.redirect("/admin/banners"));
});

// Laporan
app.get("/admin/reports", (req, res) => {
  db.all("SELECT * FROM reports ORDER BY id DESC", [], (err, reports = []) => {
    res.render("admin/reports", { title: "Kelola Laporan", reports });
  });
});
app.post("/admin/reports", upload.single("file"), (req, res) => {
  const { title } = req.body;
  const file = req.file ? req.file.path : null;
  if (!title || !file) return res.redirect("/admin/reports");
  db.run("INSERT INTO reports (title, file) VALUES (?, ?)", [title, file], () => res.redirect("/admin/reports"));
});
app.post("/admin/reports/:id/delete", (req, res) => {
  db.run("DELETE FROM reports WHERE id = ?", [req.params.id], () => res.redirect("/admin/reports"));
});

// -------- Start --------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
