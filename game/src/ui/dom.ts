/**
 * dom.ts - Tiny element builders used by every screen. No framework.
 */

type Child = Node | string | number | null | undefined | false | Child[];

export type Props = {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  id?: string;
  tabIndex?: number;
  disabled?: boolean;
  draggable?: boolean;
  type?: string;
  value?: string | number;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  checked?: boolean;
  selected?: boolean;
  for?: string;
  style?: string;
  dataset?: Record<string, string | number | boolean>;
  onClick?: (e: MouseEvent) => void;
  onInput?: (e: Event) => void;
  onChange?: (e: Event) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  onDragStart?: (e: DragEvent) => void;
  onDragOver?: (e: DragEvent) => void;
  onDrop?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
};

function append(parent: Node, child: Child): void {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) {
    for (const c of child) append(parent, c);
    return;
  }
  parent.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const node: HTMLElement = el;
  if (props) {
    if (props.class) el.className = props.class;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.html !== undefined) el.innerHTML = props.html;
    if (props.title) el.title = props.title;
    if (props.id) el.id = props.id;
    if (props.tabIndex !== undefined) el.tabIndex = props.tabIndex;
    if (props.style) el.setAttribute("style", props.style);
    if (props.draggable !== undefined) el.draggable = props.draggable;
    if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) el.dataset[k] = String(v);
    const anyEl = el as HTMLInputElement & HTMLOptionElement & HTMLLabelElement & HTMLButtonElement;
    if (props.disabled !== undefined) anyEl.disabled = props.disabled;
    if (props.type) anyEl.setAttribute("type", props.type);
    if (props.value !== undefined) anyEl.value = String(props.value);
    if (props.min !== undefined) anyEl.min = String(props.min);
    if (props.max !== undefined) anyEl.max = String(props.max);
    if (props.step !== undefined) anyEl.step = String(props.step);
    if (props.placeholder) anyEl.placeholder = props.placeholder;
    if (props.checked !== undefined) anyEl.checked = props.checked;
    if (props.selected !== undefined) anyEl.selected = props.selected;
    if (props.for) anyEl.htmlFor = props.for;
    if (props.onClick) node.addEventListener("click", props.onClick);
    if (props.onInput) node.addEventListener("input", props.onInput);
    if (props.onChange) node.addEventListener("change", props.onChange);
    if (props.onKeyDown) node.addEventListener("keydown", props.onKeyDown);
    if (props.onDragStart) node.addEventListener("dragstart", props.onDragStart);
    if (props.onDragOver) node.addEventListener("dragover", props.onDragOver);
    if (props.onDrop) node.addEventListener("drop", props.onDrop);
    if (props.onDragEnd) node.addEventListener("dragend", props.onDragEnd);
  }
  for (const c of children) append(el, c);
  return el;
}

/** A menu button: focusable, navigable, with an optional hint line. */
export function button(
  label: string,
  onClick: (e: MouseEvent) => void,
  opts: { hint?: string; class?: string; disabled?: boolean; focusId?: string; primary?: boolean } = {},
): HTMLButtonElement {
  const b = h(
    "button",
    {
      class: `btn${opts.primary ? " btn-primary" : ""}${opts.class ? ` ${opts.class}` : ""}`,
      type: "button",
      disabled: opts.disabled,
      onClick,
      dataset: opts.focusId ? { focusId: opts.focusId } : undefined,
    },
    h("span", { class: "btn-label", text: label }),
    opts.hint ? h("span", { class: "btn-hint", text: opts.hint }) : null,
  );
  return b;
}

export function select<T extends string | number>(
  options: readonly { value: T; label: string }[],
  value: T,
  onChange: (v: T) => void,
  focusId?: string,
): HTMLSelectElement {
  const el = h(
    "select",
    { class: "select", dataset: focusId ? { focusId } : undefined },
    ...options.map((o) => h("option", { value: String(o.value), text: o.label, selected: o.value === value })),
  );
  el.addEventListener("change", () => {
    const raw = el.value;
    const match = options.find((o) => String(o.value) === raw);
    if (match) onChange(match.value);
  });
  return el;
}

export function toggle(label: string, value: boolean, onChange: (v: boolean) => void, focusId?: string): HTMLElement {
  const b = h(
    "button",
    {
      class: `btn toggle${value ? " on" : ""}`,
      type: "button",
      dataset: focusId ? { focusId } : undefined,
      onClick: () => onChange(!value),
    },
    h("span", { class: "btn-label", text: label }),
    h("span", { class: "toggle-state", text: value ? "On" : "Off" }),
  );
  b.setAttribute("aria-pressed", String(value));
  return b;
}

export function row(cls: string, ...children: Child[]): HTMLElement {
  return h("div", { class: `row ${cls}` }, ...children);
}

export function section(title: string, ...children: Child[]): HTMLElement {
  return h("section", { class: "panel" }, h("h2", { class: "panel-title", text: title }), ...children);
}

export function empty(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function fmtGil(n: number): string {
  return `${n.toLocaleString("en-US")} gil`;
}

export function fmtDate(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
