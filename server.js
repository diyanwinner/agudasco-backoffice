// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import ejsMate from "ejs-mate"; // pakai ejs-mate, bukan express-ejs-layouts

// __dirname untuk ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware body
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Static files
app.use("/public", express.static(path.join(__dirname, "public")));

// View engine + ejs-mate
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Route beranda
app.get("/", (req, res) => {
  res.render("home", {
    title: "AGUDASCO – Beranda",
    user: null,
    arts: [], // nanti ambil dari DB
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
