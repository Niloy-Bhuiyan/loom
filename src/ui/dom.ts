type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | boolean | number | undefined | EventListener>;

/**
 * Minimal element factory: h('button', { class: 'x', onclick: fn }, 'Label').
 * Keys starting with "on" become event listeners; booleans toggle attributes.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2), value);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  el.append(...(children.filter(Boolean) as (Node | string)[]));
  return el;
}

/** Parse a trusted, static SVG/HTML snippet (icons only — never user or model text). */
export function fragment(html: string): DocumentFragment {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content;
}
