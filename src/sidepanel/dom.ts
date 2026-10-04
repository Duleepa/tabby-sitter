export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs?: Record<string, string>,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

let statusTimer: ReturnType<typeof setTimeout> | undefined;

export function showStatus(msg: string): void {
  const node = document.getElementById('status');
  if (!node) return;
  node.textContent = msg;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => (node.textContent = ''), 3000);
}
