// middleware/sanitizeBodyContent.js
import { sanitizeContent } from "../lib/sanitizer.js";

export function sanitizeBodyContent(field = "content") {
  return (req, _res, next) => {
    if (req.body && req.body[field]) {
      req.body[field] = sanitizeContent(req.body[field]);
    }
    next();
  };
}
