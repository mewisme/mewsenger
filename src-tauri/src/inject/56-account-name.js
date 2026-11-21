// Tells the app whose Messenger account this page is, so the tab can show the
// user's name and picture. Facebook's own record of the signed-in user holds the
// name (CurrentUserInitialData); it is there shortly after load, and read again
// now and then in case another user signs in. The picture is the user's own
// contact in Messenger's database, drawn small so it travels with the name.
let reportedName = null;
let reportedPicture = null;
let pictureTries = 0;
const PICTURE_SIZE = 64;
// The picture as a small square JPEG data URL, or null.
async function smallPicture(url) {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) return null;
  const bitmap = await createImageBitmap(await response.blob());
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PICTURE_SIZE;
  canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PICTURE_SIZE, PICTURE_SIZE);
  return canvas.toDataURL('image/jpeg', 0.8);
}
async function reportAccount() {
  let name = null;
  try { name = fbModules.require('CurrentUserInitialData')?.NAME; } catch { /* Not loaded yet. */ }
  if (typeof name !== 'string') return false;
  name = name.trim();
  if (!name || name.length > 80) return false;
  let picture = null;
  if (reportedPicture === null && pictureTries < 5) {
    pictureTries += 1;
    try {
      const url = await fbData.selfPictureUrl();
      picture = url ? await smallPicture(url) : null;
    } catch { picture = null; }
  }
  if (name === reportedName && !picture) return true;
  reportedName = name;
  if (picture) reportedPicture = picture;
  send(picture ? { kind: 'account_name', name, picture } : { kind: 'account_name', name });
  return true;
}
(function pollAccount(tries = 0) {
  reportAccount().catch(() => false).then((found) => {
    setTimeout(() => pollAccount(tries + 1), found ? (reportedPicture ? 60000 : 8000) : tries < 40 ? 1500 : 30000);
  });
})();
