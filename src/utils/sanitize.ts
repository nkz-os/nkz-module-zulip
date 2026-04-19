const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'ul', 'ol', 'li',
  'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img', 'del',
]);

const ALLOWED_ATTRS = new Set([
  'href', 'target', 'rel', 'src', 'alt', 'class', 'title',
]);

export function sanitizeZulipHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeNode(doc.body);
  return doc.body.innerHTML;
}

function sanitizeNode(node: Node): void {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      if (!ALLOWED_TAGS.has(tag)) {
        const text = document.createTextNode(el.textContent || '');
        node.replaceChild(text, child);
        continue;
      }

      const attrs = Array.from(el.attributes);
      for (const attr of attrs) {
        if (!ALLOWED_ATTRS.has(attr.name)) {
          el.removeAttribute(attr.name);
        }
      }

      if (tag === 'a') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }

      sanitizeNode(el);
    }
  }
}
