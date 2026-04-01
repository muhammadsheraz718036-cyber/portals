export function sanitizeHtml(input: string): string {
  if (!input) return "";

  const parser = new DOMParser();
  const doc = parser.parseFromString(input, "text/html");

  // Remove high-risk elements entirely.
  doc.querySelectorAll("script, iframe, object, embed, link, meta").forEach((el) => {
    el.remove();
  });

  // Remove event handlers and javascript: URLs.
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();

      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }

      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        value.startsWith("javascript:")
      ) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return doc.body.innerHTML;
}
