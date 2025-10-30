// routes/public.js
import express from "express";

/**
 * Public routes
 * View yang dipakai:
 * - home, articles, article_view
 * - reports, report_view
 * - adart, adart_view
 * - members, member_view
 * - kontak, tentang, galeri
 */
export default function (q, q1) {
  const router = express.Router();

  /* ===================== BERANDA ===================== */
  router.get("/", async (req, res) => {
    const banners = await q("SELECT * FROM banners ORDER BY id DESC LIMIT 10");
    const arts    = await q("SELECT * FROM articles ORDER BY id DESC LIMIT 6");
    res.render("home", {
      title: "AGUDASCO – Beranda",
      active: "home",
      banners,
      arts,
    });
  });

  /* ===================== ARTIKEL ===================== */
  router.get("/artikel", async (_req, res) => {
    const articles = await q("SELECT * FROM articles ORDER BY id DESC");
    res.render("articles", {
      title: "Artikel",
      active: "artikel",
      articles,
    });
  });

  router.get("/artikel/:id", async (req, res) => {
    const article = await q1("SELECT * FROM articles WHERE id=$1", [req.params.id]);
    if (!article) return res.status(404).send("Artikel tidak ditemukan");
    res.render("article_view", {
      title: article.title,
      active: "artikel",
      article,
    });
  });

  /* ===================== LAPORAN ===================== */
  router.get("/laporan", async (_req, res) => {
    const reports = await q("SELECT * FROM reports ORDER BY id DESC");
    res.render("reports", {
      title: "Laporan Keuangan",
      active: "laporan",
      reports,
    });
  });

  router.get("/laporan/:id", async (req, res) => {
    const report = await q1("SELECT * FROM reports WHERE id=$1", [req.params.id]);
    if (!report) return res.status(404).send("Laporan tidak ditemukan");
    res.render("report_view", {
      title: report.title,
      active: "laporan",
      report,
    });
  });

  /* ====================== AD/ART ===================== */
  router.get("/adart", async (_req, res) => {
    const adarts = await q("SELECT * FROM adarts ORDER BY id DESC");
    res.render("adart", {
      title: "AD/ART",
      active: "adart",
      adarts,
    });
  });

  router.get("/adart/:id", async (req, res) => {
    const item = await q1("SELECT * FROM adarts WHERE id=$1", [req.params.id]);
    if (!item) return res.status(404).send("AD/ART tidak ditemukan");
    res.render("adart_view", {
      title: item.title,
      active: "adart",
      item,
    });
  });

  /* ===================== ANGGOTA ===================== */
  router.get("/anggota", async (_req, res) => {
    const members = await q(
      "SELECT id, name, avatar FROM members ORDER BY name ASC"
    );
    res.render("members", {
      title: "Anggota",
      active: "anggota",
      members,
    });
  });

  router.get("/anggota/:id", async (req, res) => {
    const member = await q1("SELECT * FROM members WHERE id=$1", [req.params.id]);
    if (!member) return res.status(404).send("Anggota tidak ditemukan");
    res.render("member_view", {
      title: member.name,
      active: "anggota",
      member,
    });
  });

  /* ================== HALAMAN PUBLIK ================= */
  // routes/public.js
router.get("/kontak", async (_req, res) => {
  try {
    const info = await q1("SELECT * FROM site_info WHERE id=1");
    res.render("kontak", {
      title: "Kontak",
      active: "kontak",
      contact: info || {},   // <- kontak.ejs tetap pakai `contact`
    });
  } catch (e) {
    console.error("Kontak error:", e);
    res.render("kontak", { title: "Kontak", active: "kontak", contact: {} });
  }
  });
    } catch (e) {
      console.error("Kontak error:", e);
      res.render("kontak", { title: "Kontak", active: "kontak", contact: {} });
    }
  });

  // Tentang (statis sementara)
  router.get("/tentang", (_req, res) => {
    res.render("tentang", { title: "Tentang", active: "tentang" });
  });

  // Galeri (placeholder)
  router.get("/galeri", (_req, res) => {
    res.render("galeri", { title: "Galeri", active: "galeri" });
  });

  return router;
}
