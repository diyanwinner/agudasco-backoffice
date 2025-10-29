// routes/admin.js
import express from "express";

export default function (q, q1, uploadImage, pool) {
  const router = express.Router();

  /* -------------------- DASHBOARD -------------------- */
  router.get("/", (req, res) =>
    res.render("admin/dashboard", { title: "Dashboard" })
  );

  /* -------------------- ARTIKEL ---------------------- */
  router.get("/articles", async (req, res) => {
    const articles = await q("SELECT * FROM articles ORDER BY id DESC");
    res.render("admin/articles", { title: "Kelola Artikel", articles });
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

  /* -------------------- BANNER ----------------------- */
  router.get("/banners", async (req, res) => {
    const banners = await q("SELECT * FROM banners ORDER BY id DESC");
    res.render("admin/banners", { title: "Kelola Banner", banners });
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

  /* ==================== ANGGOTA ====================== */
  // Halaman khusus input + link ke Family (tanpa list anggota)
  router.get("/members", async (req, res) => {
    res.render("admin/members_add", {
      title: "Tambah Anggota",
      nextUrl: "/admin/family", // target setelah submit
    });
  });

  // Simpan anggota baru -> lanjut ke /admin/family (default)
  router.post("/members", uploadImage.single("avatar"), async (req, res) => {
    const { name = "", bio = "" } = req.body;
    if (!name.trim()) return res.status(400).send("Nama wajib diisi");
    const avatar = req.file ? req.file.path : null;

    await q("INSERT INTO members (name,avatar,bio) VALUES ($1,$2,$3)", [
      name.trim(),
      avatar,
      bio || "",
    ]);

    const redirectTo = req.body.redirect_to || "/admin/family";
    res.redirect(redirectTo);
  });

  // >>> NEW: Hapus anggota (POST) — ini yang bikin 404 kalau belum ada
  router.post("/members/:id/delete", async (req, res) => {
    const id = Number(req.params.id);
    await q("DELETE FROM members WHERE id=$1", [id]);
    // NOTE: Tabel family & photos sudah ON DELETE CASCADE di schema kamu
    res.redirect("/admin/members");
  });

  // Detail anggota (diakses dari tombol "Detail" di Family)
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
      member,
      families,
      photos,
    });
  });

  // Tambah keluarga dari halaman detail anggota (opsional)
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

  router.post("/members/:id/family/:fid/delete", async (req, res) => {
    const memberId = Number(req.params.id);
    const fid = Number(req.params.fid);
    await q("DELETE FROM member_families WHERE id=$1 AND member_id=$2", [
      fid,
      memberId,
    ]);
    res.redirect(`/admin/members/${memberId}`);
  });

  // Upload foto anggota (opsional)
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

  router.post("/members/:id/photo/:pid/delete", async (req, res) => {
    const memberId = Number(req.params.id);
    const pid = Number(req.params.pid);
    await q("DELETE FROM member_photos WHERE id=$1 AND member_id=$2", [
      pid,
      memberId,
    ]);
    res.redirect(`/admin/members/${memberId}`);
  });

  // ================= ADMIN: KONTAK =================
  router.get("/kontak", async (req, res) => {
    const address = (await q1("SELECT value FROM site_settings WHERE key='CONTACT_ADDRESS'"))?.value || "";
    const email   = (await q1("SELECT value FROM site_settings WHERE key='CONTACT_EMAIL'"))?.value || "";
    const phone   = (await q1("SELECT value FROM site_settings WHERE key='CONTACT_PHONE'"))?.value || "";
  res.render("admin/kontak", { title: "Kelola Kontak", address, email, phone });
});

  router.post("/kontak", async (req, res) => {
    const { address = "", email = "", phone = "" } = req.body;

  // UPSERT sederhana
    await q("INSERT INTO site_settings(key,value) VALUES('CONTACT_ADDRESS',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [address.trim()]);
    await q("INSERT INTO site_settings(key,value) VALUES('CONTACT_EMAIL',$1)   ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [email.trim()]);
    await q("INSERT INTO site_settings(key,value) VALUES('CONTACT_PHONE',$1)   ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [phone.trim()]);

  res.redirect("/admin/kontak");
});

  /* ===================== FAMILY ====================== */
  // Grid Family (filter member_id opsional + selectedMemberId untuk view)
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

  return router;
}
