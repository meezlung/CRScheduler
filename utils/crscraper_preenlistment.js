import { ProbabilityCalculator } from "./probability_calculator.js";

export class CRScraperPreenlistment {
  constructor() {
    this.preenlistmentPriority = "";
    this.registrationPriority = "";
    this.data = [];
    this.probCalc = new ProbabilityCalculator();
  }

  // Parse HTML to extract registration priorities
  getPriority(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const table = doc.querySelector('#content #rightcolumn table#registration_details');

    if (!table) return;
    table.querySelectorAll('tr').forEach(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 2) return;
      
      const key = cells[0].textContent.trim();
      const val = cells[1].textContent.trim();

      if (key.includes('Preenlistment Priority')) this.preenlistmentPriority = val;
      else if (key.includes('Registration Priority')) this.registrationPriority = val;
    });
  }

  accessAllPossibleCourseSchedules(htmls) {
    htmls.forEach(html => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const table = doc.querySelector('#content #rightcolumn table#tbl-search');

      if (!table) return;
      const rows = Array.from(table.querySelectorAll('tr')).slice(1);
      rows.forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 7 || !cells[1].querySelector('strong')) return;
        if (row.textContent.trim() === "No matching results") {
          throw new Error('No matching results found or invalid course URL');
        }
        this.appendSortedRowData(cells);
      });
    });
  }

  appendSortedRowData(cells) {
    const brSplit = /(?:<br\s*\/?>\s*){2,}/gi;

    // Raw splits
    const classCodes = cells[0].innerHTML.split(brSplit).map(s => s.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    const creditsArr = cells[2].innerHTML.split(brSplit).map(s => parseFloat(s.replace(/<[^>]+>/g, '').trim())).filter(n => !isNaN(n));
    const schedulesArr = cells[3].innerHTML.split(brSplit).map(s => s.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    const instructorArr = Array.from(cells[1].innerHTML.matchAll(/<strong>.*?<\/strong><br>([^<]+)/gi)).map(m => m[1].trim());

    // Dynamic slots/demand/remarks
    const texts = cells.map(td => td.textContent.replace(/\u00a0/g, '').trim());
    const slotIdx = texts.findIndex(t => /^\d+\s*\/\s*\d+$/.test(t));
    const [availableSlots, totalSlots] = slotIdx >= 0 ? texts[slotIdx].split('/').map(n => parseInt(n, 10)) : [0, 0];
    const demandIdx = texts.findIndex((t, i) => i > slotIdx && /^\d+$/.test(t));
    const demand = demandIdx >= 0 ? parseInt(texts[demandIdx], 10) : 0;
    const remarksIdx = texts.findIndex((t, i) => i > 1 && i < slotIdx);
    const remarks = remarksIdx >= 0 ? texts[remarksIdx] : '';

    // Pre-parse meets
    const meetsArr = schedulesArr.map(block => block.split(/;\s*/).filter(Boolean).map(entry => {
      const [day, time, ...roomParts] = entry.split(/\s+/);
      return { Day: day, Time: time, Room: roomParts.join(' ') };
    }));

    const strongEls = Array.from(cells[1].querySelectorAll('strong'));

    // Merge if one block has zero credits (e.g. lab+lec grouping)
    if (strongEls.length === 2 && (creditsArr[0] === 0 || creditsArr[1] === 0)) {
      const zeroIdx = creditsArr[0] === 0 ? 0 : 1;
      const realIdx = zeroIdx === 0 ? 1 : 0;
      const labelParts = strongEls[realIdx].textContent.trim().split(' ');
      const sectionName = labelParts.pop();
      const courseName = labelParts.join(' ');
      const combinedMeets = [...(meetsArr[0] || []), ...(meetsArr[1] || [])];
      const combinedCode = classCodes.join(',');
      const combinedCredit = (creditsArr[0] || 0) + (creditsArr[1] || 0);
      const instructor = instructorArr[realIdx] || instructorArr[zeroIdx] || '';
      const prob = Math.round(this.probCalc.calculateProbability(this.preenlistmentPriority.toLowerCase(), availableSlots, demand, true) * 10000) / 100;

      combinedMeets.forEach(m => Object.assign(m, {
        'Class Code': combinedCode,
        'Available Slots': availableSlots,
        'Total Slots': totalSlots,
        Demand: demand,
        Credits: combinedCredit,
        Probability: prob,
        Instructors: instructor,
        Remarks: remarks
      }));

      let subj = this.data.find(x => x[courseName]);
      if (!subj) { subj = { [courseName]: [] }; this.data.push(subj); }
      subj[courseName].push({ [sectionName]: combinedMeets });
      return;
    }

    // Default: each as its own section
    strongEls.forEach((el, idx) => {
      const parts = el.textContent.trim().split(' ');
      const section = parts.pop();
      const courseName = parts.join(' ');
      const meets = meetsArr[idx] || [];
      const code = classCodes[idx] || '';
      const credit = creditsArr[idx] || 0;
      const instructor = instructorArr[idx] || '';
      const prob = Math.round(this.probCalc.calculateProbability(this.preenlistmentPriority.toLowerCase(), availableSlots, demand, true) * 10000) / 100;

      meets.forEach(m => Object.assign(m, {
        'Class Code': code,
        'Available Slots': availableSlots,
        'Total Slots': totalSlots,
        Demand: demand,
        Credits: credit,
        Probability: prob,
        Instructors: instructor,
        Remarks: remarks
      }));

      let subj = this.data.find(x => x[courseName]);
      if (!subj) { subj = { [courseName]: [] }; this.data.push(subj); }
      subj[courseName].push({ [section]: meets });
    });
  }
}
