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

function probExactlyOne(ps) {
  // Ensure all probabilities are numbers between 0 and 1
  if (!Array.isArray(ps) || ps.some(p => typeof p !== 'number' || p < 0 || p > 1)) {
    throw new Error('Input must be an array of numbers between 0 and 1');
  }
  return ps.reduce((sum, pi, i) => {
    let term = pi;
    for (let j = 0; j < ps.length; j++) {
      if (j !== i) term *= (1 - ps[j]);
    }
    return sum + term;
  }, 0);
}

function probAtLeastOne(ps) {
  // ps is an array of 0…1 probabilities
  return 1 - ps.reduce((prod, p) => prod * (1 - p), 1);
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
  // "MWF": ["Monday", "Wednesday", "Friday"],
  // "TTh": ["Tuesday", "Thursday"],
  // "WF": ["Wednesday", "Friday"],
  // "TF": ["Tuesday", "Friday"],
  // "MW": ["Monday", "Wednesday"],
  // "MTWThF": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
};

const tokenPattern = new RegExp(Object.keys(dayMap).sort((a, b) => b.length - a.length).join("|"), 'g');

function parseDays(dayCode) {
  return (dayCode.match(tokenPattern) || []).flatMap(token => dayMap[token]);
}

// For caching -> { urlKey: JSON payload }
const scheduleCache = new Map();

// For collecting similar structure of time slots
const similarShapeCombinations = new Map();

document.addEventListener('DOMContentLoaded', async () => {
  // Add loading animation here
  const loading = document.getElementById('loading-overlay');
  const loadingStatus = document.getElementById('loading-status');

  // Show loading animation
  loading.classList.remove('hidden'); 

  // This is for the visual or table view button
  let isVisual = false;
  let lastArgs = null;
  document.getElementById('toggleView').addEventListener('click', () => {
    if (!lastArgs) return; // Nothing to show yet
    isVisual = !isVisual;
    document.getElementById('toggleView').textContent = isVisual ? 'Switch to table view' : 'Switch to visual view';
    // Rerender with the same filters + data
    renderTable(...lastArgs);
  });

  // For dynamic rendering of table and infinite scrolling
  const CHUNK_SIZE = 20;
  let currentStart = 0;

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

  const switchViewBtn = document.getElementById('toggleView');
  switchViewBtn.disabled = true; // Start disabled

  const showSimilarBtn = document.getElementById('showSimilar');
  showSimilarBtn.disabled = true; // Start disabled

  // Only fetch priority once!
  const status = document.getElementById('status');
  loadingStatus.textContent = 'Fetching your registration priority...';
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

  // Fetch from latest RUPP website.
  // Since Promises resolve to Response in this case, we need to use await to avoid unresolved Promises. 
  // This fixes the 'RUPP1JSON' is not a function.
  // Since we use await, we need to use async in 'DOMContentLoaded
  const teacherMap = new Map();

  try {
    loadingStatus.textContent = 'Fetching RUPP data...'
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

  loadingStatus.textContent = '';

  // Stop loading animation here
  loading.classList.add('hidden'); 

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
        // Get HTML pages for each course URL and scrape each table by calling the backend
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

        // Ensure all URLs are of the same type
        if (preenlistmentCount === urls.length) {
          endpointCall = '/scrape-links-preenlistment';
        } else if (registrationCount === urls.length) {
          endpointCall = '/scrape-links-registration';
        } else {
          throw new Error('All URLs must be either preenlistment or registration links.');
        }

        // Temporarily
        endpointCall = '/test-schedules2';

        // Call the backend endpoint call
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

        // Determine if HTML or text error muna yung nakuha na JSON from POST method
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
          // console.log(linkJSON.data);
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
    let filtered = groups.reduce((acc, group) => { // O(S)
      let combinedProbability = 1;

      // Filter 1: Forbidden time slots
      const occupiedSet = new Set();
      group.forEach(item => {
        const courseKey = Object.keys(item)[0];
        const sectionArray = item[courseKey];  // [ { WFU: [...] }, … ]
        
        sectionArray.forEach(sectionObj => {
          const sectionName = Object.keys(sectionObj)[0]; 
          const schedules = sectionObj[sectionName]; // [ {...}, {...} ]

          schedules.forEach(details => {
            const days = parseDays(details.Day);
            const [ startSlot, endSlot ] = timeToSlots(details.Time);
            if (details.Probability !== null) {
              const prob = Math.max(0, details.Probability); // Make sure probabilities are nonnegative!
              combinedProbability *= (Number(prob) / 100);
            }
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
          return acc;
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
        if (!includeGroup) return acc;  // Skip this combo
      } 

      // Passed all the filters here! Nice!
      // We can insert the similar shape algorithm here by appending into a dictionary called similarShapeCombinations, with sorted concatenated time slots as keys, and courses as values.
            
      // Sorting the occupiedSet will be useful for distinguishing actually unique keys
      // We'll use this for making key of similarShapeCombinations Map
      const sortedOccupied = Array.from(occupiedSet).sort();

      // Append the current group (course details) to the similarShapeCombinations map
      let timeSlotKey = sortedOccupied.join(',');
      if (!similarShapeCombinations.has(timeSlotKey)) { // If first time palang nakikita
        similarShapeCombinations.set(timeSlotKey, []);
      }
      similarShapeCombinations.get(timeSlotKey).push(group);

      combinedProbability *= 100;

      acc.push({ group, combinedProbability });
      return acc;
    }, []);

    // This is actually a good way of having descending order in an Array
    // .sort here needs a comparison function 
    // If positive, b comes first, then a goes second
    // If negative, a comes first, then b goes second
    // If 0, retain order
    filtered.sort((a, b) => b.combinedProbability - a.combinedProbability);
    return filtered.map(x => x.group);
  }

  function renderTable(groups, rawProfs, strict, forbiddenSlots) {
    lastArgs = [groups, rawProfs, strict, forbiddenSlots];

    // For the toggle button 'Switch to visual or table view'
    const renderChunkFunction = isVisual ? renderVisualChunk : renderTableChunk;

    const filtered = getFilteredGroups(groups, rawProfs, strict, forbiddenSlots);
    
    if (filtered.length === 0 || similarShapeCombinations.size === 0) {
      results.innerHTML = '<p>⚠️ No matching combinations found.</p>';
      return;
    }

    results.scrollTop = 0; // This fixes the not resetting the scroll to top bug!
    results.innerHTML = ''; // Clear everything

    // Add a new button here that listens to activate renderSimilarShapeCombination
    const similarShapeBtn = document.getElementById('showSimilar');

    similarShapeBtn.addEventListener('click', () => {
      currentStart = 0;
      results.scrollTop = 0;
      results.innerHTML = '';
      
      // Show the sentinel once, at the very bottom of the content
      sentinel = document.createElement('div');
      sentinel.id = 'load-sentinel';
      results.appendChild(sentinel);

      // Set up the IntersectionObserver
      const options = {
        root: results, // Watch within scrollable `#results`
        rootMargin: '0px',
        threshold: 1 // Sentinel must be fully in view
      };
      observer = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) { // This acts like a callback
          renderSimilarShapeCombination(); 
        }
      }, options);

      renderSimilarShapeCombination();
       
      // Observe the sentinel for when it's in view
      observer.observe(sentinel);
    });

    // Append the table first
    currentStart = 0;

    // Show the sentinel once, at the very bottom of the content
    sentinel = document.createElement('div');
    sentinel.id = 'load-sentinel';
    results.appendChild(sentinel);

    // Set up the IntersectionObserver
    const options = {
      root: results, // Watch within scrollable `#results`
      rootMargin: '0px',
      threshold: 1 // Sentinel must be fully in view
    };
    observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { // This acts like a callback
        renderChunkFunction(filtered);
      }
    }, options);

    // Render the first <= 20 schedule combinations
    renderChunkFunction(filtered);

    // Observe the sentinel for when it's in view
    observer.observe(sentinel);

    status.textContent = `Generated ${filtered.length} combinations.`; // Show a status of how many schedule combination was generated and filtered

    switchViewBtn.disabled = false;
    showSimilarBtn.disabled = false;
  }

  function renderTableChunk(groups) {
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

    // Table on top!
    results.appendChild(table);

    const end = Math.min(groups.length, currentStart + CHUNK_SIZE); // For deciding if how many to show at once initially

    for (let i = currentStart; i < end; i++) {
      const group = groups[i];

      const groupRow = table.insertRow();
      const cell = groupRow.insertCell();
      cell.colSpan = cols.length;
      cell.textContent = `Combination ${i + 1}`; 
      cell.classList.add('group-header');
      
      const headerRow = headerTemplate.cloneNode(true);
      table.appendChild(headerRow);

      // Collect combined probability
      let combinedProbability = 1;

      // For each course schedule in this group, add in a row
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

            // Set a RUPP link
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
              const prob = Math.max(0, details.Probability);
              combinedProbability *= (Number(prob) / 100);
            } else {
              row.insertCell().textContent = '';
            }
          })
        })
      });

      // Insert probability at the last col
      const combinedProbabilityRow = table.insertRow();
      const combinedProbabilityCell = combinedProbabilityRow.insertCell();
      combinedProbabilityCell.colSpan = cols.length - 1; // Last col
      combinedProbabilityCell.style.textAlign = 'right';
      combinedProbabilityCell.textContent = 'Combined Probability:';

      // Show actual combined probability by inserting another cell in the same row as its label
      const valueCell = combinedProbabilityRow.insertCell();
      valueCell.textContent = (combinedProbability * 100).toFixed(2) + '%';
      valueCell.style.fontWeight = 'bold';

      // Spacer
      const spacerRow = table.insertRow();
      const spacerCell = spacerRow.insertCell();
      spacerCell.colSpan = cols.length;
      spacerCell.classList.add('group-spacer');
    }

    // Start from here again
    currentStart = end;

    // IMPORTANT! Append the sentinel at the bottom after each chunk is rendered to trigger infinite scrolling everytime
    // We don't need the observer and sentinel when all schedule combination has been rendered
    if (currentStart < groups.length) {
      results.appendChild(sentinel);
    }

    if (currentStart >= groups.length) {
      observer.disconnect();
      sentinel.remove();
    }
  }

  function renderVisualChunk(groups) {
    const end = Math.min(groups.length, currentStart + CHUNK_SIZE); // For deciding how many to show at once initially

    // TODO: find more dynamic way of doing this? Hardcoded it because absolute position is a pain in the butt...
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

      let combinedProbability = 1;

      const combinedProbabilityHeader = document.createElement('div');
      combinedProbabilityHeader.classList.add('combo-probability');

      const timetableCombo = document.createElement('div');
      timetableCombo.classList.add('timetable-combo');

      // Day headers (row 1, cols 2–7)
      ['Mon','Tue','Wed','Thu','Fri','Sat'].forEach((day, idx) => {
        const dayHeader = document.createElement('div');
        dayHeader.classList.add('day-header');
        dayHeader.style.gridColumn = (idx + 2).toString(); // cols 2-7
        dayHeader.textContent = day;
        timetableCombo.appendChild(dayHeader);
      });

      // Time labels (col 1, rows 2–26)
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

      // Each meeting -> one block
      group.forEach(item => {
        const course = Object.keys(item)[0];
        item[course].forEach(sectionObj => {
          const section = Object.keys(sectionObj)[0];
          sectionObj[section].forEach(details => {
            const days = parseDays(details.Day);
            const [s, e] = timeToSlots(details.Time);
            const probText = (details.Probability != null) ? `${Math.round(details.Probability * 100) / 100}%` : '';
            
            if (details.Probability !== null) {
              const prob = Math.max(0, details.Probability); // Make probabilities nonnegative!
              combinedProbability *= (Number(prob) / 100);
            }

            days.forEach(fullDay => {
              const dayIdx = ['Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(fullDay.slice(0, 3));
              if (dayIdx < 0) return;
              const block = document.createElement('div');
              block.classList.add('block');

              // Position horizontally by day index
              block.style.left = `${((dayIdx + 1) * dayWidth) - 67}px`;
              block.style.width = `${dayWidth - 2}px`; // account for border

              // Position vertically by start slot * slotHeight
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

      // Append combined probability to combinationHeader
      combinedProbabilityHeader.textContent = 'Combined Probability: ' + (combinedProbability * 100).toFixed(2) + '%';
      combinationHeader.appendChild(combinedProbabilityHeader);
      comboWrapper.appendChild(combinationHeader);

      // Append the combo at the bottom of the container
      comboWrapper.appendChild(timetableCombo);
      results.appendChild(comboWrapper);
    }

    // Start from here again
    currentStart = end;

    // IMPORTANT! Append the sentinel at the bottom after each chunk is rendered to trigger infinite scrolling everytime
    // We don't need the observer and sentinel when all schedule combination has been rendered
    if (currentStart < groups.length) {
      results.appendChild(sentinel);
    }

    if (currentStart >= groups.length) {
      observer.disconnect();
      sentinel.remove();
    }
  }

  function renderSimilarShapeCombination() {
    let shapeSummaries = Array.from(similarShapeCombinations.entries()).map(
      ([shapeKey, groupsForShape]) => {
        const slots = shapeKey.split(',').map(pair => {
          const [day, slot] = pair.split('|');
          return { day: day, slot: parseFloat(slot) };
        });

        return { slots, groupsForShape }
      }
    );

    // Sort first before rendering
    shapeSummaries = shapeSummaries.map(({ slots, groupsForShape }) => {
      // Collect per‐course section‑probabilities
      const courseMap = new Map();
      groupsForShape.forEach(group => {
        group.forEach(item => {
          const course = Object.keys(item)[0];
          item[course].forEach(sectionObj => {
            const section = Object.keys(sectionObj)[0];
            sectionObj[section].forEach(details => {
              if (details.Probability != null) {
                const p = Math.max(0, Number(details.Probability)) / 100;
                if (!courseMap.has(course)) courseMap.set(course, []);
                courseMap.get(course).push(p);
              }
            });
          });
        });
      });

      // Multiply each “at‑least‑one‑section” probability together
      let shapeProbability = 1;
      for (let sectionPs of courseMap.values()) {
        shapeProbability *= probAtLeastOne(sectionPs);
      }

      return { slots, groupsForShape, combinedProbability: shapeProbability };
    });
    shapeSummaries.sort((a, b) => b.combinedProbability - a.combinedProbability); // Again one liner descending sort

    status.textContent = `Generated ${shapeSummaries.length} similar shape combinations.`

    // This is for having infinite scrolling
    const frag = document.createDocumentFragment();

    // TODO: Refactor this as it has almost the same functionality as renderVisualChunk (tbh I just copy pasted from renderVisualChunk)
    const end = Math.min(shapeSummaries.length, currentStart + CHUNK_SIZE); // For deciding how many to show at once initially

    const slotHeight = 15;
    const dayWidth = 124.19;

   for (let i = currentStart; i < end; i++) {
      const { groupsForShape } = shapeSummaries[i]; 
      const comboWrapper = document.createElement('div');
      comboWrapper.classList.add('combo-wrapper');

      const combinationHeader = document.createElement('div');
      combinationHeader.classList.add('combo-header');

      const combinationNumber = document.createElement('div');
      combinationNumber.classList.add('combo-number');      
      combinationNumber.textContent = `Same Shape ${i + 1}`; // Shows Combination #1, #2, etc.
      combinationHeader.appendChild(combinationNumber)

      let combinedProbability = 1;

      const combinedProbabilityHeader = document.createElement('div');
      combinedProbabilityHeader.classList.add('combo-probability');

      const timetableCombo = document.createElement('div');
      timetableCombo.classList.add('timetable-combo');

      // Day headers (row 1, cols 2–7)
      ['Mon','Tue','Wed','Thu','Fri','Sat'].forEach((day, idx) => {
        const dayHeader = document.createElement('div');
        dayHeader.classList.add('day-header');
        dayHeader.style.gridColumn = (idx + 2).toString(); // cols 2-7
        dayHeader.textContent = day;
        timetableCombo.appendChild(dayHeader);
      });

      // Time labels (col 1, rows 2–26)
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

      // Collect all sessions in this shape
      const sessions = [];
      groupsForShape.forEach(group => {
        group.forEach(item => {
          const courseKey = Object.keys(item)[0]; // e.g. Math 23
          item[courseKey].forEach(sectionObj => {
            const sectionKey = Object.keys(sectionObj)[0]; // e.g. HV-1
            sectionObj[sectionKey].forEach(details => {
              const days = parseDays(details.Day);
              const [s,e] = timeToSlots(details.Time);
              const prob = details.Probability;
              days.forEach(fullDay => {
                const dayIdx = ['Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(fullDay.slice(0,3));
                if (dayIdx >= 0) {
                  sessions.push({
                    dayIdx, s, e,
                    course: courseKey,
                    section: sectionKey,
                    label: `${courseKey} ${sectionKey}`,
                    probability: prob
                  });
                }
              });
            });
          });
        });
      });

      // Cluster identical (dayIdx, s, e)
      const shapeMap = new Map();
      sessions.forEach(sess => {
        const key = `${sess.dayIdx}|${sess.s}|${sess.e}`;
        if (!shapeMap.has(key)) {
          shapeMap.set(key, []);
        }
        // Only push if this label is not already present in the array for this key
        if (!shapeMap.get(key).some(existing => existing.label === sess.label)) {
          shapeMap.get(key).push(sess);
        }
      });

      const courseMap = new Map();
      // Draw one <div class="block"> per cluster
      for (let [key, arr] of shapeMap.entries()) {
        // Just for detecting the absolute positioning of each blocks
        const { dayIdx, s, e, course, section, label, probability } = arr[0];
        const block = document.createElement('div');
        block.classList.add('block');
        block.style.left = `${(dayIdx+1)*dayWidth - 67}px`;
        block.style.width = `${dayWidth-2}px`;
        block.style.top = `${s*slotHeight - 10}px`;
        block.style.height = `${(e-s)*slotHeight}px`;

        const sessionLabels = arr.map(x => x.label).join("\n");
        block.setAttribute('data-sessions', sessionLabels);

        // Build courseMap
        for (const sess of arr) {
          if (sess.probability === null) {
            continue;
          }

          const rawProb = Number(sess.probability);
          const courseProb = (rawProb >= 0) ? rawProb / 100 : 0;
          const courseKey = sess.course;
          const sectionKey = sess.section;

          if (!courseMap.has(courseKey)) {
            courseMap.set(courseKey, new Set());
          }
          
          courseMap.get(courseKey).add(sectionKey + '|' + courseProb);
        }

        // Show all course inside the block
        // Don't worry! In CSS, it is designed to have a scrollbar!
        block.innerHTML = arr.map(x => `<strong>${x.label}</strong>`).join('<br>');
        timetableCombo.appendChild(block);
      };

      // Based from the courseMap, in which it has the structure below, we get probExactlyOne of each CourseName
      // {
      //   CourseNameA: Set('SectionA|SectionProbA', 'SectionB|SectionProbB', ...),
      //   CourseNameB: ...
      // }
      for (const [courseName, sectionSet] of courseMap.entries()) {
        // Extract probabilities from 'Section|SectionProb' strings
        const probs = Array.from(sectionSet).map(str => {
          const [section, prob] = str.split('|');
          return Number(prob);
        });
        // Calculate probability that at least one section is chosen for this course
        const courseProb = probAtLeastOne(probs);
        combinedProbability *= courseProb;
      }

      // Append combined probability to combinationHeader
      combinedProbabilityHeader.textContent = 'Combined Probability: ' + (combinedProbability * 100).toFixed(2) + '%';
      combinationHeader.appendChild(combinedProbabilityHeader);
      comboWrapper.appendChild(combinationHeader);

      // Append the combo at the bottom of the container
      comboWrapper.appendChild(timetableCombo);
      frag.appendChild(comboWrapper);
    };

    // For infinite scrolling bug
    results.append(frag);

    // Start from here again
    currentStart = end;

    // IMPORTANT! Append the sentinel at the bottom after each chunk is rendered to trigger infinite scrolling everytime
    // We don't need the observer and sentinel when all schedule combination has been rendered
    if (currentStart < shapeSummaries.length) {
      results.appendChild(sentinel);
    }

    if (currentStart >= shapeSummaries.length) {
      observer.disconnect();
      sentinel.remove();
    }
  }
});