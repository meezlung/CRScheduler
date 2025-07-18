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
      
      if (key.includes('Preenlistment Priority')) {
        this.preenlistmentPriority = val;
      } else if (key.includes('Registration Priority')) {
        this.registrationPriority = val;
      }
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
        if (cells.length < 7) return;
        if (!cells[1].querySelector('strong')) return;

        const text = row.textContent.trim();
        if (text === "No matching results") {
          throw new Error('No matching results found or invalid course URL');
        }

        if (cells.length) {
          this.appendSortedRowData(cells);
        }
      });
    });
  }

  appendSortedRowData(cells) {
    const courseSectionFull = cells[1].querySelector('strong')?.textContent.trim() || '';
    // Handle cases like "Philo 1 THZ -1" where section may have extra spaces or tokens
    const [course, section] = (() => {
      const parts = courseSectionFull.split(' ');
      // If last part is "-1" or similar, treat it as part of the section
      if (parts.length > 2 && /^-?\d+$/.test(parts[parts.length - 1])) {
        return [parts.slice(0, -2).join(' '), parts.slice(-2).join(' ')];
      }
      // Handles subjects like "App Physics 185" (course name with spaces and number)
      if (parts.length > 2 && /^\d+$/.test(parts[parts.length - 1])) {
        return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
      }
      return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
    })();
    
    const formattedSchedule = this.formatSchedule(cells);
    
    let courseEntry = this.data.find(e => e[course]);

    if (!courseEntry) {
      courseEntry = { [course]: [] };
      this.data.push(courseEntry);
    }
    courseEntry[course].push({ [section]: formattedSchedule });
  }

  formatSchedule(cells) {
    // Extract course and section
    const courseSectionFull = cells[1].querySelector('strong')?.textContent.trim() || '';
    const sectionOnly = courseSectionFull.split(' ').pop();

    // Extract instructor
    const instructor = cells[1].innerHTML.split('<br>')[1]?.trim() || '';

    // Extract schedule
    let scheduleParts = cells[3].textContent.trim().split('\n');
    if (scheduleParts.length === 1) {
      scheduleParts = scheduleParts[0].split('; ');
    }

    // Extract slots and demand
    const availableAndTotalSlots = cells[5].textContent.trim().replace(/\u00a0/g, '').replace(/\n/g, '');
    const [availableSlots, totalSlots] = availableAndTotalSlots.split('/').map(n => parseInt(n, 10));
    const demand = parseInt(cells[6].textContent.trim().replace(/\u00a0/g, ''), 10);

    // Extract credits
    const credits = cells[2].textContent.trim().split('\n').map(c => parseFloat(c.replace(/\(|\)/g, '')));
    const totalCredits = credits.reduce((a, b) => a + b, 0);

    // Extract class code
    const classCode = cells[0].textContent.trim();

    // Format schedule array
    const formattedSchedules = scheduleParts.map(sched => {
      // Split schedule string into parts
      const schedParts = sched.split(' ');
      const day = schedParts[0];
      const time = schedParts[1];
      // Room may be multiple words (e.g., "lec CAL 212"), so join the rest
      const room = schedParts.slice(2).join(' ');

      const prob = this.probCalc.calculateProbability(
        this.preenlistmentPriority.toLowerCase(),
        availableSlots,
        demand,
        true
      ) * 100;
      return {
        'Class Code': classCode,
        Day: day,
        Time: time,
        Room: room || '',
        'Available Slots': availableSlots,
        'Total Slots': totalSlots,
        Demand: demand,
        Credits: totalCredits,
        Probability: Math.round(prob * 100) / 100,
        Instructors: instructor
      };
    });

    return formattedSchedules;
  }
}