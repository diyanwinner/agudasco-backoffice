// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// static
app.use("/public", express.static(path.join(__dirname, "public")));

// ejs + layouts
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);

// helper active menu
app.use((req, res, next) => {
  res.locals.path = req.path; // dipakai di navbar untuk “active”
  next();
});

// routes
app.get("/", (req, res) => {
  res.render("home", { title: "AGUDASCO – Beranda" });
});

// halaman generik: /galeri, /kegiatan, /berita, /anggota, /pengurus, /laporan, /tentang, /kontak
app.get("/galeri",   (req, res) => res.render("page", { title: "Galeri – AGUDASCO",   heading: "Galeri",   content: "Halaman ini akan berisi galeri dokumentasi kegiatan." }));
app.get("/kegiatan", (req, res) => res.render("page", { title: "Kegiatan – AGUDASCO", heading: "Kegiatan", content: "Rangkuman agenda & aktivitas organisasi." }));
app.get("/berita",   (req, res) => res.render("page", { title: "Berita – AGUDASCO",   heading: "Berita",   content: "Publikasi berita & rilis resmi." }));
app.get("/anggota",  (req, res) => res.render("page", { title: "Anggota – AGUDASCO",  heading: "Anggota",  content: "Direktori anggota (akan diisi kemudian)." }));
app.get("/pengurus", (req, res) => res.render("page", { title: "Pengurus – AGUDASCO", heading: "Pengurus", content: "Struktur kepengurusan & tugasnya." }));
app.get("/laporan",  (req, res) => res.render("page", { title: "Laporan Keuangan – AGUDASCO", heading: "Laporan Keuangan", content: "Transparansi laporan (akan ditautkan ke dokumen)." }));
app.get("/tentang",  (req, res) => res.render("page", { title: "Tentang – AGUDASCO", heading: "Tentang", content: "Profil singkat organisasi." }));
app.get("/kontak",   (req, res) => res.render("page", { title: "Kontak – AGUDASCO",  heading: "Kontak",  content: "Alamat, email, & form kontak." }));

// start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
