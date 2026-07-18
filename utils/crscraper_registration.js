import { ProbabilityCalculator } from "./probability_calculator.js";

function decodeHtmlEntities(str) {
  const el = document.createElement('textarea');
  el.innerHTML = str;
  return el.value;
}

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
    const brSplit = /(?:<br\s*\/?>\s*){2,}/gi;

    // Raw splits for blocks
    const classCodes = cells[0].innerHTML.split(brSplit).map(s => s.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
    const creditsArr = cells[2].innerHTML.split(brSplit).map(s => parseFloat(s.replace(/<[^>]+>/g, '').trim())).filter(n => !isNaN(n));
    const schedulesArr = cells[3].innerHTML.split(brSplit).map(s => decodeHtmlEntities(s.replace(/<[^>]+>/g, '')).trim()).filter(Boolean);
    const instructorArr = Array.from(cells[1].innerHTML.matchAll(/<strong>.*?<\/strong><br>([^<]+)/gi)).map(m => m[1].trim());

    // dynamic detection of slots/demand
    const texts = cells.map(td => td.textContent.replace(/\u00a0/g, '').trim());
    const slotIdx = texts.findIndex(t => /^\d+\s*\/\s*\d+$/.test(t));
    const [avail, total] = slotIdx >= 0 ? texts[slotIdx].split('/').map(n=>parseInt(n,10)) : [0,0];
    const demandIdx = texts.findIndex((t,i)=>i>slotIdx && /^\d+$/.test(t));
    const demand = demandIdx>=0?parseInt(texts[demandIdx],10):0;

    // parse waitlist and action
    const wait = cells[4].textContent.trim().split('\n')[0].toUpperCase();
    const action = cells[8]?.textContent.trim().split('\n')[0].toUpperCase()||'';

    // parse meets blocks
    const meetsArr = schedulesArr.map(block => block.split(/;\s*/).filter(Boolean).map(entry => {
      const [day, time, ...roomParts] = entry.split(/\s+/);
      return { Day: day, Time: time, Room: roomParts.join(' ') };
    }));

    const strongEls = Array.from(cells[1].querySelectorAll('strong'));

    // merge blocks when one credit is zero (e.g. lab+lec grouping)
    if (strongEls.length===2 && (creditsArr[0]===0||creditsArr[1]===0)) {
      const zeroIdx = creditsArr[0]===0?0:1;
      const realIdx = zeroIdx===0?1:0;
      const parts = strongEls[realIdx].textContent.trim().split(' ');
      const sectionName = parts.pop();
      const courseName = parts.join(' ');
      const combined = [...(meetsArr[0]||[]),...(meetsArr[1]||[])];
      const codeCombined = classCodes.join(',');
      const creditCombined = (creditsArr[0]||0)+(creditsArr[1]||0);
      const inst = instructorArr[realIdx]||instructorArr[zeroIdx]||'';

      const probBase = this.registrationPriority.toLowerCase();
      combined.forEach(m=>{
        let prob;
        if(wait==='CLOSED'&&action.includes('ENLISTED')) prob=100;
        else if(wait==='CLOSED'||action==='CLOSED') prob=-100;
        else prob=Math.round(this.probCalc.calculateProbability(probBase,avail,demand,true)*10000)/100;
        Object.assign(m,{
          'Class Code': codeCombined,
          'Available Slots': avail,
          'Total Slots': total,
          Demand: demand,
          Credits: creditCombined,
          Probability: prob,
          Instructors: inst
        });
      });
      let subj=this.data.find(x=>x[courseName]);
      if(!subj){subj={ [courseName]:[]};this.data.push(subj);}      
      subj[courseName].push({ [sectionName]: combined });
      return;
    }

    // default: each block separate
    strongEls.forEach((el,idx)=>{
      const parts = el.textContent.trim().split(' ');
      const section = parts.pop();
      const courseName = parts.join(' ');
      const meets = meetsArr[idx]||[];
      const code = classCodes[idx]||'';
      const credit = creditsArr[idx]||0;
      const inst = instructorArr[idx]||'';

      const probBase=this.registrationPriority.toLowerCase();
      meets.forEach(m=>{
        let prob;
        if(wait==='CLOSED'&&action.includes('ENLISTED')) prob=100;
        else if(wait==='CLOSED'||action==='CLOSED') prob=-100;
        else prob=Math.round(this.probCalc.calculateProbability(probBase,avail,demand,true)*10000)/100;
        Object.assign(m,{
          'Class Code': code,
          'Available Slots': avail,
          'Total Slots': total,
          Demand: demand,
          Credits: credit,
          Probability: prob,
          Instructors: inst
        });
      });
      let subj=this.data.find(x=>x[courseName]);
      if(!subj){subj={ [courseName]:[]};this.data.push(subj);}
      subj[courseName].push({ [section]: meets });
    });
  }
}