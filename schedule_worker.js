export class ScheduleGenerator {
  constructor(subjectsWithTime, forbiddenSlots = [], rawProfs = [], strict = false) {
    // this.subjectsWithTime = subjectsWithTime.sort(
    //   (a,b) => Object.values(a)[0].length - Object.values(b)[0].length
    // );

    this.subjectsWithTime = subjectsWithTime
    .map(subj => {
      const course = Object.keys(subj)[0];
      const sections = subj[course].slice();
      // Sort sections by descending single-section probability
      sections.sort((a, b) => this.sectionProbability(b) - this.sectionProbability(a));
      return { [course]: sections };
    })
    .sort((a, b) => {
      // First by fewest sections
      const lenA = Object.values(a)[0].length;
      const lenB = Object.values(b)[0].length;
      if (lenA !== lenB) return lenA - lenB;
      // Then by the max section probability (descending)
      const maxA = Math.max(...Object.values(a)[0].map(sec => this.sectionProbability(sec)));
      const maxB = Math.max(...Object.values(b)[0].map(sec => this.sectionProbability(sec)));
      return maxB - maxA;
    });

    this.daysMapping = {
      "M": ["Monday"],
      "T": ["Tuesday"],
      "W": ["Wednesday"],
      "Th": ["Thursday"],
      "F": ["Friday"],
      "S": ["Saturday"],
      "Su": ["Sunday"],
    };

    this.forbiddenSet = new Set(
      forbiddenSlots.flatMap(({ day, slot }) => {
        // Turn "Tuesday" into its tokens ["T"]
        // and "Thursday" into ["Th"]
        const tokenFor = Object.entries(this.daysMapping)
          .find(([tok, fulls]) => fulls.includes(day))?.[0];
        return tokenFor
          ? [`${tokenFor}|${slot}`]
          : []; 
      })
    );

    this.rawProfs = rawProfs;
    this.strict = strict;

    // For grouping similar shape schedule combinations
    this.similarShapeCombinations = new Map();

    this.maxCombos = 500000;
  }

  /**
   * Helper: compute section probability
   */
  sectionProbability(secObj) {
    const meets = Object.values(secObj)[0];
    return meets
      .map(meet => {
        const raw = Math.max(0, Number(meet.Probability));
        return raw;
      }).reduce((prod, x) => prod * x, 1);
  }

  /**
   * Split "TTh" → ["T","Th"]
   */
  splitTokens(s) {
    return [...s.matchAll(/Th|Su|M|T|W|F|S/g)].map(m => m[0]);
  }

  timeToSlots(timeStr) {
    let [rawStart, rawEnd] = timeStr.split('-').map(s => s.trim());
    // pull off AM/PM from end
    const mEnd = rawEnd.match(/(AM|PM)$/i);
    if (!mEnd) throw new Error("Cannot parse end time: " + rawEnd);
    const ampm = mEnd[1].toUpperCase();
    let end = rawEnd.replace(/(AM|PM)$/i, '');
    let start = rawStart;

    // if start has no AM/PM, tack on the one from end
    if (!/AM|PM$/i.test(start)) start += ampm;

    // ensure both have minutes
    function normalize(t) {
      // now t looks like “H” or “H:MM” plus AM/PM
      const m = t.match(/^(\d{1,2})(?::(\d{2}))?(AM|PM)$/i);
      if (!m) throw new Error("Bad time: " + t);
      let h = parseInt(m[1],10), mm = m[2] ? parseInt(m[2],10) : 0, ap = m[3].toUpperCase();
      // roll 12‑hour to 24‑hour
      if (h === 12) h = ap === 'AM' ? 0 : 12;
      else if (ap === 'PM') h += 12;
      return { h, mm };
    }

    const s = normalize(start);
    const e = normalize(end + ampm);

    // compute minutes since 7:00
    const toSlot = ({h, mm}) => ((h * 60 + mm) - (7 * 60)) / 30; // Don't floor this to output floating points. This is so that we account for 11:45, 12:45...

    return [ toSlot(s), toSlot(e) ];
  }

  /**
   * Assume your existing timeToSlots returns [floatStart, floatEnd]
   */
  timeToSlotsBucketed(timeStr) {
    const [rawStart, rawEnd] = this.timeToSlots(timeStr);
    // floor the start into its half‑hour bin, ceil the end so you cover
    const startSlot = Math.floor(rawStart);
    const endSlot   = Math.ceil (rawEnd);
    return [startSlot, endSlot];
  }

  /**
   * Check if a section schedule touches forbidden slots
   */
  hitsForbidden(schedule){
    for(let meet of schedule){
      const days = this.splitTokens(meet.Day);
      const [s,e] = this.timeToSlotsBucketed(meet.Time);
      for(let day of days){
        for(let slot=s; slot<e; slot++){
          if(this.forbiddenSet.has(`${day}|${slot}`)) return true;
        }
      }
    }
    return false;
  }

  /**
   * Record similar‑shape key for a combo
   */
  recordShape(combo){
    const MAX_PER_SHAPE = 10;

    // flatten into day|slot strings
    const keys = combo.flatMap(item=> 
      Object.values(item)[0].flatMap(secObj=>
        Object.values(secObj)[0].flatMap(meet=>{
          const days = this.splitTokens(meet.Day);
          const [s,e] = this.timeToSlotsBucketed(meet.Time);
          return days.flatMap(d=>Array.from({length:e-s},(_,i)=>`${d}|${s+i}`));
        })
      )
    ).sort();
    const key = keys.join(',');
    const bucket = this.similarShapeCombinations.get(key) || [];
    if (bucket.length < MAX_PER_SHAPE) {
      bucket.push(JSON.parse(JSON.stringify(combo))); // Deep clone
      this.similarShapeCombinations.set(key, bucket);
    }
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
   * Check prof filter on a _full_ combo
   */
  profOK(combo) {
    if (!this.rawProfs.length) return true;
    const matches = prof => combo.some(item => {
      const details = Object.values(item)[0][0][Object.keys(Object.values(item)[0][0])[0]][0];
      return details.Instructors.toLowerCase().includes(prof);
    });
    return this.strict
      ? this.rawProfs.every(matches)
      : this.rawProfs.some(matches);
  }
  
  /**
   * Conflict check between two meetings
   */
  conflicts(m1, m2){
    const days1 = this.splitTokens(m1.Day), days2 = this.splitTokens(m2.Day);
    if(!days1.some(d=>days2.includes(d))) return false;
    const [s1,e1]=this.parseTime(m1.Time), [s2,e2]=this.parseTime(m2.Time);
    return s1<e2 && s2<e1;
  }

  /**
   * Check if candidate conflicts with any in accumulated
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

  /**
   * Generates all possible schedule with given filter constraints
   */
  backtrack(idx, current, out, chosenSchedules){
    if (out.length >= this.maxCombos) return; // Safety check to prevent crashing out the page

    if (idx===this.subjectsWithTime.length) {
      if (this.profOK(current)) {
        out.push([...current]);
        this.recordShape(current);
      }
      return;
    }

    const subj = this.subjectsWithTime[idx], course=Object.keys(subj)[0];
    for(let secObj of subj[course]){
      if (out.length >= this.maxCombos) break;  // Another safety check just in case

      const section = Object.keys(secObj)[0], meets=secObj[section];

      // Prune forbidden
      if(this.hitsForbidden(meets)) continue;

      // Prune conflicts
      if(chosenSchedules.some(chosen=>
        chosen.some(cm=>meets.some(m=>this.conflicts(cm,m)))
      )) continue;

      // Choose
      current.push({ [course]:[{ [section]:meets }] });
      chosenSchedules.push(meets);

      // Explore
      this.backtrack(idx+1, current, out, chosenSchedules);

      // Un-choose
      current.pop();
      chosenSchedules.pop();
    }
  }
  
  /**
   * Combined probability in one combo
   */
  combinedProbability(combo) {
    const probs = combo.flatMap(item =>
      Object.values(item)[0].flatMap(secObj =>
        Object.values(secObj)[0].map(meet => {
          if (meet.Probability !== null) {
            const raw = Math.max(0, Number(meet.Probability));
            return raw;
          }  
        })
      )
    );
    if (probs.length === 0) return 0;
    return probs.reduce((prod, x) => prod * x, 1);
  }

  /**
   * Generates all possible schedule with given filter constraints and sorts them
   */
  generateSchedules(){
    const out = [];
    this.backtrack(0, [], out, []);

    const withProb = out.map(combo => ({
      combo,
      prob: this.combinedProbability(combo),
    }));

    withProb.sort((a, b) => b.prob - a.prob);

    const sortedSchedules = withProb.map(x => x.combo);

    return {
      generatedSchedules: sortedSchedules,
      similarShapeCombinations: this.similarShapeCombinations
    };
  }
}

self.onmessage = ({ data }) => {
  const { type, payload } = data;

  if (type === 'GENERATE_SCHEDULES') {
    try {
      const { scrapedData, forbiddenSlots, rawProfs, strict } = payload;

      console.log('Schedule Worker called!');
      console.log('forbiddenSlots in Worker!', forbiddenSlots);

      const startTime = performance.now();

      // Only keep the heavy computation part here in the worker
      const scheduleGenerator = new ScheduleGenerator(scrapedData, forbiddenSlots, rawProfs, strict);
      const { generatedSchedules, similarShapeCombinations } = scheduleGenerator.generateSchedules();

      console.log('generatedSchedules', generatedSchedules);
      console.log('similarSched', similarShapeCombinations);

      const endTime = performance.now();
      console.log(`Schedule generation took ${(endTime - startTime).toFixed(2)} ms`);

      postMessage({ success: true, data: { generatedSchedules, similarShapeCombinations } });
    } catch (err) {
      postMessage({ success: false, error: err.message });
    }
  }
};