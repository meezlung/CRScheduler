export function decodeHtmlEntities(str) {
  const el = document.createElement('textarea');
  el.innerHTML = str;
  return el.value;
}
