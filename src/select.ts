/** Local, keyboard-accessible select popup, styled with the app instead of the OS. */
import { t } from "./i18n";
const widgets = new Map<string, ThemedSelect>();

export function refreshSelect(id: string): void {
  widgets.get(id)?.refresh();
}
export function closeSelects(): void {
  widgets.forEach((widget) => widget.close(false));
}
export function refreshAllSelects(): void {
  widgets.forEach(widget => widget.refresh());
}
export function initializeSelects(): void {
  document.querySelectorAll<HTMLSelectElement>("select").forEach((select) => {
    if (!widgets.has(select.id))
      widgets.set(select.id, new ThemedSelect(select));
  });
}

class ThemedSelect {
  private button = document.createElement("button");
  private text = document.createElement("span");
  private popup = document.createElement("div");
  private expanded = false;
  private highlighted = 0;
  private options: HTMLOptionElement[] = [];
  private typed = "";
  private typedAt = 0;

  constructor(private select: HTMLSelectElement) {
    const wrapper = document.createElement("div");
    wrapper.className = "themed-select";
    select.before(wrapper);
    wrapper.append(select);
    select.hidden = true;
    select.tabIndex = -1;
    this.button.type = "button";
    this.button.id = `${select.id}-button`;
    this.button.className = "select-trigger";
    this.button.setAttribute("role", "combobox");
    this.button.setAttribute("aria-haspopup", "listbox");
    this.button.setAttribute("aria-controls", `${select.id}-options`);
    this.button.setAttribute(
      "aria-label",
      select.getAttribute("aria-label") ??
        select.closest(".setting-card")?.querySelector("strong")?.textContent ??
        t("select.choose"),
    );
    const chevron = document.createElement("span");
    chevron.className = "select-chevron";
    chevron.setAttribute("aria-hidden", "true");
    this.button.append(this.text, chevron);
    wrapper.append(this.button);
    this.popup.id = `${select.id}-options`;
    this.popup.className = "select-popup";
    this.popup.setAttribute("role", "listbox");
    this.popup.hidden = true;
    document.body.append(this.popup);
    this.button.onclick = () => {
      if (this.expanded) this.close(true);
      else this.open();
    };
    this.button.onkeydown = (event) => this.keydown(event);
    this.popup.onmousedown = (event) => event.preventDefault();
    select.addEventListener("change", () => this.refresh());
    new MutationObserver(() => this.refresh()).observe(select, {
      childList: true,
      subtree: true,
      attributes: true,
    });
    document.addEventListener("pointerdown", (event) => {
      if (
        !wrapper.contains(event.target as Node) &&
        !this.popup.contains(event.target as Node)
      )
        this.close(false);
    });
    window.addEventListener("resize", () => this.close(false));
    document.addEventListener(
      "scroll",
      (event) => {
        if (event.target !== this.popup && this.expanded) this.position();
      },
      true,
    );
    this.refresh();
  }

  refresh(): void {
    this.button.setAttribute("aria-label", this.select.getAttribute("aria-label") ?? this.select.closest(".setting-card")?.querySelector("strong")?.textContent ?? t("select.choose"));
    this.options = Array.from(this.select.options).filter(
      (option) => !option.hidden,
    );
    this.text.textContent =
      this.select.selectedOptions[0]?.textContent ?? t("select.choose");
    this.button.disabled = this.select.disabled || this.options.length === 0;
    this.button.setAttribute("aria-expanded", String(this.expanded));
    if (this.expanded) this.render();
  }

  private open(): void {
    if (this.button.disabled) return;
    closeSelects();
    this.expanded = true;
    this.popup.hidden = false;
    this.highlighted = Math.max(
      0,
      this.options.findIndex((option) => option.value === this.select.value),
    );
    this.button.setAttribute("aria-expanded", "true");
    this.position();
    this.render();
  }

  private position(): void {
    const bounds = this.button.getBoundingClientRect();
    if (bounds.bottom < 40 || bounds.top > window.innerHeight) {
      this.close(false);
      return;
    }
    const width = Math.min(Math.max(bounds.width, 220), window.innerWidth - 16);
    this.popup.style.width = `${width}px`;
    this.popup.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`;
    this.popup.style.top = "";
    this.popup.style.bottom = "";
    const below = window.innerHeight - bounds.bottom - 12;
    if (below < 140 && bounds.top > below) {
      this.popup.style.bottom = `${window.innerHeight - bounds.top + 5}px`;
      this.popup.style.maxHeight = `${Math.min(280, bounds.top - 12)}px`;
    } else {
      this.popup.style.top = `${bounds.bottom + 5}px`;
      this.popup.style.maxHeight = `${Math.min(280, below)}px`;
    }
  }

  close(focus: boolean): void {
    this.expanded = false;
    this.popup.hidden = true;
    this.button.setAttribute("aria-expanded", "false");
    this.button.removeAttribute("aria-activedescendant");
    if (focus) this.button.focus();
  }

  private render(): void {
    this.popup.replaceChildren();
    this.options.forEach((option, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.tabIndex = -1;
      item.id = `${this.select.id}-option-${index}`;
      item.className = "select-option";
      item.setAttribute("role", "option");
      item.setAttribute(
        "aria-selected",
        String(option.value === this.select.value),
      );
      item.disabled = option.disabled;
      const check = document.createElement("span");
      check.className = "select-check";
      check.textContent = option.value === this.select.value ? "✓" : "";
      check.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = option.textContent;
      if (option.dataset.fontFamily) label.style.fontFamily = option.dataset.fontFamily;
      item.append(check, label);
      item.onclick = () => this.choose(index);
      item.onpointermove = () => {
        this.highlighted = index;
        this.highlight();
      };
      this.popup.append(item);
    });
    this.highlight();
  }

  private highlight(): void {
    this.popup
      .querySelectorAll<HTMLElement>("[role=option]")
      .forEach((item, index) =>
        item.classList.toggle("highlighted", index === this.highlighted),
      );
    const item = this.popup.children[this.highlighted] as
      HTMLElement | undefined;
    if (item) {
      this.button.setAttribute("aria-activedescendant", item.id);
      item.scrollIntoView({ block: "nearest" });
    }
  }

  private choose(index: number): void {
    const option = this.options[index];
    if (!option || option.disabled) return;
    const changed = this.select.value !== option.value;
    this.select.value = option.value;
    this.close(true);
    this.refresh();
    if (changed) {
      this.select.dispatchEvent(new Event("change", { bubbles: true }));
      this.select.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  private keydown(event: KeyboardEvent): void {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const key = event.key;
    if (key === "Tab") {
      this.close(false);
      return;
    }
    if (key === "Escape" && this.expanded) {
      event.preventDefault();
      event.stopPropagation();
      this.close(true);
      return;
    }
    if (key.length === 1 && key !== " ") {
      event.preventDefault();
      event.stopPropagation();
      if (!this.expanded) this.open();
      const now = Date.now();
      this.typed = (now - this.typedAt < 800 ? this.typed : "") + key.toLocaleLowerCase();
      this.typedAt = now;
      const index = this.options.findIndex(option => !option.disabled && option.textContent?.toLocaleLowerCase().startsWith(this.typed));
      if (index >= 0) { this.highlighted = index; this.highlight(); }
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(key))
      return;
    event.preventDefault();
    event.stopPropagation();
    if (!this.expanded) {
      this.open();
      return;
    }
    if (key === "Enter" || key === " ") {
      this.choose(this.highlighted);
      return;
    }
    if (key === "Home") this.highlighted = 0;
    else if (key === "End") this.highlighted = this.options.length - 1;
    else
      this.highlighted = Math.max(
        0,
        Math.min(
          this.options.length - 1,
          this.highlighted + (key === "ArrowUp" ? -1 : 1),
        ),
      );
    this.highlight();
  }
}
