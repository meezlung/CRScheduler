// Returns true if the given CRS page HTML is a genuine authenticated page
// rather than the landing/login page CRS serves once the session has expired.
export function isLoggedIn(html) {
  return /You are logged in as/i.test(html);
}

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
        .map(s => decodeHtmlEntities(s).trim())
        .filter(s => s.length > 0 && !/</.test(s));
      return lines.length ? lines[lines.length - 1] : '';
    });
}

// Parses a Schedule/Room/Instructors cell into per-block meetings. Each block
// (separated by 2+ <br>) is a Day/Time/Room line, then an Instructor line
// (e.g. a name or "Concealed"), then a Mode-of-Delivery line, each separated
// by a single <br>. Returns an array of arrays of { Day, Time, Room, Instructors }.
export function parseScheduleBlocks(cellHtml) {
  const brSplit = /(?:<br\s*\/?>\s*){2,}/gi;
  return cellHtml.split(brSplit)
    .map(raw => decodeHtmlEntities(raw))
    .filter(raw => raw.replace(/<[^>]+>/g, '').trim().length > 0)
    .map(raw => {
      const [meetingLine = '', instructorLine = ''] = raw
        .split(/<br\s*\/?>/gi)
        .map(l => l.replace(/<[^>]+>/g, '').trim());
      return meetingLine.split(/;\s*/).filter(Boolean).map(entry => {
        const [day, time, ...roomParts] = entry.split(/\s+/);
        return { Day: day, Time: time, Room: roomParts.join(' '), Instructors: instructorLine };
      });
    });
}
