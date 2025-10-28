// routes/admin.js
import express from "express";

export default function (q, q1, uploadImage, pool) {
  const router = express.Router();

  router.get("/", (req, res) => res.render("admin/dashboard", { title: "Dashboard" }));

  // === ARTIKEL ===
  router.get("/articles", async (req, res) => {
    const articles = await q("SELECT * FROM articles ORDER BY id DESC");
    res.render("admin/articles", { title: "Kelola Artikel", articles });
  });

  router.post("/articles", uploadImage.single("image"), async (req, res) => {
    const { title, content } = req.body;
    const image = req.file ? req.file.path : null;
    if (!title) return res.status(400).send("Judul wajib diisi");
    await q("INSERT INTO articles (title,content,image) VALUES ($1,$2,$3)", [
      title,
      content,
      image,
    ]);
    res.redirect("/admin/articles");
  });

  router.post("/articles/:id/delete", async (req, res) => {
    await q("DELETE FROM articles WHERE id=$1", [req.params.id]);
    res.redirect("/admin/articles");
  });

  // === BANNER ===
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
    await q("DELETE FROM banners WHERE id=$1", [req.params.id]);
    res.redirect("/admin/banners");
  });

  // === MEMBERS + FAMILY + PHOTOS ===
  router.get("/members", async (req, res) => {
    const members = await q("SELECT * FROM members ORDER BY created_at DESC");
    res.render("admin/members", { title: "Kelola Anggota", members });
  });

  router.post("/members", uploadImage.single("avatar"), async (req, res) => {
    const { name, bio } = req.body;
    const avatar = req.file ? req.file.path : null;
    await q("INSERT INTO members (name,avatar,bio) VALUES ($1,$2,$3)", [
      name,
      avatar,
      bio,
    ]);
    res.redirect("/admin/members");
  });

  router.get("/members/:id", async (req, res) => {
    const id = req.params.id;
    const member = await q1("SELECT * FROM members WHERE id=$1", [id]);
    const families = await q("SELECT * FROM member_families WHERE member_id=$1", [id]);
    const photos = await q("SELECT * FROM member_photos WHERE member_id=$1", [id]);
    res.render("admin/member_detail", { title: `Kelola: ${member.name}`, member, families, photos });
  });

  router.post("/members/:id/family", async (req, res) => {
    const { fullname, relation } = req.body;
    await q(
      "INSERT INTO member_families (member_id, fullname, relation) VALUES ($1,$2,$3)",
      [req.params.id, fullname, relation]
    );
    res.redirect(`/admin/members/${req.params.id}`);
  });

  router.post("/members/:id/family/:fid/delete", async (req, res) => {
    await q("DELETE FROM member_families WHERE id=$1", [req.params.fid]);
    res.redirect(`/admin/members/${req.params.id}`);
  });

  router.post("/members/:id/photo", uploadImage.single("photo"), async (req, res) => {
    const { caption } = req.body;
    await q(
      "INSERT INTO member_photos (member_id, image_url, caption) VALUES ($1,$2,$3)",
      [req.params.id, req.file.path, caption]
    );
    res.redirect(`/admin/members/${req.params.id}`);
  });

  router.post("/members/:id/photo/:pid/delete", async (req, res) => {
    await q("DELETE FROM member_photos WHERE id=$1", [req.params.pid]);
    res.redirect(`/admin/members/${req.params.id}`);
  });

  // === FAMILY PAGE ===
  router.get("/family", async (req, res) => {
    const { rows: members } = await pool.query("SELECT id,name FROM members ORDER BY name ASC");
    const { rows: families } = await pool.query(`
      SELECT f.*, m.name AS member_name
      FROM member_families f
      LEFT JOIN members m ON m.id=f.member_id
      ORDER BY m.name ASC, f.id ASC
    `);
    res.render("admin/family_list", { title: "Data Keluarga", members, families });
  });

  router.post("/family/:id/delete", async (req, res) => {
    await pool.query("DELETE FROM member_families WHERE id=$1", [req.params.id]);
    res.redirect("/admin/family");
  });

  return router;
}
