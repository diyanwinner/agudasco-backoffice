// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import expressLayouts from "express-ejs-layouts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// static files
app.use("/public", express.static(path.join(__dirname, "public")));

// ejs + express-ejs-layouts
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(expressLayouts);
app.set("layout", "layout"); // views/layout.ejs

// healthcheck (optional, biar gampang cek di Railway)
app.get("/healthz", (_req, res) => res.send("ok"));

// home
app.get("/", (req, res) => {
  res.render("home", {
    title: "AGUDASCO – Beranda",
    user: null,
    arts: [], // nanti diisi dari DB
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
