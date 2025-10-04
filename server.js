// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// static & body
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));

// ejs + layouts
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout"); // pakai views/layout.ejs

// ---- demo data artikel (nanti ganti ambil dari DB) ----
const demoArticles = [
  { slug: "welcome", title: "Welcome", content: "Halo keluarga besar AGUDASCO…" },
  { slug: "event-sabtu", title: "Kegiatan Sabtu", content: "Rangkuman kegiatan Sabtu…" },
];

// routes
app.get("/", (req, res) => {
  res.render("home", {
    title: "AGUDASCO – Beranda",
    user: null,
    arts: demoArticles, // tampilkan list
  });
});

app.get("/article/:slug", (req, res) => {
  const { slug } = req.params;
  const found = demoArticles.find(a => a.slug === slug) || {
    slug,
    title: "Artikel",
    content: "Konten artikel ini nanti akan diambil dari database berdasarkan slug.",
  };
  res.render("article", {
    title: `${found.title} – AGUDASCO`,
    artikel: found,
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
