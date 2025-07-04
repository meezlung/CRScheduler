document.addEventListener('DOMContentLoaded', () => {
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


  document.getElementById('fetchBtn').addEventListener('click', async () => {
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

    try {
      status.textContent = 'Fetching priorities…';
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
        // status.textContent = `Processing ${url}…`;

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
      endpointCall = '/test-schedules';

      // 4. Call the backend endpoint call
      let linkResponse;
      try {
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

      console.log('linkJSON', linkJSON);

      if (!linkJSON) {
        status.textContent = 'No schedules found.';
      } else {
        status.textContent = '';
        console.log('Ranked Sched', linkJSON.data);
        renderTable(linkJSON.data, rawProfs, strict);
      }
    } catch (err) {
      console.error(err);
      status.textContent = 'Error: ' + err.message;
    }
  });


  function hasProf(item, profSubstr) {
    const courseKey  = Object.keys(item)[0];
    const sectionObj = item[courseKey][0];
    const sectionKey = Object.keys(sectionObj)[0];
    const details    = sectionObj[sectionKey][0];
    const words = details.Instructors
      .toLowerCase()
      .replace(',', '')
      .split(' ');
    return words.includes(profSubstr);
  }


  function renderTable(groups, rawProfs, strict) {
    let anyRendered = false;

    const results = document.getElementById('results');
    results.innerHTML = '';

    const cols = ['Course','Section','Day','Time','Instructors','Probability'];
    const table = document.createElement('table');
    table.classList.add('sched-table');

    // Build a reusable header row (we’ll clone it for each group)
    // Basically this is template for the columns.
    const headerTemplate = document.createElement('tr');
    cols.forEach(c => {
      const th = document.createElement('th');
      th.textContent = c;
      headerTemplate.appendChild(th);
    });

    groups.forEach((group, group_index) => {
      // Filter 1.1 Filter this group if meron man siyang at least 1 fave prof in it
      if (rawProfs.length > 0) {
        let includeGroup = true;
        if (rawProfs.length > 0) {
          if (strict) {
            // every prof substring must appear in at least one item
            includeGroup = rawProfs.every(rp =>
              group.some(item => hasProf(item, rp))
            );
          } else {
            // at least one match in the group
            includeGroup = group.some(item =>
              rawProfs.some(rp => hasProf(item, rp))
            );
          }
        }

        // Check if any professor in rawProfs is in the Instructors string
        if (!includeGroup) return;  // skip this combo
      } 

      // 1) Group header
      const groupRow = table.insertRow();
      const cell = groupRow.insertCell();
      cell.colSpan = cols.length;
      cell.textContent = `Combination ${group_index + 1}`; 
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
        const sectionKey = Object.keys(item[courseKey][0])[0];
        const details = item[courseKey][0][sectionKey][0];

        const row = table.insertRow();
        row.insertCell().textContent = courseKey;
        row.insertCell().textContent = sectionKey;
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

        row.insertCell().textContent = String(details.Probability) + '%';
        averageProbability += Number(details.Probability); // also add for average

        anyRendered = true;
      });

      // 4) Insert average probability at the last col
      // Label 'Average Probability'
      const averageRow = table.insertRow();
      const averageCell = averageRow.insertCell();
      averageCell.colSpan = cols.length - 1;
      averageCell.style.textAlign = 'right';
      averageCell.textContent = 'Average Probability:';

      // Show actual average probability
      const valueCell = average.insertCell();
      valueCell.textContent = (averageProbability / group.length).toFixed(2) + '%';
      valueCell.style.fontWeight = 'bold';

      // 5) Spacer
      const spacer = table.insertRow();
      const sp = spacer.insertCell();
      sp.colSpan = cols.length;
      sp.classList.add('group-spacer');
    });

    // Adding the result to id=results in HTML
    if (anyRendered) {
      results.appendChild(table);
    } else {
      const noCombinationMsg = document.createElement('p');
      noCombinationMsg.textContent = '⚠️ No matching combinations found.';
      results.appendChild(noCombinationMsg)
    }
  }
});