// server.js - AGUDASCO FULL VERSION (FINAL & CLEAN)
import dotenv from 'dotenv';
dotenv.config();

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

// 🛡️ Tangkap error global biar server gak gampang crash/mati
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err?.message || String(err));
});
process.on("unhandledRejection", (reason) => {
  const msg = (reason && reason.message) ? reason.message : String(reason);
  console.error("Unhandled Rejection:", msg);
});

/* ------------------------------------------------------------
   1. PATH / APP SETUP
------------------------------------------------------------ */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.set("trust proxy", true); // Render/Reverse proxy friendly

/* ------------------------------------------------------------
   2. DATABASE (Postgres / Neon)
------------------------------------------------------------ */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Penting buat Neon/Render
});

// Query Helpers (Biar kodingan lebih pendek)
const q  = async (sql, params = []) => (await pool.query(sql, params)).rows;
const q1 = async (sql, params = []) => (await pool.query(sql, params)).rows[0] || null;

/* ------------------------------------------------------------
   3. CLOUDINARY + MULTER (Upload Gambar)
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
   4. MIDDLEWARE & VIEW ENGINE
------------------------------------------------------------ */
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(express.json({ limit: "5mb" }));

// Static Assets
app.use("/public", express.static(path.join(__dirname, "public"), { maxAge: "7d", immutable: true }));
app.use("/docs",   express.static(path.join(__dirname, "public", "docs"), { maxAge: "7d", immutable: true }));

// EJS Layouts
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout"); // Layout utama kita

// 🌍 GLOBAL VARIABLES (Obat "User is not defined" ada di sini!)
app.locals.buildId    = process.env.RAILWAY_GIT_COMMIT_SHA || Date.now().toString();
app.locals.CLOUD_BASE = process.env.CLOUDINARY_CLOUD_NAME ? `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}` : "";

// Per-Request Locals (Jalan setiap kali halaman dibuka)
app.use(async (req, res, next) => {
  res.locals.buildId    = app.locals.buildId;
  res.locals.active     = ""; // Default active menu
  res.locals.title      = "AGUDASCO";
  res.locals.CLOUD_BASE = app.locals.CLOUD_BASE;
  res.locals.showWhatsAppFloat = !req.path.startsWith("/admin");
  
  // Kontak Footer (Diambil sekali biar gak berat)
  try {
    res.locals.footerContact = await q1("SELECT * FROM site_contact WHERE id=1") || {};
  } catch (e) {
    res.locals.footerContact = {};
  }

  // 👇 OBAT AMPUH: Cek Login Global (Biar tombol Admin/Login di header bener)
  const cookie = req.headers.cookie || "";
  if (cookie.includes("admin_session=true")) {
    // Kalau ada cookie admin, kita anggap user lagi login
    res.locals.user = { name: "Admin", role: "ADMIN" };
  } else {
    // Kalau gak ada cookie, user kosong
    res.locals.user = null;
  }
  
  next();
});

/* ------------------------------------------------------------
   5. AUTHENTICATION SYSTEM (LOGIN/LOGOUT)
------------------------------------------------------------ */

// Middleware Cek Login (Satpam)
function checkAuth(req, res, next) {
  const cookie = req.headers.cookie || "";
  if (cookie.includes("admin_session=true")) {
    return next(); // Boleh masuk
  }
  return res.redirect("/login"); // Tendang ke login
}

// Halaman Login
app.get("/login", (req, res) => {
  if (res.locals.user) return res.redirect("/admin"); // Kalau udah login, lempar ke admin
  res.render("login", { title: "Login Admin", layout: false, error: null });
});

// Proses Login (Cek Database Users & .env)
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    // A. Cek Super Admin (.env) - Jalan Belakang
    const envUser = process.env.ADMIN_USERNAME || "admin";
    const envPass = process.env.ADMIN_PASSWORD || "admin";

    if (username === envUser && password === envPass) {
      res.setHeader("Set-Cookie", "admin_session=true; HttpOnly; Path=/; Max-Age=86400");
      return res.redirect("/admin");
    }

    // B. Cek Database Users (Fitur Baru)
    const dbUser = await q1("SELECT * FROM users WHERE email = $1", [username]);
    
    // Note: Password masih plain text sesuai request sebelumnya (bisa di-upgrade ke bcrypt nanti)
    if (dbUser && dbUser.password === password) {
      res.setHeader("Set-Cookie", "admin_session=true; HttpOnly; Path=/; Max-Age=86400");
      return res.redirect("/admin");
    }

    // Gagal Login
    res.render("login", { title: "Login Admin", layout: false, error: "Email atau Password salah!" });

  } catch (e) {
    console.error("Login Error:", e);
    res.render("login", { title: "Login Admin", layout: false, error: "Terjadi kesalahan sistem." });
  }
});

// Logout
app.get("/logout", (req, res) => {
  res.setHeader("Set-Cookie", "admin_session=; HttpOnly; Path=/; Max-Age=0"); // Hapus cookie
  res.redirect("/login");
});

/* ------------------------------------------------------------
   6. ROUTE IMPORT (Pemisahan File)
------------------------------------------------------------ */
import publicRoutes from "./routes/public.js";
import adminRoutes  from "./routes/admin.js"; // Pastikan file admin.js ada di folder routes

// Route Publik (Siapapun bisa akses)
app.use("/", publicRoutes(q, q1));

// Route Admin (Harus Login)
app.use("/admin", checkAuth, adminRoutes(q, q1, uploadImage, pool));


/* ------------------------------------------------------------
   7. CRON JOB: ULANG TAHUN (WA OTOMATIS)
   Jalan setiap jam 07:00 Pagi WIB
------------------------------------------------------------ */
cron.schedule('0 7 * * *', async () => {
  console.log("⏰ CRON: Cek ulang tahun...");
  try {
    // Cari member yg ultah HARI INI
    const sql = `
      SELECT name, phone, birthdate 
      FROM members 
      WHERE 
        EXTRACT(MONTH FROM birthdate) = EXTRACT(MONTH FROM CURRENT_DATE) AND 
        EXTRACT(DAY FROM birthdate) = EXTRACT(DAY FROM CURRENT_DATE)
    `;
    const birthdayMembers = await q(sql);

    if (!birthdayMembers || birthdayMembers.length === 0) {
      console.log("✅ Tidak ada yang ultah hari ini.");
      return;
    }

    // Susun Pesan WA
    let msg = `🎂 *PENGINGAT ULANG TAHUN*\n\nHalo Admin, hari ini ada ${birthdayMembers.length} anggota yang ulang tahun:\n`;
    birthdayMembers.forEach((m, i) => {
      const age = new Date().getFullYear() - new Date(m.birthdate).getFullYear();
      msg += `\n${i + 1}. *${m.name}* (Ke-${age})\n   No HP: ${m.phone || '-'}`;
    });
    msg += `\n\nJangan lupa ucapin ya sayang! 😘`;

    // Kirim via Fonnte
    const token = process.env.WA_API_TOKEN;
    const target = process.env.WA_ADMIN_NUMBER;

    if (token && target) {
      await axios.post('https://api.fonnte.com/send', { target: target, message: msg }, { headers: { 'Authorization': token } });
      console.log(`✅ WA Terkirim ke Admin.`);
    } else {
      console.log("⚠️ Token Fonnte belum diset.");
    }
  } catch (err) {
    console.error("❌ Cron Error:", err.message);
  }
}, {
  scheduled: true,
  timezone: "Asia/Jakarta"
});

/* ------------------------------------------------------------
   8. ERROR HANDLER & START SERVER
------------------------------------------------------------ */
// 404 Not Found
app.use((req, res) => res.status(404).render("404", { title: "Halaman Tidak Ditemukan", layout: false }));

// 500 Server Error
app.use((err, req, res, _next) => {
  console.error("Server Error:", err);
  res.status(500).send("Terjadi kesalahan pada server. Coba refresh.");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server AGUDASCO jalan di http://localhost:${PORT}`);
});
