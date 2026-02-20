// routes/admin.js - FINAL CLEAN VERSION
import express from "express";

export default function (q, q1, uploadImage, pool) {
  const router = express.Router();

  /* ==================== DASHBOARD (FIXED) ==================== */
  // Ini rute dashboard yang benar, mengarah ke tampilan baru
  router.get("/", async (_req, res) => {
    try {
      // Logic Ulang Tahun
      const upcomingBirthdays = await q(`
        WITH next_7 AS (
          SELECT to_char((CURRENT_DATE + offs)::date, 'MM-DD') AS md
          FROM generate_series(0, 7) AS offs
        )
        SELECT m.id, m.name, m.birthdate,
          (to_char(m.birthdate, 'MM-DD') = to_char(CURRENT_DATE, 'MM-DD')) AS is_today
        FROM members m
        JOIN next_7 n ON m.birthdate IS NOT NULL AND to_char(m.birthdate, 'MM-DD') = n.md
      `);
      
      // Render file 'dashboard.ejs' yang ada di folder views utama (yg bagus)
      res.render("dashboard", { title: "Dashboard Admin", active: "admin", upcomingBirthdays });
    } catch (e) {
      res.render("dashboard", { title: "Dashboard Admin", active: "admin", upcomingBirthdays: [] });
    }
  });

  /* ==================== ARTIKEL ====================== */
  router.get("/articles", async (_req, res) => {
    const articles = await q("SELECT * FROM articles ORDER BY id DESC");
    res.render("admin/articles", { title: "Kelola Artikel", active: "admin", articles });
  });

  router.post("/articles", uploadImage.single("image"), async (req, res) => {
    const { title = "", content = "" } = req.body;
    const image = req.file ? req.file.path : null;
    if (!title.trim()) return res.status(400).send("Judul wajib diisi");
    await q("INSERT INTO articles (title,content,image) VALUES ($1,$2,$3)", [
      title.trim(),
      content,
      image,
    ]);
    res.redirect("/admin/articles");
  });

  router.post("/articles/:id/delete", async (req, res) => {
    await q("DELETE FROM articles WHERE id=$1", [Number(req.params.id)]);
    res.redirect("/admin/articles");
  });

  /* ==================== BANNER ======================= */
  router.get("/banners", async (_req, res) => {
    const banners = await q("SELECT * FROM banners ORDER BY id DESC");
    res.render("admin/banners", { title: "Kelola Banner", active: "admin", banners });
  });

  router.post("/banners", uploadImage.single("image"), async (req, res) => {
    const image = req.file ? req.file.path : null;
    if (!image) return res.status(400).send("File gambar belum dipilih");
    await q("INSERT INTO banners (image) VALUES ($1)", [image]);
    res.redirect("/admin/banners");
  });

  router.post("/banners/:id/delete", async (req, res) => {
    await q("DELETE FROM banners WHERE id=$1", [Number(req.params.id)]);
    res.redirect("/admin/banners");
  });

  /* ==================== GALERI ======================= */
  // 1. Tampilkan Halaman Galeri
  router.get("/galeri", async (_req, res) => {
    try {
      // Ambil data foto dari database, urutkan dari yang terbaru
      const photos = await q("SELECT * FROM galleries ORDER BY id DESC");
      res.render("admin/galeri", { 
        title: "Kelola Galeri", 
        active: "admin", 
        photos 
      });
    } catch (e) {
      console.error("Error muat galeri:", e);
      res.render("admin/galeri", { 
        title: "Kelola Galeri", 
        active: "admin", 
        photos: [] 
      });
    }
  });

  // 2. Simpan Foto Baru
  router.post("/galeri", uploadImage.single("image"), async (req, res) => {
    try {
      const { title = "" } = req.body;
      const imageUrl = req.file ? req.file.path : null;
      
      if (!imageUrl) return res.status(400).send("Foto belum dipilih");

      await q(
        "INSERT INTO galleries (title, image_url) VALUES ($1, $2)",
        [title.trim(), imageUrl]
      );
      res.redirect("/admin/galeri");
    } catch (e) {
      console.error("Error simpan foto galeri:", e);
      res.status(500).send("Gagal menyimpan foto galeri.");
    }
  });

  // 3. Hapus Foto
  router.post("/galeri/:id/delete", async (req, res) => {
    try {
      await q("DELETE FROM galleries WHERE id=$1", [Number(req.params.id)]);
      res.redirect("/admin/galeri");
    } catch (e) {
      console.error("Error hapus foto galeri:", e);
      res.status(500).send("Gagal menghapus foto galeri.");
    }
  });

  /* ==================== ANGGOTA ====================== */
  // LIST
  router.get("/members", async (_req, res) => {
    const members = await q(
      "SELECT id,name,avatar,birthdate,created_at FROM members ORDER BY name ASC"
    );
    res.render("admin/members", {
      title: "Anggota",
      active: "admin",
      members
    });
  });

  // FORM TAMBAH
  router.get("/members/new", (_req, res) => {
    res.render("admin/members_add", {
      title: "Tambah Anggota",
      active: "admin"
    });
  });

  // SIMPAN TAMBAH
  router.post(
    "/members",
    uploadImage.fields([{ name: "avatar", maxCount: 1 }]),
    async (req, res) => {
      try {
        const { name = "", bio = "", birthdate = "", avatar_url = "" } = req.body;
        if (!name.trim()) return res.status(400).send("Nama wajib diisi");

        const uploaded = req.files?.avatar?.[0]?.path || null;
        const avatar = uploaded || (avatar_url?.trim() || null);
        const bd = birthdate ? birthdate : null;

        await q(
          "INSERT INTO members (name, birthdate, avatar, bio) VALUES ($1,$2,$3,$4)",
          [name.trim(), bd, avatar, bio || ""]
        );

        res.redirect("/admin/members");
      } catch (e) {
        console.error("create member error:", e);
        res.status(500).send("Gagal menyimpan anggota");
      }
    }
  );

  // FORM EDIT
  router.get("/members/:id/edit", async (req, res) => {
    const id = Number(req.params.id);
    const member = await q1("SELECT * FROM members WHERE id=$1", [id]);
    if (!member) return res.status(404).send("Anggota tidak ditemukan");

    res.render("admin/member_edit", {
      title: `Edit Anggota`,
      active: "admin",
      member
    });
  });

  // SIMPAN EDIT
  router.post(
    "/members/:id/update",
    uploadImage.fields([{ name: "avatar", maxCount: 1 }]),
    async (req, res) => {
      try {
        const id = Number(req.params.id);
        const { name = "", bio = "", birthdate = "", avatar_url = "" } = req.body;
        if (!name.trim()) return res.status(400).send("Nama wajib diisi");

        const current = await q1("SELECT avatar FROM members WHERE id=$1", [id]);
        if (!current) return res.status(404).send("Anggota tidak ditemukan");

        const uploaded = req.files?.avatar?.[0]?.path || null;
        const avatar = uploaded || (avatar_url?.trim() || current.avatar);
        const bd = birthdate ? birthdate : null;

        await q(
          "UPDATE members SET name=$1, birthdate=$2, avatar=$3, bio=$4 WHERE id=$5",
          [name.trim(), bd, avatar, bio || "", id]
        );

        res.redirect("/admin/members");
      } catch (e) {
        console.error("update member error:", e);
        res.status(500).send("Gagal mengubah anggota");
      }
    }
  );

  // HAPUS
  router.post("/members/:id/delete", async (req, res) => {
    const id = Number(req.params.id);
    await q("DELETE FROM members WHERE id=$1", [id]);
    res.redirect("/admin/members");
  });

  // DETAIL (keluarga + foto)
  router.get("/members/:id", async (req, res) => {
    const id = Number(req.params.id);
    const member = await q1("SELECT * FROM members WHERE id=$1", [id]);
    if (!member) return res.status(404).send("Anggota tidak ditemukan");

    const families = await q(
      "SELECT * FROM member_families WHERE member_id=$1 ORDER BY id ASC",
      [id]
    );
    const photos = await q(
      "SELECT * FROM member_photos WHERE member_id=$1 ORDER BY id DESC",
      [id]
    );

    res.render("admin/member_detail", {
      title: `Kelola: ${member.name}`,
      active: "admin",
      member,
      families,
      photos,
    });
  });

  // TAMBAH KELUARGA
  router.post("/members/:id/family", async (req, res) => {
    const memberId = Number(req.params.id);
    const { fullname = "", relation = "" } = req.body;
    if (!fullname.trim()) return res.status(400).send("Nama keluarga wajib diisi");
    await q(
      "INSERT INTO member_families (member_id, fullname, relation) VALUES ($1,$2,$3)",
      [memberId, fullname.trim(), relation.trim()]
    );
    res.redirect(`/admin/members/${memberId}`);
  });

  // HAPUS KELUARGA
  router.post("/members/:id/family/:fid/delete", async (req, res) => {
    const memberId = Number(req.params.id);
    const fid = Number(req.params.fid);
    await q("DELETE FROM member_families WHERE id=$1 AND member_id=$2", [
      fid,
      memberId,
    ]);
    res.redirect(`/admin/members/${memberId}`);
  });

  // TAMBAH FOTO
  router.post("/members/:id/photo", uploadImage.single("photo"), async (req, res) => {
    const memberId = Number(req.params.id);
    const { caption = "" } = req.body;
    const imageUrl = req.file ? req.file.path : null;
    if (!imageUrl) return res.status(400).send("Foto belum dipilih");

    await q(
      "INSERT INTO member_photos (member_id, image_url, caption) VALUES ($1,$2,$3)",
      [memberId, imageUrl, caption]
    );
    res.redirect(`/admin/members/${memberId}`);
  });

  // HAPUS FOTO
  router.post("/members/:id/photo/:pid/delete", async (req, res) => {
    const memberId = Number(req.params.id);
    const pid = Number(req.params.pid);
    await q("DELETE FROM member_photos WHERE id=$1 AND member_id=$2", [
      pid,
      memberId,
    ]);
    res.redirect(`/admin/members/${memberId}`);
  });

  /* ==================== FAMILY GRID ================== */
  router.get("/family", async (req, res) => {
    const memberId = req.query.member_id ? Number(req.query.member_id) : null;

    const { rows: members } = await pool.query(
      "SELECT id,name,avatar FROM members ORDER BY name ASC"
    );

    let families = [];
    if (memberId) {
      const { rows } = await pool.query(
        `SELECT f.*, m.name AS member_name
         FROM member_families f
         LEFT JOIN members m ON m.id=f.member_id
         WHERE f.member_id=$1
         ORDER BY f.id ASC`,
        [memberId]
      );
      families = rows;
    } else {
      const { rows } = await pool.query(
        `SELECT f.*, m.name AS member_name
         FROM member_families f
         LEFT JOIN members m ON m.id=f.member_id
         ORDER BY m.name ASC, f.id ASC`
      );
      families = rows;
    }

    res.render("admin/family_list", {
      title: "Data Keluarga",
      active: "admin",
      members,
      families,
      selectedMemberId: memberId || "",
    });
  });

  router.post("/family/:id/delete", async (req, res) => {
    await pool.query("DELETE FROM member_families WHERE id=$1", [Number(req.params.id)]);
    const backTo = req.body.back_to || "/admin/family";
    res.redirect(backTo);
  });

  /* ==================== CONTACT ====================== */
  router.get("/contact", async (_req, res) => {
    const info = await q1("SELECT * FROM site_contact WHERE id=1", []);
    res.render("admin/contact", { title: "Kelola Kontak", active: "admin", info: info || {} });
  });

  router.post("/contact", async (req, res) => {
    const {
      org_name = "", email = "", phone = "", whatsapp = "",
      address = "", maps_url = "", instagram = "", facebook = "", x_handle = ""
    } = req.body;

    await q(
      `INSERT INTO site_contact (id, org_name, email, phone, whatsapp, address, maps_url, instagram, facebook, x_handle, updated_at)
       VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,now())
       ON CONFLICT (id) DO UPDATE SET
         org_name=$1, email=$2, phone=$3, whatsapp=$4, address=$5,
         maps_url=$6, instagram=$7, facebook=$8, x_handle=$9, updated_at=now()`,
      [org_name.trim(), email.trim(), phone.trim(), whatsapp.trim(), address.trim(),
       maps_url.trim(), instagram.trim(), facebook.trim(), x_handle.trim()]
    );

    res.redirect("/admin/contact");
  });

  /* ==================== REPORTS ====================== */
  router.get("/reports", async (_req, res) => {
    const reports = await q("SELECT * FROM reports ORDER BY id DESC");
    res.render("admin/reports", { title: "Kelola Laporan", active: "admin", reports });
  });

  router.post("/reports", uploadImage.single("cover"), async (req, res) => {
    const { title = "", pdf_url = "" } = req.body;
    const cover = req.file ? req.file.path : null;
    if (!title.trim()) return res.status(400).send("Judul wajib diisi");
    await q(
      "INSERT INTO reports (title, cover, pdf_url) VALUES ($1,$2,$3)",
      [title.trim(), cover, pdf_url.trim()]
    );
    res.redirect("/admin/reports");
  });

  router.post("/reports/:id/delete", async (req, res) => {
    await q("DELETE FROM reports WHERE id=$1", [Number(req.params.id)]);
    res.redirect("/admin/reports");
  });

  /* ==================== AD/ART ======================= */
  router.get("/adarts", async (_req, res) => {
    const adarts = await q("SELECT * FROM adarts ORDER BY id DESC");
    res.render("admin/adarts", { title: "Kelola AD/ART", active: "admin", adarts });
  });

  router.post("/adarts", uploadImage.single("cover"), async (req, res) => {
    const { title = "", pdf_url = "" } = req.body;
    const cover = req.file ? req.file.path : null;
    if (!title.trim()) return res.status(400).send("Judul wajib diisi");
    await q(
      "INSERT INTO adarts (title, cover, pdf_url) VALUES ($1,$2,$3)",
      [title.trim(), cover, pdf_url.trim()]
    );
    res.redirect("/admin/adarts");
  });

  router.post("/adarts/:id/delete", async (req, res) => {
    await q("DELETE FROM adarts WHERE id=$1", [Number(req.params.id)]);
    res.redirect("/admin/adarts");
  });

  /* ==================== USER MANAGEMENT ================== */
  // 1. LIST USER
  router.get("/users", async (_req, res) => {
    try {
      const users = await q("SELECT * FROM users ORDER BY id ASC");
      res.render("admin/users/index", { 
        title: "Kelola Pengguna", 
        active: "admin", 
        rows: users 
      });
    } catch (e) {
      console.error("List users err:", e);
      res.redirect("/admin");
    }
  });

  // 2. FORM TAMBAH
  router.get("/users/new", (_req, res) => {
    res.render("admin/users/new", { 
      title: "Tambah Pengguna", 
      active: "admin" 
    });
  });

  // 3. SIMPAN USER BARU
  router.post("/users", async (req, res) => {
    try {
      const { name, email, password, role } = req.body;
      if (!name || !email || !password) return res.status(400).send("Wajib diisi!");

      await q(
        "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)",
        [name, email, password, role]
      );
      res.redirect("/admin/users");
    } catch (e) {
      console.error("Create user err:", e);
      res.status(500).send("Gagal membuat user");
    }
  });

  // 4. HAPUS USER
  router.post("/users/:id/delete", async (req, res) => {
    await q("DELETE FROM users WHERE id=$1", [Number(req.params.id)]);
    res.redirect("/admin/users");
  });

  return router;
}
