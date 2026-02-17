import express from "express";

export default function (q, q1) {
  const router = express.Router();

  /* ========= Middleware: footer contact untuk semua halaman publik ========= */
  router.use(async (_req, res, next) => {
    try {
      const info = await q1(
        "SELECT org_name, address, email, phone, whatsapp FROM site_contact WHERE id = 1"
      );
      // Simpan di res.locals supaya otomatis kebawa ke semua render
      res.locals.footerContact = info || {};
    } catch (e) {
      console.error("footerContact load err:", e);
      res.locals.footerContact = {};
    }
    next();
  });

  // ========= 1. BERANDA (HOME) =========
  router.get("/", async (_req, res) => {
    try {
      const banners = await q("SELECT * FROM banners ORDER BY id DESC LIMIT 10");
      const arts    = await q("SELECT * FROM articles ORDER BY id DESC LIMIT 6");

      res.render("home", {
        title: "AGUDASCO – Beranda",
        active: "home",
        banners,
        arts,
        footerContact: res.locals.footerContact
      });
    } catch (err) {
      console.error(err);
      res.render("home", { title: "Beranda", active: "home", banners:[], arts:[] });
    }
  });

  // ========= 2. ARTIKEL =========
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

  /* ========================================================
     3. DOKUMEN (AD/ART & LAPORAN JADI SATU)
     ======================================================== */
  
  // Kalau orang akses /dokumen -> Tampilkan halaman gabungan
  router.get("/dokumen", (_req, res) => {
    res.render("documents", {
      title: "Arsip Dokumen",
      active: "dokumen", // Nanti kita update menu navigasi biar ini nyala
      footerContact: res.locals.footerContact
    });
  });

  // Redirect link lama biar gak error (SEO Friendly)
  router.get("/adart", (_req, res) => res.redirect("/dokumen"));
  router.get("/adart/book", (_req, res) => res.redirect("/dokumen"));
  router.get("/laporan", (_req, res) => res.redirect("/dokumen"));
  router.get("/laporan/book", (_req, res) => res.redirect("/dokumen"));

  // ========= 5. ANGGOTA =========
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

    // Ambil data tambahan (keluarga & foto) jika diperlukan
    const family = await q("SELECT * FROM member_families WHERE member_id=$1", [member.id]);
    const photos = await q("SELECT * FROM member_photos WHERE member_id=$1", [member.id]);

    res.render("member_view", {
      title: member.name,
      active: "anggota",
      member,
      family,
      photos,
      footerContact: res.locals.footerContact
    });
  });
  
  // ============================================
  // 7. GALERI (Update Terbaru)
  // ============================================
  
  // Halaman Depan Galeri (List Album)
  router.get("/galeri", async (req, res) => {
    try {
      // Ambil semua album, urutkan dari yg terbaru
      const albums = await q("SELECT * FROM albums ORDER BY event_date DESC");
      
      res.render("galeri", {
        title: "Galeri Kegiatan",
        active: "galeri", 
        albums: albums,
        footerContact: res.locals.footerContact
      });
    } catch (err) {
      console.error("Error Galeri:", err);
      res.render("galeri", { 
        title: "Galeri", 
        active: "galeri", 
        albums: [],
        footerContact: res.locals.footerContact 
      });
    }
  });

  // Halaman Detail Album (Isi Foto)
  router.get("/galeri/:id", async (req, res) => {
    try {
      const albumId = req.params.id;
      
      // Ambil data albumnya dulu
      const album = await q1("SELECT * FROM albums WHERE id = $1", [albumId]);
      
      if (!album) {
        return res.redirect("/galeri");
      }

      // Ambil foto-foto di dalem album itu
      const photos = await q("SELECT * FROM gallery_photos WHERE album_id = $1 ORDER BY id DESC", [albumId]);

      res.render("galeri_detail", {
        title: album.title,
        active: "galeri",
        album: album,
        photos: photos,
        footerContact: res.locals.footerContact
      });
    } catch (err) {
      console.error(err);
      res.redirect("/galeri");
    }
  });

  return router;
}
