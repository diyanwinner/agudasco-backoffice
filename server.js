// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import ejsMate from "ejs-mate";
import methodOverride from "method-override";
import session from "express-session";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- Middleware dasar
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(express.json({ limit: "10mb" }));
app.use(methodOverride("_method"));
app.use(session({
  secret: "change-me", // ganti di env nanti
  resave: false,
  saveUninitialized: false,
}));

// --- Static
app.use("/public", express.static(path.join(__dirname, "public")));

// --- View engine: EJS + ejs-mate (layout/partials)
app.engine("ejs", ejsMate);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// --- Routes
app.get("/", (req, res) => {
  res.render("home", {
    title: "AGUDASCO – Beranda",
    user: null,
    arts: [], // nanti diisi dari DB
  });
});

// --- Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
