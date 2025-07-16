const DAY_OFFSET = { Mon:0, Tue:48, Wed:96, Thu:144, Fri:192, Sat:240, Sun:288 };

export class ScheduleGenerator {
  constructor(subjectsWithTime) {
    this.subjectsWithTime = subjectsWithTime;
    this.daysMapping = {
      "M": ["Monday"],
      "T": ["Tuesday"],
      "W": ["Wednesday"],
      "Th": ["Thursday"],
      "F": ["Friday"],
      "S": ["Saturday"],
      "Su": ["Sunday"],
    };
  }

  /**
   * Parse an entry like "MWF" or "TTh" into full day names
   */
  parseDays(daysStr) {
    const result = [];
    let i = 0;
    const abbrs = Object.keys(this.daysMapping);
    while (i < daysStr.length) {
      let matched = false;
      for (const abbr of abbrs) {
        if (daysStr.startsWith(abbr, i)) {
          result.push(...this.daysMapping[abbr]);
          i += abbr.length;
          matched = true;
          break;
        }
      }
      if (!matched) i++;
    }
    return result;
  }

  /**
   * Convert "7:30AM-9:00AM" into [Date, Date]
   */
  parseTime(range) {
    let [start, end] = range.split('-');
    const fix = t => {
      if (!/[APM]$/i.test(t)) {
        const ampm = /AM|PM/i.exec(end)?.[0] || '';
        t += ampm;
      }
      if (!/:/.test(t)) {
        t = t.replace(/(AM|PM)$/i, ':00$1');
      }
      return t;
    };
    start = fix(start.trim());
    end = end.trim();
    if (!/:/.test(end)) end = end.replace(/(AM|PM)$/i, ':00$1');

    const fmt = s => new Date(
      `2024-01-01T${
        // to ISO
        s.replace(/(\d+):(\d+)(AM|PM)/i, (_, h, m, p) => {
          let hh = parseInt(h,10) % 12;
          if (/PM/i.test(p)) hh += 12;
          return (hh<10?'0'+hh:hh) + ':' + m + ':00';
        })
      }`
    );

    return [fmt(start), fmt(end)];
  }

  /**
   * Check if newSchedule conflicts with any in accumulated
   * @param {Array<Array<Object>>} accumulated
   * @param {Array<Object>} candidate
   */
  checkConflict(accumulated, candidate) {
    for (const existing of accumulated) {
      for (const e of existing) {
        for (const c of candidate) {
          const days1 = this.parseDays(e.Day);
          const days2 = this.parseDays(c.Day);
          if (days1.some(d=>days2.includes(d))) {
            const [s1,e1] = this.parseTime(e.Time);
            const [s2,e2] = this.parseTime(c.Time);
            if (s1 < e2 && s2 < e1) return true;
          }
        }
      }
    }
    return false;
  }

  backtrack(currentIndex, currentSchedule, allSchedules, accumulatedTimes) {
    if (currentIndex >= this.subjectsWithTime.length) {
      allSchedules.push([...currentSchedule]);
      return;
    }
    const entry = this.subjectsWithTime[currentIndex];
    const course = Object.keys(entry)[0];
    const sections = entry[course];
    for (const secObj of sections) {
      const section = Object.keys(secObj)[0];
      const sched = secObj[section];
      if (!this.checkConflict(accumulatedTimes, sched)) {
        currentSchedule.push({ [course]: [{ [section]: sched }] });
        accumulatedTimes.push(sched);
        this.backtrack(currentIndex+1, currentSchedule, allSchedules, accumulatedTimes);
        currentSchedule.pop();
        accumulatedTimes.pop();
      }
    }
  }
  
  /**
   * @returns {Array<Object>} all schedules combos
   */
  generateSchedules() {
    const allSchedules = [];
    this.backtrack(0, [], allSchedules, []);
    return allSchedules;
  }
}

self.onmessage = ({ data }) => {
  const { type, payload } = data;

  if (type === 'GENERATE_SCHEDULES') {
    try {
      const { scrapedData } = payload;

      console.log('Schedule Worker called!');

      // Only keep the heavy computation part here in the worker
      const scheduleGenerator = new ScheduleGenerator(scrapedData);
      const generatedSchedules = scheduleGenerator.generateSchedules();

      postMessage({ success: true, data: generatedSchedules });
    } catch (err) {
      postMessage({ success: false, error: err.message });
    }
  }
};