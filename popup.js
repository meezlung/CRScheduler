function getBlockedTimes() {
  const blocked = [];
  document.querySelectorAll('.grid-cell').forEach(cell => {
    if (cell.dataset.blocked === 'true') {
      blocked.push({
        day: cell.dataset.day,
        slot: Number(cell.dataset.slot),
        // optional human‑readable time:
        time: slotToTime(Number(cell.dataset.slot))
      });
    }
  });
  return blocked;
}

// TODO: small improvement is to memoize this
function slotToTime(slot) {
  const hour = 7 + Math.floor(slot/2);
  const minute = slot % 2 === 0 ? '00' : '30';
  const ampm = hour < 12 ? 'AM' : 'PM';
  const h12 = ((hour + 11) % 12) + 1;
  return `${h12}:${minute} ${ampm}`;
}

// TODO: small improvement is to memoize this
function timeToSlots(timeStr) {
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
  const toSlot = ({h, mm}) => Math.floor(((h * 60 + mm) - (7 * 60)) / 30);

  return [ toSlot(s), toSlot(e) ];
}

// Global map for day parsing, maybe there's a better way of doing this
// TODO: improve this
const dayMap = {
  "M": ["Monday"],
  "T": ["Tuesday"],
  "W": ["Wednesday"],
  "Th": ["Thursday"],
  "F": ["Friday"],
  "S": ["Saturday"],
  "Su": ["Sunday"],
  "MWF": ["Monday", "Wednesday", "Friday"],
  "TTh": ["Tuesday", "Thursday"],
  "WF": ["Wednesday", "Friday"],
  "TF": ["Tuesday", "Friday"],
  "MW": ["Monday", "Wednesday"],
  "MTWThF": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
};

// For caching -> { urlKey: JSON payload }
const scheduleCache = new Map();

document.addEventListener('DOMContentLoaded', () => {
  // For dynamic rendering of table
  const CHUNK_SIZE = 20;

  // For detecting whether there are or no matches found in renderTable
  let anyRendered = false;

  // Format the table by generating time slots with for loop, hard coding div's is tiring
  const container = document.querySelector('.grid-container');
  for (let slot = 0; slot < 25; slot++) {
    // 1) time label
    const hour = 7 + Math.floor(slot / 2);
    const minute = slot % 2 === 0 ? '00' : '30';
    const ampm = hour < 12 ? 'AM' : 'PM';
    const displayHour = ((hour + 11) % 12) + 1;
    const label = document.createElement('div');
    label.className = 'grid-times';
    label.textContent = `${displayHour}:${minute} ${ampm}`;
    container.appendChild(label);

    // 2) one cell per day Mon–Sat (6)
    for (let day = 0; day < 6; day++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.dataset.blocked = 'false';
      cell.addEventListener('click', () => {
        cell.dataset.blocked = cell.dataset.blocked === 'true' ? 'false' : 'true';
        cell.classList.toggle('blocked');
      });

      cell.dataset.day = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][day];
      cell.dataset.slot = slot;  

      container.appendChild(cell);
    }
  }

  // -----------------------
  // Time table painting logic
  let isMouseDown = false;
  let paintMode = null; // "block" or "unblock"

  // This is called if dragging mouse click
  function applyPaint(cell) {
    if (paintMode === 'block') {
      cell.dataset.blocked = 'true';
      cell.classList.add('blocked');
    } else if (paintMode === 'unblock') {
      cell.dataset.blocked = 'false';
      cell.classList.remove('blocked');
    }
  }

  // Basically two modes of input:
  // 1) Single‐click toggle
  container.addEventListener('click', e => {
    if (!e.target.classList.contains('grid-cell')) return;
    const cell = e.target;
    const blocked = cell.dataset.blocked === 'true';
    cell.dataset.blocked = (!blocked).toString();
    cell.classList.toggle('blocked', !blocked);
  });

  // 2) Brush‐painting on drag
  container.addEventListener('mousedown', e => {
    if (!e.target.classList.contains('grid-cell')) return;
    isMouseDown = true;
    // decide if we're blocking or unblocking
    paintMode = e.target.dataset.blocked === 'true' ? 'unblock' : 'block';
    applyPaint(e.target);
    e.preventDefault(); // prevents text selection
  });

  container.addEventListener('mouseover', e => {
    if (!isMouseDown) return;
    if (!e.target.classList.contains('grid-cell')) return;
    applyPaint(e.target);
  });

  window.addEventListener('mouseup', () => {
    isMouseDown = false;
    paintMode = null;
  });
  // -----------------------


  // Grab manifest
  const manifest = chrome.runtime.getManifest();
  console.log('manifest', manifest);

  // Then safely pull BACKEND URL, acts like a dotenv
  const BACKEND = manifest.crsConfig?.backendURL;
  console.log('BACKEND', BACKEND);

  if (!BACKEND) {
    console.error("⚠️ No backend URL configured!");
  }

  // This part is for awaiting the Promise for teacherMap
  const fetchBtn = document.getElementById('fetchBtn');
  fetchBtn.disabled = true;  // start disabled

  // Fetch from latest RUPP website. NakaIIFE (Immediately Invoked Function Expression) para magexecute na agad. Don't have to reference it. 
  // Since Promises resolve to Response in this case, we need to use await to avoid unresolved Promises. This fixes the 'RUPP1JSON' is not a function.
  // Since we use await, we need to use async.
  const teacherMap = new Map();

  (async () => {
    try {
      const RUPP1Data = await fetch(`${BACKEND}/fetch-rupp1`);
      const RUPP1JSON = await RUPP1Data.json();
      RUPP1JSON.teachers.teachers.forEach(t => {
        const key = `${t.firstName} ${t.lastName}`.toLowerCase();
        teacherMap.set(key, t.id);
      });
    } catch (e) {
      console.error("Could not load RUPP teacher map", e);
    } finally {
      fetchBtn.disabled = false;  // Now safe to click
    }
  })();

  document.getElementById('clearPaint').addEventListener('click', () => {
    document.querySelectorAll('.grid-cell').forEach(cell => {
      cell.dataset.blocked = 'false';
      cell.classList.remove('blocked');
    });
  });

  document.getElementById('fetchBtn').addEventListener('click', async () => {
    // Fetch from the timetable
    const forbiddenSlots = getBlockedTimes();
    console.log('User blocked these:', forbiddenSlots);

    // Put this locally instead of globally to catch the input right away.
    // Then we feed this in renderTable.
    const faveProfsInput = document.getElementById('professorName');
    const strictProfMatchCheckbox = document.getElementById('strictProfMatch');

    // I've put this here so that it awaits right away. This is a bug when I try to change the input box last second after clicking the fetchBtn
    // Filter 1.0 Get raw prof input
    const rawProfs = faveProfsInput.value.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0);
    console.log('rawProfs', rawProfs);

    const strict = strictProfMatchCheckbox.checked;
    console.log('strict', strict);

    const status = document.getElementById('status');
    const results = document.getElementById('results');
    const raw = document.getElementById('urls').value.trim();

    results.innerHTML = '';
    status.textContent = '';

    if (!raw) {
      status.textContent = 'Please enter at least one URL.';
      return;
    }

    const urls = raw.split(',').map(u=>u.trim()).filter(u=>u);
    const urlKey = urls.slice().sort().join('');
    console.log('urlKey', urlKey);

    // IMPORTANT! To not fetch the same URLs over and over again, which makes it slow, we need to cache the JSON payload from the URLs.
    if (scheduleCache.has(urlKey)) {
      const cached = scheduleCache.get(urlKey); // This is now the previously fetched JSON with the same URL
      console.log("Using cached schedules!");
      return renderTable(cached, rawProfs, strict, forbiddenSlots);

    } else {
      // We need to do the ordinary fetching. Make sure to set in scheduleCache!
      try {
        // TODO: Only fetch priority once!
        status.textContent = 'Fetching priorities...';
        // 1.0 Get classmessages and scrape priorities HTML page
        const classMsgResp = await fetch('https://crs.upd.edu.ph/user/view/classmessages', {
          credentials: 'include'
        });
        const classMsgHtml = await classMsgResp.text();

        // 1.1 Feed the classmessages HTML page to /scrape-priority endpoint
        const prioResp = await fetch(`${BACKEND}/scrape-priority`, {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ html: classMsgHtml })
        });

        const prioJson = await prioResp.json();
        if (prioJson.status !== 'success') {
          throw new Error(prioJson.message || 'Failed to scrape priorities');
        }
        const { preenlistment_priority, registration_priority } = prioJson;

        // 2. Get HTML pages for each course URL and scrape each table by calling the backend
        let allSchedules = [];
        let allCourseHTML = [];
        let isPreenlismentLink = false;
        let isRegistrationLink = false;
        let endpointCall = "";

        let preenlistmentCount = 0;
        let registrationCount = 0;

        for (let url of urls) {
          // Temporarily comment these
          // status.textContent = `Processing ${url}...`;

          if (url.includes('/preenlistment')) preenlistmentCount++;
          if (url.includes('/student_registration')) registrationCount++;

          // // fetch the course page HTML
          // const courseResp = await fetch(url, { credentials: 'include' });
          // const courseHtml = await courseResp.text();
          // allCourseHTML.push(courseHtml);
        }

        // 3. Ensure all URLs are of the same type
        if (preenlistmentCount === urls.length) {
          endpointCall = '/scrape-links-preenlistment';
        } else if (registrationCount === urls.length) {
          endpointCall = '/scrape-links-registration';
        } else {
          throw new Error('All URLs must be either preenlistment or registration links.');
        }

        // Temporarily
        endpointCall = '/test-schedules2';

        // 4. Call the backend endpoint call
        let linkResponse;
        try {
          status.textContent = 'Processing URLs...'; // Temporarily
          linkResponse = await fetch(
            `${BACKEND}${endpointCall}`, 
            {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
              }
            }
          );
          if (!linkResponse.ok) {
            throw new Error(`Backend returned status ${linkResponse.status}. Possibly because Preenlistment and Registration period is over.`);
          }
        } catch (err) {
          status.textContent = 'Error contacting backend: ' + err.message;
          throw err;
        }

        // 5. Determine if HTML or text error muna yung nakuha na JSON from POST method
        const text = await linkResponse.text();
        let linkJSON;
        try {
          linkJSON = JSON.parse(text)
        } catch(e) {
          console.error('Non-JSON form!', endpointCall, text);
          throw new Error('Backend error for ' + endpointCall);
        }

        if (!linkJSON) {
          status.textContent = 'No schedules found.';
        } else {
          status.textContent = ''; // Reset the textContent
          // console.log('Ranked Sched', linkJSON.data);
          scheduleCache.set(urlKey, linkJSON.data); 

          renderTable(linkJSON.data, rawProfs, strict, forbiddenSlots);
        }
      } catch (err) {
        console.error(err);
        status.textContent = 'Error: ' + err.message;
      }
    }
  });

  function hasProf(item, profSubstr) {
    const courseKey = Object.keys(item)[0];
    const sectionObj = item[courseKey][0];
    const sectionKey = Object.keys(sectionObj)[0];
    const details = sectionObj[sectionKey][0];
    const words = details.Instructors.toLowerCase().replace(',', '').split(' ');
    return words.includes(profSubstr);
  }

  function getFilteredGroups(groups, rawProfs, strict, forbiddenSlots) {
    // Build a set of forbidden slots in this manner: Mon|5, Tue|4, ...
    const forbiddenSet = new Set(forbiddenSlots.map(({ day, slot }) => `${day}|${slot}`));

    // Optimization: We're now doing one pass of forbiddenSlots and one pass of occupiedSet first. Parsing each into {day|slot} format. Then, in the end, one pass of seeing their intersection. O(G*(S + F)).
    return groups.filter(group => { // O(S)
      const occupiedSet = new Set();

      group.forEach(item => {
        const courseKey = Object.keys(item)[0];
        const sectionArray = item[courseKey];  // [ { WFU: [...] }, … ]
        
        sectionArray.forEach(sectionObj => {
          const sectionName = Object.keys(sectionObj)[0]; 
          const schedules = sectionObj[sectionName]; // [ {...}, {...} ]

          schedules.forEach(details => {
            const days = dayMap[details.Day] || [];
            const [ startSlot, endSlot ] = timeToSlots(details.Time);
            
            days.forEach(day => {
              for (let slot = startSlot; slot <= endSlot; slot++) {
                occupiedSet.add(`${day}|${slot}`);
              }
            });
          });
        });
      });

      // By the time we're here, forbiddenSet and occupiedSet are now built.
      // We just need to find their intersection beautifully!
      for (let key of forbiddenSet) { // O(F)
        if (occupiedSet.has(key)) { // Note that .has is O(1)
          return false;
        }
      }


      // Filter 2: Fave prof
      if (rawProfs.length > 0) {
        let includeGroup = true;
        if (strict) {
          // Every prof substring must appear in at least one item
          includeGroup = rawProfs.every(rp =>
            group.some(item => hasProf(item, rp))
          );
        } else {
          // At least one match in the group
          includeGroup = group.some(item =>
            rawProfs.some(rp => hasProf(item, rp))
          );
        }

        // Check if any professor in rawProfs is in the Instructors string. If so, skip.
        if (!includeGroup) return false;  // Skip this combo
      } 

      // Passed all the filters here! Nice!
      return true; 
    });
  }

  function renderTable(groups, rawProfs, strict, forbiddenSlots) {
    const filtered = getFilteredGroups(groups, rawProfs, strict, forbiddenSlots);
    // console.log('filtered', filtered);

    if (filtered.length === 0) {
      document.getElementById('results').innerHTML = '<p>⚠️ No matching combinations found.</p>';
      return;
    }

    const results = document.getElementById('results');
    results.scrollTop = 0; // This fixes the not resetting the scroll to top bug!
    results.innerHTML = ''; // Clear everything

    const cols = ['Course','Section','Day','Time','Instructors','Probability'];
    const table = document.createElement('table');
    table.classList.add('sched-table');

    // Build a reusable header row (we’ll clone it for each group)
    // Basically this is template for the columns
    const headerTemplate = document.createElement('tr');
    cols.forEach(c => {
      const th = document.createElement('th');
      th.textContent = c;
      headerTemplate.appendChild(th);
    });


    // This part is important for dynamically loading every 20 combination of schedules.
    // This is so that we don't overload the whole thing by feeding the whole table (if there are many schedule combinations)
    // Initial Chunk
    currentStart = 0;
    results.appendChild(table); // Append table before rendering rows
    
    // Show the sentinel
    // This will be the placeholder for a chunk
    const sentinel = document.createElement('div');
    sentinel.id = 'load-sentinel';
    results.appendChild(sentinel);

    // Render the first <= 20 schedule combinations 
    renderChunk(filtered, rawProfs, strict, forbiddenSlots, cols, table, headerTemplate);


    results.removeEventListener('scroll', () => {
      // Adding a removeEventListener since by default, addEventListener persists after the first time they are called! (https://developer.chrome.com/blog/addeventlistener-once)
      // This fixes the multiple times this addEventListener is called for every scroll, instead of actually being called when it reaches threshold.
      // We also clear results.innerHTML, sure. But, addEventListener still lives there since we just knew that they persist even when clearing the contents.

      // How close to bottom before loading more?
      const threshold = 50; // 50 px from the bottom
      if (results.scrollTop + results.clientHeight >= table.offsetHeight - threshold) {
        if (currentStart < filtered.length) {
          console.log('Render more chunk!');
          renderChunk(filtered, rawProfs, strict, forbiddenSlots, cols, table, headerTemplate);
        }
      }
    });

    // Render the next <= 20 schedule combinations depending on how close to bottom the scroll is
    results.addEventListener('scroll', () => {
      // How close to bottom before loading more?
      const threshold = 50; // 50 px from the bottom
      if (results.scrollTop + results.clientHeight >= table.offsetHeight - threshold) {
        if (currentStart < filtered.length) {
          console.log('Render more chunk!');
          renderChunk(filtered, rawProfs, strict, forbiddenSlots, cols, table, headerTemplate);
        }
      }
    });

    // If there are no combinations, show this messaage
    if (!anyRendered) {
      const noCombinationMsg = document.createElement('p');
      noCombinationMsg.textContent = '⚠️ No matching combinations found.';
      results.appendChild(noCombinationMsg)
    }
  }

  function renderChunk(groups, rawProfs, strict, forbiddenSlots, cols, table, headerTemplate) {
    const end = Math.min(groups.length, currentStart + CHUNK_SIZE); // For deciding if how many to show at once initially

    for (let i = currentStart; i < end; i++) {
      const group = groups[i];

      // 1) Group header
      const groupRow = table.insertRow();
      const cell = groupRow.insertCell();
      cell.colSpan = cols.length;
      cell.textContent = `Combination ${i + 1}`; 
      cell.classList.add('group-header');
      
      // 2) Column headers
      const headerRow = headerTemplate.cloneNode(true);
      table.appendChild(headerRow);

      // Collect average probability
      let averageProbability = 0;

      // 3) For each course schedule in this group, add in a row
      group.forEach(item => {
        // Drill into your nested object exactly like before:
        const courseKey = Object.keys(item)[0];
        const sectionArray = item[courseKey];

        sectionArray.forEach(sectionObj => {
          const sectionName = Object.keys(sectionObj)[0];
          const schedules = sectionObj[sectionName];

          schedules.forEach(details => {
            const row = table.insertRow();
            row.insertCell().textContent = courseKey;
            row.insertCell().textContent = sectionName;
            row.insertCell().textContent = details.Day;
            row.insertCell().textContent = details.Time;

            // ---- Instructors Part ----
            // Replace this part with the RUPP part logic.
            // row.insertCell().textContent = details.Instructors;
            const instructorCell = row.insertCell();
            const rawName = details.Instructors.trim(); // Remove spaces na rin

            // For not to be a headache, let's normalize rawName into:
            // 'firstName lastName'
            // e.g. Coronel, Juan Felipe -> JuanFelipe Coronel (normalized)
            let normalized = rawName;
            if (rawName.includes(',')) {
              const parts = rawName.split(',');
              const last = parts[0].trim();
              const first = parts[1].trim();
              normalized = `${first} ${last}`
            }

            // Then, lowercase it so we can access keys from teacherMap
            // e.g. juanfelipe coronel
            const teacherKey = normalized.toLowerCase();
            const id = teacherMap.get(teacherKey);

            if (id) {
              instructorCell.innerHTML = 
              `
                <a href="https://rupp.onrender.com/view/${id}" 
                  target="_blank"
                  rel="noopener noreferrer"
                  data-rupp-id="${id}">
                  ${details.Instructors}
                </a>
              `;
            } else {
              instructorCell.textContent = details.Instructors;
            }
            // ---- Instructors Part ----

            
            if (details.Probability !== null) {
              row.insertCell().textContent = String(Math.floor(details.Probability * 100) / 100) + '%';
              // console.log('PROB', details.Probability);
              averageProbability += Number(details.Probability); // also add for average
            } else {
              row.insertCell().textContent = '';
            }

            anyRendered = true;
          })
        })
      });

      // 4) Insert average probability at the last col
      // Label 'Average Probability'
      const averageRow = table.insertRow();
      const averageCell = averageRow.insertCell();
      averageCell.colSpan = cols.length - 1;
      averageCell.style.textAlign = 'right';
      averageCell.textContent = 'Average Probability:';

      // Show actual average probability
      const valueCell = averageRow.insertCell();
      valueCell.textContent = (averageProbability / group.length).toFixed(2) + '%';
      valueCell.style.fontWeight = 'bold';

      // 5) Spacer
      const spacerRow = table.insertRow();
      const spacerCell = spacerRow.insertCell();
      spacerCell.colSpan = cols.length;
      spacerCell.classList.add('group-spacer');
    }

    currentStart = end;
  }
});