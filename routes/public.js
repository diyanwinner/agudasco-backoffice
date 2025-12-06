// routes/public.js
import express from "express";

export default function (q, q1) {
  const router = express.Router();

  /* ========= Middleware: footer contact untuk semua halaman publik ========= */
  router.use(async (_req, res, next) => {
    try {
      const info = await q1(
        "SELECT org_name, address, email, phone, whatsapp FROM site_contact WHERE id = 1"
      );

      // disimpan di res.locals supaya otomatis kebawa ke semua render
      res.locals.footerContact = info || {};
    } catch (e) {
      console.error("footerContact load err:", e);
      res.locals.footerContact = {};
    }
    next();
  });

  // ========= Beranda =========
  router.get("/", async (_req, res) => {
    const banners = await q("SELECT * FROM banners ORDER BY id DESC LIMIT 10");
    const arts    = await q("SELECT * FROM articles ORDER BY id DESC LIMIT 6");

    res.render("home", {
      title: "AGUDASCO – Beranda",
      active: "home",
      banners,
      arts,
      // optional: kalau mau tetap eksplisit
      footerContact: res.locals.footerContact
    });
  });

  // ========= Artikel =========
  router.get("/artikel", async (_req, res) => {
    const articles = await q("SELECT * FROM articles ORDER BY id DESC");
    res.render("articles", {
      title: "Artikel",
      active: "artikel",
      articles,
      footerContact: res.locals.footerContact
    });
  });

  router.get("/artikel/:id", async (req, res) => {
    const article = await q1("SELECT * FROM articles WHERE id=$1", [req.params.id]);
    if (!article) return res.status(404).send("Artikel tidak ditemukan");

    res.render("article_view", {
      title: article.title,
      active: "artikel",
      article,
      footerContact: res.locals.footerContact
    });
  });

  // ===== Laporan (langsung flipbook) =====
router.get("/laporan", (req, res) => {
  // langsung arahkan ke halaman flipbook
  res.redirect("/laporan/book");
});

router.get("/laporan/book", (req, res) => {
  res.render("report_book", {
    title: "Laporan Keuangan (Flipbook)",
    active: "laporan",
  });
});

  // Laporan Keuangan (Flipbook)
  router.get("/laporan/book", (_req, res) => {
    res.render("report_book", {
      title: "Laporan Keuangan 2025 (Flipbook)",
      active: "laporan",
    });
  });
  
  /* ===== AD/ART ===== */
  router.get("/adart", (_req, res) => res.redirect("/adart/book"));

  router.get("/adart/book", (_req, res) => {
    res.render("adart_book", {
      title: "AD/ART (Flipbook)",
      active: "adart",
      footerContact: res.locals.footerContact
    });
  });

  // ========= Anggota =========
  router.get("/anggota", async (_req, res) => {
    const members = await q("SELECT id, name, avatar FROM members ORDER BY name ASC");
    res.render("members", {
      title: "Anggota",
      active: "anggota",
      members,
      footerContact: res.locals.footerContact
    });
  });

  router.get("/anggota/:id", async (req, res) => {
    const member = await q1("SELECT * FROM members WHERE id=$1", [req.params.id]);
    if (!member) return res.status(404).send("Anggota tidak ditemukan");

    res.render("member_view", {
      title: member.name,
      active: "anggota",
      member,
      footerContact: res.locals.footerContact
    });
  });

  // ========= Kontak publik =========
  router.get("/kontak", (_req, res) => {
    const info = res.locals.footerContact || {};

    res.render("kontak", {
      title: "Kontak",
      active: "kontak",
      contact: info,               // buat kartu di halaman kontak
      footerContact: info          // buat footer kolom kontak
    });
  });

  // ========= Halaman lain =========
  router.get("/tentang", (_req, res) =>
    res.render("tentang", {
      title: "Tentang",
      active: "tentang",
      footerContact: res.locals.footerContact
    })
  );

  // 1. Halaman Depan Galeri (List Album)
  router.get("/galeri", async (req, res) => {
    try {
      // Ambil semua album, urutkan dari yg terbaru
      const albums = await q("SELECT * FROM albums ORDER BY event_date DESC");
      
      res.render("galeri", {
        title: "Galeri Kegiatan",
        active: "galeri", // Biar menu navbar nyala
        albums: albums // Lempar data album ke EJS
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Gagal memuat galeri");
    }
  });

  // 2. Halaman Detail Album (Isi Foto)
  router.get("/galeri/:id", async (req, res) => {
    try {
      const albumId = req.params.id;
      
      // Ambil data albumnya dulu
      const album = await q1("SELECT * FROM albums WHERE id = $1", [albumId]);
      
      if (!album) {
        return res.status(404).render("404", { title: "Album Tidak Ditemukan" }); // Atau redirect
      }

      // Ambil foto-foto di dalem album itu
      const photos = await q("SELECT * FROM gallery_photos WHERE album_id = $1 ORDER BY id DESC", [albumId]);

      res.render("galeri_detail", {
        title: album.title,
        active: "galeri",
        album: album,
        photos: photos
      });
    } catch (err) {
      console.error(err);
      res.status(500).send("Gagal memuat detail album");
    }
  });
  
