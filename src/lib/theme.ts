export function syncSystemTheme(root: HTMLElement, media: MediaQueryList): () => void {
  const update = () => {
    root.classList.toggle("dark", media.matches);
    root.style.colorScheme = media.matches ? "dark" : "light";
  };
  update();
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
