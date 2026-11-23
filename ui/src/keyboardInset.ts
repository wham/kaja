/**
 * How much of the bottom of the layout the on-screen keyboard is covering, as
 * `--keyboard-inset` on the root. iOS lays the keyboard over the page rather than
 * resizing it, so anything fixed to the bottom is under the keys unless it reads this.
 */
export function watchKeyboardInset(): void {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const measure = () => {
    const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop));
    document.documentElement.style.setProperty("--keyboard-inset", `${inset}px`);
  };
  viewport.addEventListener("resize", measure);
  viewport.addEventListener("scroll", measure);
  measure();
}
