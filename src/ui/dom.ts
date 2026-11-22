// 极简 DOM 构造助手
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | EventListener> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'className') {
      el.className = String(v);
    } else if (k === 'textContent') {
      el.textContent = String(v);
    } else if (typeof v === 'boolean') {
      if (v) el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return el;
}

export function clear(node: HTMLElement): void {
  node.innerHTML = '';
}

export function table(headers: string[], rows: (string | Node)[][], opts: { className?: string } = {}): HTMLTableElement {
  const t = h('table', { className: opts.className ?? 'data-table' });
  const thead = h('thead', {}, h('tr', {}, ...headers.map((x) => h('th', { textContent: x }))));
  const tbody = h('tbody');
  for (const row of rows) {
    tbody.appendChild(h('tr', {}, ...row.map((c) => (typeof c === 'string' ? h('td', { textContent: c }) : h('td', {}, c)))));
  }
  t.append(thead, tbody);
  return t;
}

export function download(filename: string, content: string | Blob, mime = 'text/plain;charset=utf-8'): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function fmt(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || Number.isNaN(n) ? '—' : n.toFixed(digits);
}
