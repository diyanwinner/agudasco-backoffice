// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import pkg from "pg";
const { Pool } = pkg;
import cron from "node-cron";
import axios from "axios";

// Tangkap error global biar server gak gampang crash/mati
process.on("uncaughtException", (err) => {
  console.error("Uncaught:", err?.message || String(err));
});
process.on("unhandledRejection", (reason) => {
  const msg = (reason && reason.message) ? reason.message : String(reason);
  console.error("UnhandledRejection:", msg);
});

/* ------------------------------------------------------------
   PATH / APP SETUP
------------------------------------------------------------ */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.set("trust proxy", true); // Render/Reverse proxy friendly

/* ------------------------------------------------------------
   DATABASE (Postgres / Neon)
------------------------------------------------------------ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// query helpers
const q  = async (sql, params = []) => (await pool.query(sql, params)).rows;
const q1 = async (sql, params = []) => (await pool.query(sql, params)).rows[0] || null;

/* ------------------------------------------------------------
   CLOUDINARY + MULTER (image only)
------------------------------------------------------------ */
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

/* ------------------------------------------------------------
   APP MIDDLEWARE & VIEW ENGINE
------------------------------------------------------------ */
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(express.json({ limit: "5mb" }));

// static assets
app.use(
  "/public",
  express.static(path.join(__dirname, "public"), {
    maxAge: "7d",
    immutable: true,
  })
);

app.use(
  "/docs",
  express.static(path.join(__dirname, "public", "docs"), {
    maxAge: "7d",
    immutable: true,
  })
);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout");

// globals
app.locals.buildId    = process.env.RAILWAY_GIT_COMMIT_SHA || Date.now().toString();
app.locals.CLOUD_BASE = process.env.CLOUDINARY_CLOUD_NAME
  ? `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}`
  : "";

// per-request locals
app.use((req, res, next) => {
  res.locals.buildId   = app.locals.buildId;
  res.locals.active    = "";
  res.locals.title     = "AGUDASCO";
  res.locals.CLOUD_BASE = app.locals.CLOUD_BASE;
  res.locals.showWhatsAppFloat = !req.path.startsWith("/admin");
  res.locals.waNumber = (process.env.WHATSAPP_NUMBER || "62895340169646").replace(/\D/g, "");
  res.locals.waText   = process.env.WHATSAPP_TEXT || "Halo Admin AGUDASCO, saya ingin mengajukan kritik & saran.";
  
  next();
});

// CSP
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self' https:",
      "img-src 'self' https: data: blob:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src  'self' 'unsafe-inline' https:",
      "worker-src 'self' blob: https:",
      "connect-src 'self' https: blob:",
      "object-src 'none'"
    ].join("; ")
  );
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
   AUTHENTICATION SYSTEM (SI SATPAM BARU)
   Menggantikan Basic Auth yang lama
============================================================ */

// 1. Cek Login (Middleware)
function checkAuth(req, res, next) {
  const cookie = req.headers.cookie || "";
  if (cookie.includes("admin_session=true")) {
    return next();
  }
  return res.redirect("/login");
}

// 2. Halaman Login
app.get("/login", (req, res) => {
  const cookie = req.headers.cookie || "";
  if (cookie.includes("admin_session=true")) return res.redirect("/admin");

  res.render("login", { 
    title: "Login Admin", 
    layout: false, // Tampilan full screen tanpa header web
    error: null 
  });
});

// 3. Proses Login
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const validUser = process.env.ADMIN_USERNAME || "admin";
  const validPass = process.env.ADMIN_PASSWORD || "admin";

  if (username === validUser && password === validPass) {
    // Set Cookie Login (1 Hari)
    res.setHeader("Set-Cookie", "admin_session=true; HttpOnly; Path=/; Max-Age=86400");
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


/* ============================================================
   ROUTE DASHBOARD ADMIN (ANTI ERROR 500)
   Ini yang bikin error kemarin, sekarang udah pakai logika JS yang aman.
============================================================ */
app.get("/admin", checkAuth, async (req, res) => {
  try {
    // 1. Ambil semua data member
    // Kalau tabel members belum ada, kita kasih array kosong biar server gak mati
    let allMembers = [];
    try {
      allMembers = await q("SELECT * FROM members");
    } catch (e) {
      console.log("Tabel members belum ada, dashboard tetap jalan.");
    }
    
    // 2. Filter Ulang Tahun Pakai JAVASCRIPT (Lebih Aman dari SQL)
    const today = new Date();
    // Reset jam biar akurat per hari
    today.setHours(0,0,0,0);
    
    const upcomingBirthdays = allMembers.filter(member => {
      if (!member.birthdate) return false;

      // Ubah tanggal lahir jadi object Date
      const bdate = new Date(member.birthdate);
      // Buat tanggal ulang tahun tahun ini
      const thisYearBirthday = new Date(today.getFullYear(), bdate.getMonth(), bdate.getDate());
      thisYearBirthday.setHours(0,0,0,0);

      // Kalau ultahnya udah lewat tahun ini, anggep ultahnya tahun depan
      if (thisYearBirthday < today) {
         thisYearBirthday.setFullYear(today.getFullYear() + 1);
      }
      
      // Hitung jarak hari (dalam milisecond)
      const diffTime = thisYearBirthday.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 

      // Ambil yang hari ini (0) sampai 7 hari ke depan
      if (diffDays >= 0 && diffDays <= 7) {
        member.is_today = (diffDays === 0); // Tandain kalau hari ini
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
    // Fallback: Kalau error banget, kasih dashboard kosong
    res.render("dashboard", { 
      title: "Dashboard Admin",
      upcomingBirthdays: [],
      layout: "layout" 
    });
  }
});


/* ============================================================
   ROUTES GALERI ADMIN
   (Kode asli kamu, tapi 'adminAuth' diganti 'checkAuth')
============================================================ */

// 1. DAFTAR ALBUM
app.get("/admin/galeri", checkAuth, async (req, res) => {
  try {
    const sql = `
      SELECT a.*, 
      (SELECT COUNT(*) FROM gallery_photos WHERE album_id = a.id) as photo_count
      FROM albums a 
      ORDER BY event_date DESC
    `;
    const albums = await q(sql);
    res.render("admin/galeri/index", { title: "Kelola Galeri", albums });
  } catch (err) {
    console.error(err);
    res.status(500).send("Gagal memuat galeri.");
  }
});

// 2. CREATE ALBUM
app.post("/admin/galeri/create", checkAuth, uploadImage.single("cover"), async (req, res) => {
  try {
    const { title, event_date, description } = req.body;
    const cover = req.file ? req.file.path : null;
    await pool.query(
      `INSERT INTO albums (title, event_date, description, cover_image) VALUES ($1, $2, $3, $4)`,
      [title, event_date, description, cover]
    );
    res.redirect("/admin/galeri");
  } catch (err) {
    res.status(500).send("Gagal membuat album.");
  }
});

// 3. HAPUS ALBUM
app.get("/admin/galeri/delete/:id", checkAuth, async (req, res) => {
  try {
    await pool.query("DELETE FROM albums WHERE id = $1", [req.params.id]);
    res.redirect("/admin/galeri");
  } catch (err) {
    res.status(500).send("Gagal menghapus album.");
  }
});

// 4. BUKA ALBUM
app.get("/admin/galeri/:id/photos", checkAuth, async (req, res) => {
  try {
    const album = await q1("SELECT * FROM albums WHERE id = $1", [req.params.id]);
    const photos = await q("SELECT * FROM gallery_photos WHERE album_id = $1 ORDER BY id DESC", [req.params.id]);
    if (!album) return res.status(404).send("Album tidak ditemukan");
    res.render("admin/galeri/photos", { title: `Foto: ${album.title}`, album, photos });
  } catch (err) {
    res.status(500).send("Error membuka album.");
  }
});

// 5. UPLOAD FOTO
app.post("/admin/galeri/:id/upload", checkAuth, uploadImage.array("photos"), async (req, res) => {
  try {
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        await pool.query("INSERT INTO gallery_photos (album_id, image_url) VALUES ($1, $2)", [req.params.id, file.path]);
      }
    }
    res.redirect(`/admin/galeri/${req.params.id}/photos`);
  } catch (err) {
    res.status(500).send("Gagal upload foto.");
  }
});

// 6. HAPUS FOTO
app.get("/admin/galeri/photo/delete/:id", checkAuth, async (req, res) => {
  try {
    const photo = await q1("SELECT album_id FROM gallery_photos WHERE id = $1", [req.params.id]);
    if (photo) {
      await pool.query("DELETE FROM gallery_photos WHERE id = $1", [req.params.id]);
      res.redirect(`/admin/galeri/${photo.album_id}/photos`);
    } else {
      res.redirect("/admin/galeri");
    }
  } catch (err) {
    res.status(500).send("Gagal hapus foto.");
  }
});

/* ------------------------------------------------------------
   ROUTES BAWAAN (LOADER)
------------------------------------------------------------ */
import publicRoutes from "./routes/public.js";
import adminRoutes  from "./routes/admin.js";

// healthcheck
app.get("/health", (_req, res) => res.status(200).send("OK"));

// Pasang route
app.use("/",      publicRoutes(q, q1));

// Route Admin sisanya (Pakai checkAuth juga)
app.use("/admin", checkAuth, adminRoutes(q, q1, uploadImage, pool));

/* ------------------------------------------------------------
   ERROR HANDLERS
------------------------------------------------------------ */
app.use((req, res) => res.status(404).send("Not Found"));
app.use((err, req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).send(err?.message || "Server Error");
});

/* ============================================================
   CRON JOB: NOTIFIKASI ULANG TAHUN VIA WA (FONNTE)
============================================================ */
cron.schedule('0 7 * * *', async () => {
  console.log("⏰ CRON JOB: Mengecek ulang tahun hari ini...");

  try {
    // 1. Cari Member yang Ulang Tahun HARI INI
    // Kita filter pakai SQL biar cepat
    const sql = `
      SELECT name, phone, birthdate 
      FROM members 
      WHERE 
        EXTRACT(MONTH FROM birthdate) = EXTRACT(MONTH FROM CURRENT_DATE) AND 
        EXTRACT(DAY FROM birthdate) = EXTRACT(DAY FROM CURRENT_DATE)
    `;
    const birthdayMembers = await q(sql);

    // Kalau gak ada yang ultah, stop aja
    if (!birthdayMembers || birthdayMembers.length === 0) {
      console.log("✅ Tidak ada yang ulang tahun hari ini.");
      return;
    }

    // 2. Siapkan Pesan WA
    let message = `🎂 *PENGINGAT ULANG TAHUN*\n\nHalo Admin, hari ini ada ${birthdayMembers.length} anggota yang ulang tahun:\n`;
    
    birthdayMembers.forEach((m, index) => {
      const dob = new Date(m.birthdate);
      const age = new Date().getFullYear() - dob.getFullYear();
      const hp = m.phone ? m.phone : '-';
      message += `\n${index + 1}. *${m.name}* (Ke-${age})\n   No HP: ${hp}`;
    });

    message += `\n\nJangan lupa ucapin ya sayang! 😘`;

    // 3. Kirim ke WA Admin pakai Fonnte
    const token = process.env.WA_API_TOKEN; 
    const target = process.env.WA_ADMIN_NUMBER; // Nomor WA Admin

    if (token && target) {
      await axios.post('https://api.fonnte.com/send', {
        target: target,
        message: message,
      }, {
        headers: { 'Authorization': token }
      });
      console.log(`✅ Sukses kirim WA ke Admin.`);
    } else {
      console.log("⚠️ Token Fonnte atau Nomor Admin belum diset di .env");
    }

  } catch (err) {
    console.error("❌ Gagal kirim notif WA:", err.message);
  }
}, {
  scheduled: true,
  timezone: "Asia/Jakarta" // Wajib set ini biar pas jam 7 pagi WIB
});

/* ------------------------------------------------------------
   START SERVER
------------------------------------------------------------ */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
