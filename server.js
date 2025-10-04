// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/public", express.static(path.join(__dirname, "public")));

// EJS + Layout
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout"); // default layout.ejs

// Routing
app.get("/", (req, res) => {
  res.render("home", {
    title: "AGUDASCO – Beranda",
    user: null,
    arts: [] // nanti ambil dari DB
  });
});

app.get("/article/:slug", (req, res) => {
  res.render("article", {
    title: "Artikel – AGUDASCO",
    slug: req.params.slug
  });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
