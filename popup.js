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
  const toSlot = ({h, mm}) => ((h * 60 + mm) - (7 * 60)) / 30; // Don't floor this to output floating points. This is so that we account for 11:45, 12:45...

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

// For collecting similar structure of time slots
const similarShapeCombinations = new Map();

document.addEventListener('DOMContentLoaded', async () => {
  // This is for the visual or table view button
  let isVisual = false;
  let lastArgs = null;
  document.getElementById('toggleView').addEventListener('click', () => {
    if (!lastArgs) return; // nothing to show yet
    isVisual = !isVisual;
    document.getElementById('toggleView').textContent = isVisual ? 'Switch to table' : 'Switch to visual';
    // Rerender with the same filters + data
    renderTable(...lastArgs);
  });


  // For dynamic rendering of table and infinite scrolling
  const CHUNK_SIZE = 20;
  let currentStart = 0;

  // For detecting whether there are or no matches found when generating schedule combinations
  let anyRendered = false;


  // Format the table at the sidebar by generating time slots with for loop, hard coding div's is tiring
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


  // This part is for awaiting the Promise for both fetching priority and RUPP data
  // While fetching student priority and RUPP data, buttons should be disabled 
  const fetchBtn = document.getElementById('fetchBtn');
  fetchBtn.disabled = true;  // Start disabled

  const clearBtn = document.getElementById('clearPaint');
  clearBtn.disabled = true; // Start disabled

  // Only fetch priority once!
  const status = document.getElementById('status');
  status.textContent = 'Fetching priorities...';
  // Get classmessages and scrape priorities HTML page
  const classMsgResp = await fetch('https://crs.upd.edu.ph/user/view/classmessages', {
    credentials: 'include'
  });
  const classMsgHtml = await classMsgResp.text();

  // Feed the classmessages HTML page to /scrape-priority endpoint
  // TOOD: Good optimization is to scrape in client side!
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

  // Fetch from latest RUPP website. NakaIIFE (Immediately Invoked Function Expression) para magexecute na agad. Don't have to reference it. 
  // Since Promises resolve to Response in this case, we need to use await to avoid unresolved Promises. This fixes the 'RUPP1JSON' is not a function.
  // Since we use await, we need to use async.
  const teacherMap = new Map();

  try {
    status.textContent = 'Fetching RUPP data...'
    const RUPP1Data = await fetch(`${BACKEND}/fetch-rupp1`);
    const RUPP1JSON = await RUPP1Data.json();
    RUPP1JSON.teachers.teachers.forEach(t => {
      const key = `${t.firstName} ${t.lastName}`.toLowerCase();
      teacherMap.set(key, t.id);
    });
  } catch (e) {
    console.error("Could not load RUPP teacher map", e);
  } finally {
    fetchBtn.disabled = false; // Now safe to click
    clearBtn.disabled = false;  
  }

  status.textContent = '';

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
              },
              preenlistment_priority: preenlistment_priority,
              registration_priority: registration_priority
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
          console.log(linkJSON.data);
          // console.log('Ranked Sched', linkJSON.data);
          scheduleCache.set(urlKey, linkJSON.data); 

          currentStart = 0;

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
    // Make sure to clear this every render of a new table
    similarShapeCombinations.clear();

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
      // We can insert the similar shape algorithm here by appending into a dictionary called similarShapeCombinations, with sorted concatenated time slots as keys, and courses as values.
            
      console.log('Filtered occupiedSet', occupiedSet);

      // Sort the occupiedSet for consistent ordering (optional, for debugging or grouping)
      const sortedOccupied = Array.from(occupiedSet).sort();
      // You can use sortedOccupied instead of occupiedSet if you want a sorted array
      // console.log('Sorted occupiedSet', sortedOccupied);

      let timeSlotKey = sortedOccupied.join(',');

      console.log('timeSlotKey', timeSlotKey);

      // Append the current group (course details) to the similarShapeCombinations map
      if (!similarShapeCombinations.has(timeSlotKey)) { // If first time palang nakikita
        similarShapeCombinations.set(timeSlotKey, []);
      }
      similarShapeCombinations.get(timeSlotKey).push(group);

      return true; 
    });
  }

  function renderTable(groups, rawProfs, strict, forbiddenSlots) {
    lastArgs = [groups, rawProfs, strict, forbiddenSlots];
    const renderChunkFunction = isVisual ? renderVisualChunk : renderTableChunk;

    const filtered = getFilteredGroups(groups, rawProfs, strict, forbiddenSlots);
    // console.log('filtered', filtered);
    console.log('similarShapeCombinations', similarShapeCombinations);

    status.textContent = `Generated ${filtered.length} combinations.`; // Show a status of how many schedule combination was generated and filtered
    
    if (filtered.length === 0) {
      results.innerHTML = '<p>⚠️ No matching combinations found.</p>';
      return;
    }

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

    if (similarShapeCombinations.size === 0) {
      results.innerHTML = '<p>⚠️ No matching combinations found.</p>';
      return;
    }

    // Add a new button here that listens to activate renderSimilarShapeCombination
    const similarShapeBtn = document.createElement('button');
    similarShapeBtn.id = 'showSimilarShape';
    similarShapeBtn.textContent = 'Show Similar Shape Combinations';
    results.appendChild(similarShapeBtn);

    similarShapeBtn.addEventListener('click', () => {
      results.innerHTML = '';
      renderSimilarShapeCombination(filtered, rawProfs, strict, forbiddenSlots, cols, table, headerTemplate); 
    });    

    // Append the table first
    currentStart = 0;
    results.appendChild(table);

    // Show the sentinel once, at the very bottom of the content
    sentinel = document.createElement('div');
    sentinel.id = 'load-sentinel';
    results.appendChild(sentinel);

    // Set up the IntersectionObserver
    const options = {
      root: results, // Watch within scrollable `#results`
      rootMargin: '0px',
      threshold: 1 // sentinel must be fully in view
    };
    observer = new IntersectionObserver(entries => {
      console.log("isIntersecting", entries[0].isIntersecting);
      if (entries[0].isIntersecting) { // This acts like a callback
        console.log("Intersection Current Start", currentStart);
        renderChunkFunction(filtered, rawProfs, strict, forbiddenSlots, cols, table, headerTemplate);
      }
    }, options);

    // Render the first <= 20 schedule combinations
    renderChunkFunction(filtered, rawProfs, strict, forbiddenSlots, cols, table, headerTemplate, observer, sentinel);

    // Observe the sentinel for when it's in view
    observer.observe(sentinel);

    // If there are no combinations, show this message
    if (!anyRendered) {
      const noCombinationMsg = document.createElement('p');
      noCombinationMsg.textContent = '⚠️ No matching combinations found.';
      results.appendChild(noCombinationMsg)
    }
  }

  function renderTableChunk(groups, rawProfs, strict, forbiddenSlots, cols, table, headerTemplate) {
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

    if (currentStart >= groups.length) {
      observer.disconnect();
      sentinel.remove();
    }
  }

  function renderVisualChunk(groups, rawProfs, strict, forbiddenSlots, cols, table, headerTemplate) {
    const end = Math.min(groups.length, currentStart + CHUNK_SIZE); // For deciding how many to show at once initially

    const slotHeight = 15;
    const dayWidth = 124.19;

    for (let i = currentStart; i < end; i++) {
      const group = groups[i];

      const comboWrapper = document.createElement('div');
      comboWrapper.classList.add('combo-wrapper');

      const combinationHeader = document.createElement('div');
      combinationHeader.classList.add('combo-header');

      const combinationNumber = document.createElement('div');
      combinationNumber.classList.add('combo-number');      
      combinationNumber.textContent = `Combination ${i + 1}`; // Shows Combination #1, #2, etc.
      combinationHeader.appendChild(combinationNumber)

      let averageProbability = 0;

      const averageProbabilityHeader = document.createElement('div');
      averageProbabilityHeader.classList.add('combo-probability');

      const timetableCombo = document.createElement('div');
      timetableCombo.classList.add('timetable-combo');

      // 1) Day headers (row 1, cols 2–7)
      ['Mon','Tue','Wed','Thu','Fri','Sat'].forEach((day, idx) => {
        const dayHeader = document.createElement('div');
        dayHeader.classList.add('day-header');
        dayHeader.style.gridColumn = (idx + 2).toString(); // cols 2-7
        dayHeader.textContent = day;
        timetableCombo.appendChild(dayHeader);
      });

      // 2) Time labels (col 1, rows 2–26)
      for (let slot = 0; slot < 25; slot++) {
        const hour = 7 + Math.floor(slot / 2)
        const min = slot % 2 ? '30' : '00'
        const ampm = hour < 12 ? 'AM' : 'PM'
        const h12 = ((hour + 11) % 12) + 1;
        const label = document.createElement('div');
        label.classList.add('time-label');
        label.style.gridRow = (slot + 2).toString();
        label.textContent = `${h12}:${min} ${ampm}`;
        timetableCombo.appendChild(label);
      }

      // 3) Each meeting -> one block
      group.forEach(item => {
        const course = Object.keys(item)[0];
        item[course].forEach(sectionObj => {
          const section = Object.keys(sectionObj)[0];
          sectionObj[section].forEach(details => {
            const days = dayMap[details.Day] || [];
            const [s, e] = timeToSlots(details.Time);
            // console.log('time', details.Time, 'startTimeSlot', s, 'endTimeSlot', e);
            const probText = (details.Probability != null) ? `${Math.round(details.Probability * 100) / 100}%` : '';
            
            if (details.Probability !== null) {
              averageProbability += Number(details.Probability); // also add for average
            }

            days.forEach(fullDay => {
              const dayIdx = ['Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(fullDay.slice(0, 3));
              if (dayIdx < 0) return;
              const block = document.createElement('div');
              block.classList.add('block');

              // block.style.gridColumn = (dayIdx + 2).toString();
              // block.style.gridRow = `${s + 2} / span ${e - s}`;

              // position horizontally by day index
              block.style.left = `${((dayIdx + 1) * dayWidth) - 67}px`;
              block.style.width = `${dayWidth - 2}px`; // account for border

              // position vertically by start slot * slotHeight
              block.style.top = `${(s * slotHeight) - 10}px`;
              block.style.height = `${(e - s) * slotHeight}px`; // this account for how much the sched lasts
              
              block.innerHTML = `
                <strong>${course} ${section}</strong><br>
                <em>${details.Instructors}</em><br>
                <small>${probText}</small>
              `;
              timetableCombo.appendChild(block);
            });
          });
        });
      });

      // Append average probability to combinationHeader
      averageProbabilityHeader.textContent = 'Average Probability: ' + (averageProbability / group.length).toFixed(2) + '%';
      // averageProbabilityHeader.style.fontWeight = 'bold';
      combinationHeader.appendChild(averageProbabilityHeader);
      comboWrapper.appendChild(combinationHeader);


      // Append the combo at the bottom of the container
      anyRendered = true;
      comboWrapper.appendChild(timetableCombo);
      results.appendChild(comboWrapper);
    }

    currentStart = end;

    // console.log('sentinel', sentinel);

    // Append the sentinel at the bottom after each chunk is rendered
    if (currentStart < groups.length) {
      results.appendChild(sentinel);
    }

    if (currentStart >= groups.length) {
      observer.disconnect();
      sentinel.remove();
    }
  }

  function renderSimilarShapeCombination(groups, rawProfs, strict, forbiddenSlots, cols, table, headerTemplate) {
    const shapeSummaries = Array.from(similarShapeCombinations.entries()).map(
      ([shapeKey, groupsForShape]) => {
        const slots = shapeKey.split(',').map(pair => {
          const [day, slot] = pair.split('|');
          return { day: day, slot: parseFloat(slot) };
        });

        return { slots, groupsForShape }
      }
    );
    console.log('shapeSummaries', shapeSummaries);   

    // TODO: render here visually
    const end = Math.min(shapeSummaries.length, currentStart + CHUNK_SIZE); // For deciding how many to show at once initially

    const slotHeight = 15;
    const dayWidth = 124.19;

    shapeSummaries.forEach(({ slots, groupsForShape }, shapeIndex) => {
      // wrapper + header
      const comboWrapper = document.createElement('div');
      comboWrapper.classList.add('combo-wrapper');

      const hdr = document.createElement('div');
      hdr.classList.add('combo-header');
      hdr.innerHTML = `<div class="combo-number">Shape ${shapeIndex + 1}</div>`;
      comboWrapper.appendChild(hdr);

      // grid container
      const timetableCombo = document.createElement('div');
      timetableCombo.classList.add('timetable-combo');

      // column headers
      ['Mon','Tue','Wed','Thu','Fri','Sat'].forEach((d,i) => {
        const dh = document.createElement('div');
        dh.classList.add('day-header');
        dh.style.gridColumn = (i+2).toString();
        dh.textContent = d;
        timetableCombo.appendChild(dh);
      });

      // row labels
      for (let slot=0; slot<25; slot++){
        const hour = 7+Math.floor(slot/2),
              min  = slot%2?'30':'00',
              ampm = hour<12?'AM':'PM',
              h12  = ((hour+11)%12)+1;
        const lbl = document.createElement('div');
        lbl.classList.add('time-label');
        lbl.style.gridRow = (slot+2).toString();
        lbl.textContent = `${h12}:${min} ${ampm}`;
        timetableCombo.appendChild(lbl);
      }

      // 3) Collect _all_ sessions in this shape
      const sessions = [];
      groupsForShape.forEach(group => {
        group.forEach(item => {
          const course = Object.keys(item)[0];
          item[course].forEach(sectionObj => {
            const section = Object.keys(sectionObj)[0];
            sectionObj[section].forEach(detail => {
              const days = dayMap[detail.Day] || [];
              const [s,e] = timeToSlots(detail.Time);
              days.forEach(fullDay => {
                const dayIdx = ['Mon','Tue','Wed','Thu','Fri','Sat']
                                .indexOf(fullDay.slice(0,3));
                if (dayIdx >= 0) {
                  sessions.push({
                    dayIdx, s, e,
                    label: `${course} ${section}`
                  });
                }
              });
            });
          });
        });
      });

      // 4) Cluster identical (dayIdx, s, e)
      const shapeMap = new Map();
      sessions.forEach(sess => {
        const key = `${sess.dayIdx}|${sess.s}|${sess.e}`;
        if (!shapeMap.has(key)) shapeMap.set(key, []);
        shapeMap.get(key).push(sess);
      });

      // 5) Draw one <div class="block"> per cluster
      shapeMap.forEach(arr => {
        const { dayIdx, s, e } = arr[0];
        const block = document.createElement('div');
        block.classList.add('block');
        block.style.left   = `${(dayIdx+1)*dayWidth - 67}px`;
        block.style.width  = `${dayWidth-2}px`;
        block.style.top    = `${s*slotHeight - 10}px`;
        block.style.height = `${(e-s)*slotHeight}px`;

        // tooltip list of all labels in this block
        block.title = arr.map(x => x.label).join('\n');
        const sessionLabels = arr.map(x => x.label).join("\n");
        block.setAttribute('data-sessions', sessionLabels);

        // show the first course inside
        block.innerHTML = `<strong>${arr[0].label}</strong>`;
        timetableCombo.appendChild(block);
      });


      anyRendered = true;
      comboWrapper.appendChild(timetableCombo);
      results.appendChild(comboWrapper);
    });

    currentStart = end;

    // console.log('sentinel', sentinel);

    // Append the sentinel at the bottom after each chunk is rendered
    if (currentStart < shapeSummaries.length) {
      results.appendChild(sentinel);
    }

    if (currentStart >= shapeSummaries.length) {
      observer.disconnect();
      sentinel.remove();
    }

  }

  function renderSimilarShapeCombination(groups, rawProfs, strict, forbiddenSlots, cols, table, headerTemplate) {
    const shapeSummaries = Array.from(similarShapeCombinations.entries()).map(
      ([shapeKey, groupsForShape]) => {
        const slots = shapeKey.split(',').map(pair => {
          const [day, slot] = pair.split('|');
          return { day: day, slot: parseFloat(slot) };
        });

        return { slots, groupsForShape }
      }
    );
    console.log('shapeSummaries', shapeSummaries);   

    // TODO: render here visually
    const end = Math.min(shapeSummaries.length, currentStart + CHUNK_SIZE); // For deciding how many to show at once initially

    const slotHeight = 15;
    const dayWidth = 124.19;

    shapeSummaries.forEach(({ slots, groupsForShape }, shapeIndex) => {
      // wrapper + header
      const comboWrapper = document.createElement('div');
      comboWrapper.classList.add('combo-wrapper');

      const hdr = document.createElement('div');
      hdr.classList.add('combo-header');
      hdr.innerHTML = `<div class="combo-number">Shape ${shapeIndex + 1}</div>`;
      comboWrapper.appendChild(hdr);

      // grid container
      const timetableCombo = document.createElement('div');
      timetableCombo.classList.add('timetable-combo');

      // column headers
      ['Mon','Tue','Wed','Thu','Fri','Sat'].forEach((d,i) => {
        const dh = document.createElement('div');
        dh.classList.add('day-header');
        dh.style.gridColumn = (i+2).toString();
        dh.textContent = d;
        timetableCombo.appendChild(dh);
      });

      // row labels
      for (let slot=0; slot<25; slot++){
        const hour = 7+Math.floor(slot/2),
              min  = slot%2?'30':'00',
              ampm = hour<12?'AM':'PM',
              h12  = ((hour+11)%12)+1;
        const lbl = document.createElement('div');
        lbl.classList.add('time-label');
        lbl.style.gridRow = (slot+2).toString();
        lbl.textContent = `${h12}:${min} ${ampm}`;
        timetableCombo.appendChild(lbl);
      }

      // 3) Collect _all_ sessions in this shape
      const sessions = [];
      groupsForShape.forEach(group => {
        group.forEach(item => {
          const course = Object.keys(item)[0];
          item[course].forEach(sectionObj => {
            const section = Object.keys(sectionObj)[0];
            sectionObj[section].forEach(detail => {
              const days = dayMap[detail.Day] || [];
              const [s,e] = timeToSlots(detail.Time);
              days.forEach(fullDay => {
                const dayIdx = ['Mon','Tue','Wed','Thu','Fri','Sat']
                                .indexOf(fullDay.slice(0,3));
                if (dayIdx >= 0) {
                  sessions.push({
                    dayIdx, s, e,
                    label: `${course} ${section}`
                  });
                }
              });
            });
          });
        });
      });

      // 4) Cluster identical (dayIdx, s, e)
      const shapeMap = new Map();
      sessions.forEach(sess => {
        const key = `${sess.dayIdx}|${sess.s}|${sess.e}`;
        if (!shapeMap.has(key)) shapeMap.set(key, []);
        shapeMap.get(key).push(sess);
      });

      // 5) Draw one <div class="block"> per cluster
      shapeMap.forEach(arr => {
        const { dayIdx, s, e } = arr[0];
        const block = document.createElement('div');
        block.classList.add('block');
        block.style.left   = `${(dayIdx+1)*dayWidth - 67}px`;
        block.style.width  = `${dayWidth-2}px`;
        block.style.top    = `${s*slotHeight - 10}px`;
        block.style.height = `${(e-s)*slotHeight}px`;

        // tooltip list of all labels in this block
        block.title = arr.map(x => x.label).join('\n');
        const sessionLabels = arr.map(x => x.label).join("\n");
        block.setAttribute('data-sessions', sessionLabels);

        // show the first course inside
        block.innerHTML = `<strong>${arr[0].label}</strong>`;
        timetableCombo.appendChild(block);
      });


      anyRendered = true;
      comboWrapper.appendChild(timetableCombo);
      results.appendChild(comboWrapper);
    });

    currentStart = end;

    // console.log('sentinel', sentinel);

    // Append the sentinel at the bottom after each chunk is rendered
    if (currentStart < shapeSummaries.length) {
      results.appendChild(sentinel);
    }

    if (currentStart >= shapeSummaries.length) {
      observer.disconnect();
      sentinel.remove();
    }

  }
});