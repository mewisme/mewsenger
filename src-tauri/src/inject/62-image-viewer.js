// Zoom and pan for Messenger's photo viewer: Ctrl+wheel and double click zoom,
// wheel and drag pan.
const viewerImage = () => [...document.querySelectorAll('[role="dialog"] img')]
  .filter((img) => img.getBoundingClientRect().width > 100 &&
    img.naturalWidth >= 240 && img.naturalHeight >= 160)
  .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0] ?? null;
const isOn = (el, x, y) => {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
};
let viewer = null;
let zoom = null;
let drag = null;
let suppressClick = false;
function resetZoom() {
  if (!zoom) return;
  Object.assign(zoom.img.style, zoom.original);
  zoom = null;
  drag = null;
}
function syncViewer() {
  const img = viewerImage();
  if (zoom && (zoom.img !== img || zoom.page !== location.href || !img?.isConnected)) resetZoom();
  const next = img?.closest('[role="dialog"]') ?? null;
  if (viewer === next) return;
  viewer?.removeEventListener('wheel', onWheel, true);
  viewer = next;
  viewer?.addEventListener('wheel', onWheel, { capture: true, passive: false });
}
function startZoom() {
  const img = viewerImage();
  if (!img) return false;
  if (zoom?.img === img && zoom.page === location.href) return true;
  resetZoom();
  zoom = { img, page: location.href, base: img.getBoundingClientRect(), scale: 1, x: 0, y: 0,
    original: { transform: img.style.transform, transformOrigin: img.style.transformOrigin,
      transition: img.style.transition, cursor: img.style.cursor } };
  img.style.transformOrigin = '0 0';
  return true;
}
function applyZoom(scale, x, y) {
  if (!zoom) return;
  scale = clamp(scale, 1, 8);
  if (scale <= 1) return resetZoom();
  const { base } = zoom;
  zoom.scale = scale;
  zoom.x = clamp(x, innerWidth - base.left - base.width * scale, -base.left);
  zoom.y = clamp(y, innerHeight - base.top - base.height * scale, -base.top);
  zoom.img.style.transform = 'translate(' + zoom.x + 'px,' + zoom.y + 'px) scale(' + scale + ')';
  zoom.img.style.cursor = drag ? 'grabbing' : 'grab';
}
function zoomAt(scale, x, y) {
  if (!startZoom()) return false;
  const { base } = zoom;
  const px = (x - base.left - zoom.x) / zoom.scale;
  const py = (y - base.top - zoom.y) / zoom.scale;
  applyZoom(scale, x - base.left - scale * px, y - base.top - scale * py);
  return true;
}
function onWheel(event) {
  if (!viewer || !viewerImage()) return;
  if (event.ctrlKey && isOn(viewerImage(), event.clientX, event.clientY)) {
    if (!zoomAt((zoom?.scale || 1) * Math.exp(-event.deltaY / 140), event.clientX, event.clientY)) return;
  } else if (zoom) applyZoom(zoom.scale, zoom.x - event.deltaX, zoom.y - event.deltaY);
  else return;
  event.preventDefault();
  event.stopPropagation();
}
document.addEventListener('dblclick', (event) => {
  const img = viewerImage();
  if (!img || !isOn(img, event.clientX, event.clientY)) return;
  event.preventDefault();
  if (zoom) resetZoom();
  else zoomAt(2.5, event.clientX, event.clientY);
}, true);
document.addEventListener('pointerdown', (event) => {
  if (!zoom || event.button !== 0 || event.target !== zoom.img ||
      !isOn(zoom.img, event.clientX, event.clientY)) return;
  drag = { x: event.clientX - zoom.x, y: event.clientY - zoom.y,
    startX: event.clientX, startY: event.clientY, moved: false };
  event.preventDefault();
}, true);
document.addEventListener('pointermove', (event) => {
  if (drag && zoom) {
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 3) drag.moved = true;
    applyZoom(zoom.scale, event.clientX - drag.x, event.clientY - drag.y);
  }
}, true);
document.addEventListener('pointerup', () => {
  if (drag?.moved) {
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
  }
  drag = null;
  if (zoom) zoom.img.style.cursor = 'grab';
}, true);
document.addEventListener('pointercancel', () => { drag = null; }, true);
document.addEventListener('click', (event) => {
  if (!suppressClick) return;
  suppressClick = false;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
window.addEventListener('resize', resetZoom);
