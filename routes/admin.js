// routes/admin.js
import express from "express";

export default function (q, q1, uploadImage, pool) {
  const router = express.Router();

  /* -------------------- DASHBOARD -------------------- */
  router.get("/", (_req, res) =>
    res.render("admin/dashboard", { title: "Dashboard" })
  );

  /* -------------------- ARTIKEL ---------------------- */
  router.get("/articles", async (_req, res) => {
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
  router.get("/banners", async (_req, res) => {
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

  /* -------------------- ANGGOTA ---------------------- */
  router.get("/members", async (_req, res) => {
    res.render("admin/members_add", {
      title: "Tambah Anggota",
      nextUrl: "/admin/family",
    });
  });

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

  router.post("/members/:id/delete", async (req, res) => {
    const id = Number(req.params.id);
    await q("DELETE FROM members WHERE id=$1", [id]);
    res.redirect("/admin/members");
  });

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

  /* -------------------- FAMILY GRID ------------------ */
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

  /* -------------------- CONTACT (site_info) ---------- */
  router.get("/contact", async (req, res) => {
    const info = await q1("SELECT * FROM site_contact WHERE id=1", []);
    res.render("admin/contact", { title: "Kelola Kontak", info: info || {} });
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

  /* -------------------- REPORTS ---------------------- */
  router.get("/reports", async (_req, res) => {
    const reports = await q("SELECT * FROM reports ORDER BY id DESC");
    res.render("admin/reports", { title: "Kelola Laporan", reports });
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

  /* -------------------- AD/ART ----------------------- */
  router.get("/adarts", async (_req, res) => {
    const adarts = await q("SELECT * FROM adarts ORDER BY id DESC");
    res.render("admin/adarts", { title: "Kelola AD/ART", adarts });
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

  /* -------------------- END -------------------------- */
  return router;
}
