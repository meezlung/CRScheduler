export function decodeHtmlEntities(str) {
  const el = document.createElement('textarea');
  el.innerHTML = str;
  return el.value;
}

// For each <strong>...</strong> block in a Class/Instructors cell, returns the
// last plain-text line before the next block (or end of cell). That line is
// always the instructor name (or "Concealed"), regardless of how many other
// lines (a course title, a prerequisite <div>, etc.) come before it.
export function extractInstructors(cellHtml) {
  return Array.from(cellHtml.matchAll(/<strong>[\s\S]*?<\/strong>([\s\S]*?)(?=<strong>|$)/gi))
    .map(m => {
      const lines = m[1]
        .split(/<br\s*\/?>/gi)
        .map(s => s.trim())
        .filter(s => s.length > 0 && !/</.test(s));
      return lines.length ? lines[lines.length - 1] : '';
    });
}
