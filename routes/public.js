// routes/public.js
import express from "express";
export default function (q, q1) {
  const router = express.Router();

  router.get("/health", (req, res) => res.send("OK"));

  router.get("/", async (req, res) => {
    const banners = await q("SELECT * FROM banners ORDER BY id DESC LIMIT 10");
    const arts = await q("SELECT * FROM articles ORDER BY id DESC LIMIT 6");
    res.render("home", { title: "AGUDASCO – Beranda", active: "home", banners, arts });
  });

  router.get("/artikel", async (req, res) => {
    const articles = await q("SELECT * FROM articles ORDER BY id DESC");
    res.render("articles", { title: "Artikel", active: "artikel", articles });
  });

  router.get("/artikel/:id", async (req, res) => {
    const article = await q1("SELECT * FROM articles WHERE id=$1", [req.params.id]);
    if (!article) return res.status(404).send("Artikel tidak ditemukan");
    res.render("article_view", { title: article.title, active: "artikel", article });
  });

  router.get("/laporan", async (req, res) => {
    const reports = await q("SELECT * FROM reports ORDER BY id DESC");
    res.render("reports", { title: "Laporan Keuangan", active: "laporan", reports });
  });

  router.get("/laporan/:id", async (req, res) => {
    const report = await q1("SELECT * FROM reports WHERE id=$1", [req.params.id]);
    if (!report) return res.status(404).send("Laporan tidak ditemukan");
    res.render("report_view", { title: report.title, active: "laporan", report });
  });

  router.get("/adart", async (req, res) => {
    const adarts = await q("SELECT * FROM adarts ORDER BY id DESC");
    res.render("adart", { title: "AD/ART", active: "adart", adarts });
  });

  router.get("/adart/:id", async (req, res) => {
    const item = await q1("SELECT * FROM adarts WHERE id=$1", [req.params.id]);
    if (!item) return res.status(404).send("AD/ART tidak ditemukan");
    res.render("adart_view", { title: item.title, active: "adart", item });
  });

  router.get("/anggota", async (req, res) => {
    const members = await q("SELECT id,name,avatar FROM members ORDER BY name ASC");
    res.render("members", { title: "Anggota", active: "anggota", members });
  });

  router.get("/anggota/:id", async (req, res) => {
    const member = await q1("SELECT * FROM members WHERE id=$1", [req.params.id]);
    if (!member) return res.status(404).send("Anggota tidak ditemukan");
    res.render("member_view", { title: member.name, active: "anggota", member });
  });

  // ================= PUBLIC PAGES =================
export default function (q, q1) {
  const router = require('express').Router?.() || (await import('express')).Router();

  // ... route lain yang sudah ada

  // K O N T A K
  router.get("/kontak", async (req, res) => {
    const address = (await q1("SELECT value FROM site_settings WHERE key='CONTACT_ADDRESS'"))?.value || "";
    const email   = (await q1("SELECT value FROM site_settings WHERE key='CONTACT_EMAIL'"))?.value || "";
    const phone   = (await q1("SELECT value FROM site_settings WHERE key='CONTACT_PHONE'"))?.value || "";
    res.render("kontak", { title: "Kontak", active: "kontak", address, email, phone });
  });

  // T E N T A N G (sementara statis / bisa kamu isi)
  router.get("/tentang", (req, res) => {
    res.render("tentang", { title: "Tentang", active: "tentang" });
  });

  // G A L E R I (placeholder)
  router.get("/galeri", (req, res) => {
    res.render("galeri", { title: "Galeri", active: "galeri" });
  });

  return router;
}
