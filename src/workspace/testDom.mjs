/** Small deterministic DOM/event fake for workspace lifecycle contracts; browsers verify native behavior. */
export class TestNode {
  constructor(documentRef, tag = 'div') {
    this.ownerDocument = documentRef;
    this.tagName = tag.toUpperCase();
    this.parentElement = null;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = { cursor: '' };
    this.hidden = false;
    this.disabled = false;
    this.inert = false;
    this.value = '';
    this.checked = false;
    this.tabIndex = undefined;
    this._text = '';
    this.className = '';
    this.classList = {
      add: (name) => {
        this.className = [
          ...new Set([...this.className.split(' '), name]),
        ].join(' ');
      },
    };
  }
  get isConnected() {
    return this === this.ownerDocument || !!this.parentElement?.isConnected;
  }
  get textContent() {
    return this._text + this.children.map((n) => n.textContent).join('');
  }
  set textContent(value) {
    this._text = String(value);
    this.replaceChildren();
  }
  append(...nodes) {
    for (const n of nodes) {
      n.remove();
      n.parentElement = this;
      this.children.push(n);
    }
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(
        (n) => n !== this,
      );
      this.parentElement = null;
    }
  }
  replaceChildren(...nodes) {
    for (const n of [...this.children]) n.remove();
    this.append(...nodes);
  }
  contains(target) {
    return this === target || this.children.some((n) => n.contains(target));
  }
  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }
  getAttribute(key) {
    if (key === 'class') return this.className;
    if (key.startsWith('data-'))
      return (
        this.attributes.get(key) ??
        this.dataset[
          key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
        ] ??
        null
      );
    return this.attributes.get(key) ?? null;
  }
  hasAttribute(key) {
    return (
      this.attributes.has(key) ||
      (key === 'inert' && this.inert) ||
      (key === 'disabled' && this.disabled)
    );
  }
  removeAttribute(key) {
    this.attributes.delete(key);
  }
  toggleAttribute(key, on) {
    if (on) this.setAttribute(key, '');
    else this.removeAttribute(key);
  }
  matches(selector) {
    return selector.split(',').some((part) => {
      part = part.trim();
      if (part === ':disabled') return this.disabled;
      if (part.startsWith('.'))
        return this.className.split(' ').includes(part.slice(1));
      if (part.includes(':not')) {
        if (this.tabIndex === -1) return false;
        part = part.split(':not')[0];
      }
      const tag = part.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const attr = part.match(/\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]/);
      if (attr) {
        const value =
          attr[1] === 'tabindex'
            ? this.tabIndex
            : (this.getAttribute(attr[1]) ?? this[attr[1]]);
        if (typeof value === 'boolean' && !value) return false;
        return (
          value !== null &&
          value !== undefined &&
          (attr[2] === undefined || String(value) === attr[2])
        );
      }
      return !!tag;
    });
  }
  closest(selector) {
    return this.matches(selector)
      ? this
      : this.parentElement?.closest(selector) || null;
  }
  querySelectorAll(selector) {
    return this.children.flatMap((n) => [
      ...(n.matches(selector) ? [n] : []),
      ...n.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  getClientRects() {
    return this.closest('[hidden]') || this.hidden ? [] : [{}];
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 1280, height: 900 };
  }
  focus() {
    if (!this.isConnected) return;
    const before = this.ownerDocument.activeElement;
    this.ownerDocument.activeElement = this;
    if (before !== this) {
      before?.dispatch('blur');
      this.dispatch('focus');
    }
  }
  addEventListener(type, fn, options) {
    const list = this.listeners.get(type) || [];
    list.push({ fn, capture: options === true || options?.capture === true });
    this.listeners.set(type, list);
  }
  removeEventListener(type, fn, options) {
    const capture = options === true || options?.capture === true;
    this.listeners.set(
      type,
      (this.listeners.get(type) || []).filter(
        (e) => e.fn !== fn || e.capture !== capture,
      ),
    );
  }
  dispatch(type, properties = {}) {
    const event = {
      type,
      target: this,
      defaultPrevented: false,
      stopped: false,
      immediate: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      stopImmediatePropagation() {
        this.stopped = true;
        this.immediate = true;
      },
      ...properties,
    };
    const path = [];
    for (let n = this; n; n = n.parentElement) path.push(n);
    const deliver = (n, capture) => {
      for (const e of [...(n.listeners.get(type) || [])]) {
        if (e.capture === capture) e.fn(event);
        if (event.immediate) break;
      }
    };
    for (const n of [...path].reverse()) {
      deliver(n, true);
      if (event.stopped) return event;
    }
    for (const n of path) {
      deliver(n, false);
      if (event.stopped) break;
    }
    return event;
  }
  click() {
    this.dispatch('click');
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((n, a) => n + a.length, 0);
  }
}
export function testDocument() {
  const d = new TestNode(null, '#document');
  d.ownerDocument = d;
  d.createElement = (tag) => new TestNode(d, tag);
  d.createElementNS = (ns, tag) => new TestNode(d, tag);
  d.documentElement = new TestNode(d, 'html');
  d.documentElement.clientWidth = 1280;
  d.documentElement.clientHeight = 900;
  d.body = new TestNode(d, 'body');
  d.append(d.documentElement);
  d.documentElement.append(d.body);
  d.activeElement = d.body;
  d.defaultView = new TestNode(d, 'window');
  d.defaultView.matchMedia = () => ({ matches: false });
  return d;
}
