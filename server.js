// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";

// Konversi __dirname (karena di ESM tidak ada langsung)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Init Express
const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static files (biar /public bisa dipanggil)
app.use("/public", express.static(path.join(__dirname, "public")));

// EJS + Layouts
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);

// Routing contoh
app.get("/", (req, res) => {
  res.render("home", { 
    title: "AGUDASCO – Beranda", 
    user: null, 
    arts: [] // nanti ini ambil dari database 
  });
});

// Jalankan server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
