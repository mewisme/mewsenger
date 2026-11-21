// Privacy: people's pictures as their initials, for screens others can see
// (Settings: hideAvatars). A person's picture in the chat list, the chat's
// header, beside messages and in the details is drawn as a circle with the
// first letter of the name, its colour following the name; one whose name
// cannot be told (the small "seen" pictures) as a grey circle. Pictures there
// are hidden until they have been looked at, so a photo never shows for a
// moment; those that are not people's (photos sent) are let through.
const AVATARS_HIDDEN = 'data-mew-hide-avatars';
const AVATAR = 'data-mew-avatar';
const AVATAR_SOURCE = 'data-mew-href';
const AVATAR_PLACES = ':is([role="navigation"] [role="row"], [data-mew-ui="chat-header"], [role="log"], [data-mew-ui="details"])';
const AVATAR_COLOURS = ['#c4314b', '#e3008c', '#8764b8', '#4f6bed', '#0078d4', '#038387', '#498205', '#ca5010'];
// Hides the pictures that have not been looked at yet; in the page only while
// pictures are hidden.
let avatarStyle = null;
const avatarStyleElement = () => {
  if (!avatarStyle) {
    avatarStyle = document.createElement('style');
    avatarStyle.textContent = `
  html[${AVATARS_HIDDEN}] ${AVATAR_PLACES} :is(img:not([src*="emoji.php"]), svg image):not([${AVATAR}]) { visibility: hidden !important; }
`;
  }
  return avatarStyle;
};
const initialPictures = new Map();
const initialPicture = (name) => {
  const letter = (name.match(/[\p{L}\p{N}]/u)?.[0] ?? '').toLocaleUpperCase();
  const colour = letter ? AVATAR_COLOURS[[...name].reduce((hash, c) => (hash * 31 + c.codePointAt(0)) >>> 0, 7) % AVATAR_COLOURS.length] : '#bcc0c4';
  const key = `${letter}${colour}`;
  if (!initialPictures.has(key)) {
    const text = letter
      ? `<text x='20' y='20' dy='.35em' text-anchor='middle' font-family='system-ui,sans-serif' font-size='18' font-weight='600' fill='white'>${letter}</text>`
      : '';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'><circle cx='20' cy='20' r='20' fill='${colour}'/>${text}</svg>`;
    initialPictures.set(key, `data:image/svg+xml,${encodeURIComponent(svg)}`);
  }
  return initialPictures.get(key);
};
// The name a picture stands for, from where it is; '' for a grey circle, null
// for a picture that is not a person's, undefined while it has no size yet.
const pictureName = (picture) => {
  const box = picture.getBoundingClientRect();
  if (!box.width || Math.abs(box.width - box.height) > 2 || box.width > 100) return box.width ? null : undefined;
  const row = picture.closest('[role="navigation"] [role="row"]');
  if (row) return picture.tagName === 'IMG' ? row.querySelector('a[role="link"] span[dir="auto"]')?.textContent ?? '' : picture.closest('svg')?.getAttribute('aria-label') ?? '';
  const header = picture.closest('[data-mew-ui="chat-header"]');
  if (header) return header.querySelector('h1, h2, h3')?.textContent ?? '';
  if (picture.closest('[role="log"]')) return box.width > 40 ? null : box.width > 20 ? picture.getAttribute('alt') ?? '' : '';
  return picture.closest('svg')?.getAttribute('aria-label') ?? picture.getAttribute('alt') ?? '';
};
const coverPicture = (picture) => {
  const name = pictureName(picture);
  if (name === undefined) return;
  if (name === null) return picture.setAttribute(AVATAR, 'none');
  const url = initialPicture(name);
  if (picture.tagName === 'IMG') picture.style.setProperty('content', `url("${url}")`, 'important');
  else {
    if (!picture.hasAttribute(AVATAR_SOURCE)) picture.setAttribute(AVATAR_SOURCE, picture.getAttribute('href') ?? picture.getAttribute('xlink:href') ?? '');
    picture.setAttribute('href', url);
  }
  picture.setAttribute(AVATAR, 'initial');
};
const uncoverPicture = (picture) => {
  if (picture.tagName === 'IMG') picture.style.removeProperty('content');
  else if (picture.hasAttribute(AVATAR_SOURCE)) {
    picture.setAttribute('href', picture.getAttribute(AVATAR_SOURCE));
    picture.removeAttribute(AVATAR_SOURCE);
  }
  picture.removeAttribute(AVATAR);
};
let hidingAvatars = false;
const coverPicturesIn = (root) => {
  if (!hidingAvatars) return;
  for (const picture of root.querySelectorAll(`${AVATAR_PLACES} :is(img:not([src*="emoji.php"]), svg image):not([${AVATAR}])`)) coverPicture(picture);
};
// New pictures are looked at in the frame they arrive in; a picture not laid
// out yet (no size) waits for the next look. Facebook may also give a picture
// already looked at another source (or another person): it is looked at again,
// and the source kept for when the switch is turned off is the new one (the
// initials drawn here do not count).
let pictureFrame = 0;
const avatarWatcher = new MutationObserver((records) => {
  for (const { type, target } of records) {
    if (type !== 'attributes' || !target.hasAttribute?.(AVATAR)) continue;
    const source = target.getAttribute('href') ?? target.getAttribute('src') ?? '';
    if (source.startsWith('data:image/svg+xml')) continue;
    if (target.hasAttribute(AVATAR_SOURCE)) target.setAttribute(AVATAR_SOURCE, source);
    target.removeAttribute(AVATAR);
  }
  pictureFrame ||= requestAnimationFrame(() => ((pictureFrame = 0), coverPicturesIn(document)));
});
let avatarTimer = 0;
const setHideAvatars = (hide) => {
  if (hide === hidingAvatars) return;
  hidingAvatars = hide;
  mewMarks.use(hide);
  withRoot((root) => {
    root.toggleAttribute(AVATARS_HIDDEN, hide);
    if (hide) root.append(avatarStyleElement());
    else avatarStyle?.remove();
  });
  avatarWatcher.disconnect();
  clearInterval(avatarTimer);
  cancelAnimationFrame(pictureFrame);
  pictureFrame = 0;
  if (hide) {
    withRoot((root) => avatarWatcher.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'href'] }));
    avatarTimer = setInterval(() => coverPicturesIn(document), 1000);
    coverPicturesIn(document);
  } else for (const picture of document.querySelectorAll(`[${AVATAR}]`)) uncoverPicture(picture);
};
setHideAvatars(mewPrefs.get('hideAvatars'));
mewPrefs.onChange((values) => setHideAvatars(values.hideAvatars));
