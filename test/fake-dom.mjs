// A small DOM for rendering the popup in Node, without dependencies: elements with
// attributes, classes, children, text, events and focus, a selector subset (tag,
// #id, .class, [attr], [attr="value"], descendant combinator) and the details /
// summary behaviour of the browser (clicking the summary toggles the open
// attribute, and every change of it queues a "toggle" event). Tests only.

class FakeText {
  constructor(data) {
    this.data = String(data);
    this.parentNode = null;
  }
  get textContent() { return this.data; }
}

function parseCompound(text) {
  const match = /^([a-z0-9-]+|\*)?((?:#[\w-]+|\.[\w-]+|\[[^\]]+\])*)$/i.exec(text);
  if (!match) throw new Error(`unsupported selector: ${text}`);
  const parts = { tag: match[1] && match[1] !== '*' ? match[1].toLowerCase() : null, ids: [], classes: [], attributes: [] };
  for (const [part] of match[2].matchAll(/#[\w-]+|\.[\w-]+|\[[^\]]+\]/g)) {
    if (part[0] === '#') parts.ids.push(part.slice(1));
    else if (part[0] === '.') parts.classes.push(part.slice(1));
    else {
      const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
      if (!attribute) throw new Error(`unsupported selector: ${part}`);
      parts.attributes.push({ name: attribute[1], value: attribute[2] ?? null });
    }
  }
  return parts;
}

function matchesCompound(element, parts) {
  if (parts.tag && element.localName !== parts.tag) return false;
  if (parts.ids.some((id) => element.id !== id)) return false;
  if (parts.classes.some((name) => !element.classList.contains(name))) return false;
  return parts.attributes.every(({ name, value }) => element.hasAttribute(name) && (value == null || element.getAttribute(name) === value));
}

function matchesSelector(element, selector) {
  const compounds = selector.trim().split(/\s+/).map(parseCompound);
  if (!matchesCompound(element, compounds.at(-1))) return false;
  let ancestor = element.parentNode;
  for (let index = compounds.length - 2; index >= 0; index -= 1) {
    while (ancestor instanceof FakeElement && !matchesCompound(ancestor, compounds[index])) ancestor = ancestor.parentNode;
    if (!(ancestor instanceof FakeElement)) return false;
    ancestor = ancestor.parentNode;
  }
  return true;
}

export class FakeElement {
  constructor(document, tagName) {
    this.ownerDocument = document;
    this.localName = String(tagName).toLowerCase();
    this.tagName = this.localName.toUpperCase();
    this.parentNode = null;
    this.childNodes = [];
    this.attributeMap = new Map();
    this.listeners = new Map();
    const properties = new Map();
    this.style = { setProperty: (name, value) => properties.set(name, String(value)), getPropertyValue: (name) => properties.get(name) ?? '' };
  }

  getAttribute(name) { return this.attributeMap.has(name) ? this.attributeMap.get(name) : null; }
  hasAttribute(name) { return this.attributeMap.has(name); }
  setAttribute(name, value) {
    const had = this.attributeMap.has(name);
    this.attributeMap.set(name, String(value));
    if (name === 'open' && !had) this.queueToggle();
  }
  removeAttribute(name) {
    const had = this.attributeMap.delete(name);
    if (name === 'open' && had) this.queueToggle();
  }
  // Like the browser: a change of a details element's open attribute queues a toggle event.
  queueToggle() {
    if (this.localName === 'details') setTimeout(() => this.dispatchEvent({ type: 'toggle' }), 0);
  }

  get id() { return this.getAttribute('id') ?? ''; }
  set id(value) { this.setAttribute('id', value); }
  get className() { return this.getAttribute('class') ?? ''; }
  set className(value) { this.setAttribute('class', value); }
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean);
    const write = (list) => { this.className = list.join(' '); };
    return {
      contains: (name) => names().includes(name),
      add: (...added) => write([...new Set([...names(), ...added])]),
      remove: (...removed) => write(names().filter((name) => !removed.includes(name))),
      toggle: (name, force) => {
        const on = force === undefined ? !names().includes(name) : Boolean(force);
        if (on) write([...new Set([...names(), name])]);
        else write(names().filter((item) => item !== name));
        return on;
      }
    };
  }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get open() { return this.hasAttribute('open'); }
  set open(value) { if (value) this.setAttribute('open', ''); else this.removeAttribute('open'); }

  get children() { return this.childNodes.filter((node) => node instanceof FakeElement); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] ?? null; }
  get parentElement() { return this.parentNode instanceof FakeElement ? this.parentNode : null; }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument.documentElement;
  }
  get textContent() { return this.childNodes.map((node) => node.textContent).join(''); }
  set textContent(value) { this.replaceChildren(...(value == null || value === '' ? [] : [String(value)])); }

  append(...nodes) {
    for (const item of nodes) {
      const node = item instanceof FakeElement || item instanceof FakeText ? item : new FakeText(item);
      if (node.parentNode) node.parentNode.childNodes = node.parentNode.childNodes.filter((child) => child !== node);
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.append(...nodes);
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter((child) => child !== this);
    this.parentNode = null;
  }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }

  *descendants() {
    for (const child of this.children) {
      yield child;
      yield* child.descendants();
    }
  }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    for (let current = this; current instanceof FakeElement; current = current.parentNode) if (current.matches(selector)) return current;
    return null;
  }
  querySelectorAll(selector) { return [...this.descendants()].filter((element) => element.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return true;
  }
  focus() { if (this.isConnected) this.ownerDocument.focused = this; }
  blur() { if (this.ownerDocument.focused === this) this.ownerDocument.focused = null; }
  // A click on a summary opens or closes its details, as the browser's activation behaviour does.
  click() {
    this.dispatchEvent({ type: 'click' });
    const details = this.parentNode;
    if (this.localName === 'summary' && details instanceof FakeElement && details.localName === 'details' && details.firstElementChild === this) {
      details.open = !details.open;
    }
  }
}

export class FakeDocument {
  constructor() {
    this.title = '';
    this.focused = null;
    this.documentElement = new FakeElement(this, 'html');
    this.body = new FakeElement(this, 'body');
    this.documentElement.append(this.body);
  }
  createElement(tagName) { return new FakeElement(this, tagName); }
  // An element with the id is created on first use (as a div in the body) when the
  // page's markup is not built, so a script's lookups of static elements work.
  getElementById(id) {
    const found = this.documentElement.querySelector(`#${id}`);
    if (found) return found;
    const element = this.createElement('div');
    element.id = id;
    this.body.append(element);
    return element;
  }
  get activeElement() { return this.focused?.isConnected ? this.focused : this.body; }
  querySelectorAll(selector) { return this.documentElement.querySelectorAll(selector); }
  querySelector(selector) { return this.documentElement.querySelector(selector); }
  execCommand() { return false; }
}
