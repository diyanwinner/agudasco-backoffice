import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import pkg from "pg";
const { Pool } = pkg;

// Error handlers
process.on("uncaughtException", (err) => {
  console.error("Uncaught:", err?.message || String(err));
});
process.on("unhandledRejection", (reason) => {
  console.error("UnhandledRejection:", reason?.message || String(reason));
});

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.set("trust proxy", true);

// === DATABASE ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const q  = async (sql, params = []) => (await pool.query(sql, params)).rows;
const q1 = async (sql, params = []) => (await pool.query(sql, params)).rows[0] || null;

// === CLOUDINARY ===
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

// === MIDDLEWARE ===
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(express.json({ limit: "5mb" }));
app.use("/public", express.static(path.join(__dirname, "public"), { maxAge: "7d", immutable: true }));
app.use("/docs", express.static(path.join(__dirname, "public", "docs"), { maxAge: "7d", immutable: true }));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// Locals
app.locals.buildId = process.env.RAILWAY_GIT_COMMIT_SHA || Date.now().toString();
app.locals.CLOUD_BASE = process.env.CLOUDINARY_CLOUD_NAME ? `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}` : "";

app.use((req, res, next) => {
  res.locals.buildId = app.locals.buildId;
  res.locals.active = "";
  res.locals.title = "AGUDASCO";
  res.locals.CLOUD_BASE = app.locals.CLOUD_BASE;
  res.locals.showWhatsAppFloat = !req.path.startsWith("/admin");
  res.locals.waNumber = (process.env.WHATSAPP_NUMBER || "62895340169646").replace(/\D/g, "");
  res.locals.waText = process.env.WHATSAPP_TEXT || "Halo Admin, saya ingin mengajukan saran.";
  next();
});

// Footer loader
app.use(async (_req, res, next) => {
  try {
    res.locals.footerContact = await q1("SELECT * FROM site_info WHERE id=1") || {};
  } catch (e) {
    res.locals.footerContact = {};
  }
  next();
});

/* ============================================================
   AUTHENTICATION SYSTEM (SI SATPAM)
============================================================ */

// 1. Middleware Pengecekan
function checkAuth(req, res, next) {
  const cookie = req.headers.cookie || "";
  if (cookie.includes("admin_session=true")) {
    return next();
  }
  return res.redirect("/login");
}

// 2. Route Login
app.get("/login", (req, res) => {
  const cookie = req.headers.cookie || "";
  // Kalau sudah login, lempar ke Dashboard
  if (cookie.includes("admin_session=true")) return res.redirect("/admin");

  // Render halaman login (layout: false biar full screen gak ada header web)
  res.render("login", { 
    title: "Login Admin", 
    layout: false, 
    error: null 
  });
});

// 3. Proses Login
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USERNAME || "admin";
  const validPass = process.env.ADMIN_PASSWORD || "admin";

  if (username === validUser && password === validPass) {
    // Set Cookie 1 Hari
    res.setHeader("Set-Cookie", "admin_session=true; HttpOnly; Path=/; Max-Age=86400");
    // REDIRECT KE DASHBOARD (/admin)
    return res.redirect("/admin");
  } else {
    res.render("login", { 
      title: "Login Admin", 
      layout: false,
      error: "Username atau Password salah!"
    });
  }
});

// 4. Logout
app.get("/logout", (req, res) => {
  res.setHeader("Set-Cookie", "admin_session=; HttpOnly; Path=/; Max-Age=0");
  res.redirect("/login");
});

/* === ROUTE DASHBOARD (VERSI PASTI JALAN) === */
app.get("/admin", checkAuth, async (req, res) => {
  try {
    // 1. Ambil semua data member dulu (biar server yang pilih-pilih)
    const allMembers = await q("SELECT * FROM members");
    
    // 2. Kita filter pake Javascript aja (Lebih aman dari error SQL)
    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);

    const upcomingBirthdays = allMembers.filter(member => {
      if (!member.birthdate) return false;

      // Konversi tanggal lahir member
      const bdate = new Date(member.birthdate);
      const thisYearBirthday = new Date(today.getFullYear(), bdate.getMonth(), bdate.getDate());

      // Cek apakah ulang tahunnya antara hari ini sampai 7 hari kedepan
      // (Kita handle juga kalo ulang tahunnya nyebrang tahun, misal 31 Des ke 1 Jan)
      if (thisYearBirthday < today) {
         thisYearBirthday.setFullYear(today.getFullYear() + 1);
      }
      
      // Hitung selisih waktu
      const diffTime = thisYearBirthday - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

      // Tambahin label 'is_today' biar di dashboard muncul label merahnya
      if (diffDays === 0) {
        member.is_today = true;
        return true;
      } else if (diffDays > 0 && diffDays <= 7) {
        member.is_today = false;
        return true;
      }
      return false;
    });

    // 3. Render Dashboard
    res.render("dashboard", { 
      title: "Dashboard Admin",
      upcomingBirthdays: upcomingBirthdays,
      layout: "layout" 
    });

  } catch (err) {
    console.error("Dashboard Error:", err);
    // Kalau masih error parah, tampilin dashboard kosong aja daripada crash
    res.render("dashboard", { 
      title: "Dashboard Admin",
      upcomingBirthdays: [],
      layout: "layout" 
    });
  }
});

/* ============================================================
   ROUTES GALERI & LAINNYA
============================================================ */
// ... (Route galeri kamu yang lama tetap jalan disini) ...

// DAFTAR ALBUM
app.get("/admin/galeri", checkAuth, async (req, res) => {
  try {
    const sql = `SELECT a.*, (SELECT COUNT(*) FROM gallery_photos WHERE album_id = a.id) as photo_count FROM albums a ORDER BY event_date DESC`;
    const albums = await q(sql);
    res.render("admin/galeri/index", { title: "Kelola Galeri", albums });
  } catch (err) { res.status(500).send("Error galeri"); }
});

// CREATE ALBUM
app.post("/admin/galeri/create", checkAuth, uploadImage.single("cover"), async (req, res) => {
  try {
    const { title, event_date, description } = req.body;
    const cover = req.file ? req.file.path : null;
    await pool.query(`INSERT INTO albums (title, event_date, description, cover_image) VALUES ($1, $2, $3, $4)`, [title, event_date, description, cover]);
    res.redirect("/admin/galeri");
  } catch (err) { res.status(500).send("Error create"); }
});

// DELETE ALBUM
app.get("/admin/galeri/delete/:id", checkAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM albums WHERE id = $1", [req.params.id]);
    res.redirect("/admin/galeri");
  } catch (err) { res.status(500).send("Error delete"); }
});

// DETAIL ALBUM
app.get("/admin/galeri/:id/photos", checkAuth, async (req, res) => {
  try {
    const album = await q1("SELECT * FROM albums WHERE id = $1", [req.params.id]);
    const photos = await q("SELECT * FROM gallery_photos WHERE album_id = $1 ORDER BY id DESC", [req.params.id]);
    if (!album) return res.status(404).send("Not Found");
    res.render("admin/galeri/photos", { title: album.title, album, photos });
  } catch (err) { res.status(500).send("Error detail"); }
});

// UPLOAD PHOTOS
app.post("/admin/galeri/:id/upload", checkAuth, uploadImage.array("photos"), async (req, res) => {
  try {
    if (req.files) {
      for (const file of req.files) await pool.query("INSERT INTO gallery_photos (album_id, image_url) VALUES ($1, $2)", [req.params.id, file.path]);
    }
    res.redirect(`/admin/galeri/${req.params.id}/photos`);
  } catch (err) { res.status(500).send("Error upload"); }
});

// DELETE PHOTO
app.get("/admin/galeri/photo/delete/:id", checkAuth, async (req, res) => {
  try {
    const p = await q1("SELECT album_id FROM gallery_photos WHERE id=$1", [req.params.id]);
    if (p) {
      await pool.query("DELETE FROM gallery_photos WHERE id=$1", [req.params.id]);
      res.redirect(`/admin/galeri/${p.album_id}/photos`);
    } else res.redirect("/admin/galeri");
  } catch (err) { res.status(500).send("Error delete photo"); }
});

// Load Routes Lain
import publicRoutes from "./routes/public.js";
import adminRoutes  from "./routes/admin.js";

app.use("/", publicRoutes(q, q1));
app.use("/admin", checkAuth, adminRoutes(q, q1, uploadImage, pool));

app.listen(process.env.PORT || 8080, () => console.log("🚀 Server Ready"));
