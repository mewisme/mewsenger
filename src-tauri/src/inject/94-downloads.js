// In a chat that is not end-to-end encrypted, Download links to the photo or
// video on Facebook's CDN, another site, so the browser opens a new window
// instead of downloading. The page fetches the file instead (the CDN allows
// that without cookies) and saves it from a blob: under the CDN's file name.
// If the fetch fails, the click runs again untouched.
let cdnDownloadRetry = null;

const cdnDownloadName = (url) => {
  let name = url.pathname.split('/').pop() || '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the encoded name
  }
  return name || 'download';
};

const cdnDownloadSave = async (url) => {
  const response = await fetch(url.href, { credentials: 'omit' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blobUrl = URL.createObjectURL(await response.blob());
  const saver = document.createElement('a');
  saver.href = blobUrl;
  saver.download = cdnDownloadName(url);
  document.body.append(saver);
  saver.click();
  saver.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
};

document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  const link = event.target instanceof Element
    ? event.target.closest('a[download][href]') : null;
  if (!link || link === cdnDownloadRetry) return;

  let url;
  try {
    url = new URL(link.href, location.href);
  } catch {
    return;
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.fbcdn.net')) return;

  event.preventDefault();
  cdnDownloadSave(url).catch(() => {
    cdnDownloadRetry = link;
    try {
      link.click();
    } finally {
      cdnDownloadRetry = null;
    }
  });
}, true);
