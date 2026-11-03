/** Reuse xterm's native Alt+drag selection through DOM events, without private APIs. */
export function installRectangularSelection(
  pane: HTMLElement,
  enabled: () => boolean,
  mouseReporting: () => boolean,
): void {
  pane.addEventListener("mousedown", event => {
    if (!enabled() || event.button !== 0 || event.altKey || (mouseReporting() && !event.shiftKey)) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(".xterm-screen")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // A real drag still supplies the subsequent mousemove/mouseup events. xterm
    // chooses its native column-selection mode on this initial Alt+mousedown.
    target.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: event.clientX, clientY: event.clientY,
      screenX: event.screenX, screenY: event.screenY,
      button: event.button, buttons: event.buttons, detail: 1,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, metaKey: event.metaKey, altKey: true,
    }));
  }, true);
}
