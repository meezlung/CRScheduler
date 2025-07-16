import { ProbabilityCalculator } from "./probability_calculator.js";

export class CRScraperRegistration {
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
        const text = row.textContent.trim();
        
        if (text === "No matching results") {
          throw new Error('No matching results found or invalid course URL');
        }

        const cells = Array.from(row.querySelectorAll('td'));
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

  // To be tested in Registration Period...
  formatSchedule(cells) {
    // Parse schedule strings
    let parts = cells[3].textContent.trim().split('\n');
    if (parts.length === 1) parts = parts[0].split('; ');

    // Extract slots and demand
    const availTotal = cells[6].textContent.trim().replace(/\u00a0/g, '').replace(/\n/g, '');
    const [avail, total] = availTotal.split('/').map(n => parseInt(n, 10));
    const demand = parseInt(cells[7].textContent.trim().replace(/\u00a0/g, ''), 10);

    // Extract credits
    const credits = cells[2].textContent.trim().split('\n').map(c => parseFloat(c.replace(/[()]/g, '')));
    const totalCredits = credits.reduce((a, b) => a + b, 0);

    // Extract instructor
    const instructor = cells[1].innerHTML.split('<br>')[1]?.trim() || '';

    // Extract waitlist & action
    const wait = cells[4].textContent.trim().split('\n')[0].toUpperCase();
    const action = cells[8].textContent.trim().split('\n')[0].toUpperCase();

    // Build schedule objects
    return parts.map(sched => {
      const [day, time, ...rest] = sched.split(' ');
      const room = rest.join(' ');
      let prob;
      if (wait === 'CLOSED' && action === 'ENLISTED ALREADY') {
        prob = 100.0;
      } else if (wait === 'CLOSED' || action === 'CLOSED') {
        prob = -100.0;
      } else {
        prob = Math.round(
          this.probCalc
            .calculateProbability(
              this.registrationPriority.toLowerCase(),
              avail, demand, true
            ) * 10000
        ) / 100;
      }

      return {
        Day: day,
        Time: time,
        Room: room || '',
        'Available Slots': avail,
        'Total Slots': total,
        Demand: demand,
        Credits: totalCredits,
        Probability: prob,
        Instructors: instructor
      };
    });
  }
}