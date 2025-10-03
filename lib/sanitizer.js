// lib/sanitizer.js
import sanitizeHtml from "sanitize-html";

// Pakai ini untuk membersihkan konten artikel, tapi tetap izinkan <img>
export function sanitizeContent(html = "") {
  return sanitizeHtml(html, {
    allowedTags: [
      "h1","h2","h3","h4","p","strong","em","ul","ol","li","a","br",
      "blockquote","img","figure","figcaption","code","pre","hr","span","div"
    ],
    allowedAttributes: {
      a: ["href","target","rel","name"],
      img: ["src","alt","title","width","height","loading","style"],
      "*": ["style","class"]
    },
    // izinkan http/https dan data: (untuk svg kecil/placeholder)
    allowedSchemes: ["http", "https", "data"],
    allowProtocolRelative: false,
    // bikin semua link buka tab baru secara aman
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    },
  });
}
