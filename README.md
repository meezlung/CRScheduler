# UPD CRScheduler

A Chrome extension that helps University of the Philippines Diliman students optimize their class schedules by generating and ranking all possible course combinations.

🔗 **[Download from Chrome Web Store](https://chromewebstore.google.com/detail/upd-crscheduler/jajjnacelenojpkijedehhggdceepjla)**

## Features

- ✅ **Schedule Generation**: Automatically generates all possible schedule combinations from your selected courses **with respect to the filters** (so it would prune out as many branches as possible in the backtracking algorithm)
- ✅ **Visual & Table Views**: View your schedules in both visual timetable and detailed table formats
- ✅ **Time Conflict Prevention**: Paint blocked time slots to avoid scheduling conflicts
- ✅ **Professor Integration**: Direct links to professor ratings via [RUPP (Rate UP Professors)](https://rupp.onrender.com/)
- ✅ **Probability Ranking**: Schedules are ranked by combined enrollment probability
- ✅ **Similar Shape Analysis**: Groups schedules with similar time patterns for easy comparison
- ✅ **Professor Filtering**: Filter schedules by preferred professors (strict or flexible matching)

## Demo

https://github.com/user-attachments/assets/04c5456c-dba4-4726-b43b-890e64c4c8bb

## How to Use

### 1. Installation
Install the extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/upd-crscheduler/jajjnacelenojpkijedehhggdceepjla)

### 2. Login to CRS
Make sure you're logged into the [UPD CRS system](https://crs.upd.edu.ph/)

### 3. Get Course URLs
Navigate to your desired courses in CRS and copy the URLs. The extension supports both:
- Preenlistment URLs: `https://crs.upd.edu.ph/preenlistment/...`
- Registration URLs: `https://crs.upd.edu.ph/student_registration/...` **(Still have to test this)**

### 4. Configure Your Preferences
- **Time Blocking**: Click and drag on the time grid to block unavailable time slots
- **Professor Filtering**: Enter preferred professor names (comma-separated)
- **Strict Matching**: Toggle whether ALL specified professors must be present in each schedule

### 5. Generate Schedules
Paste your course URLs and click "Fetch & Generate Schedules"

### 6. Browse Results
- Use **Table View** for detailed information
- Use **Visual View** for timetable visualization
- Click **Show Similar Shapes** to group schedules by time patterns
- Click professor names to view ratings on RUPP


## Architecture

```
Frontend (Chrome Extension)
├── Content Scripts: CRS page scraping
├── Service Worker: Background processing
├── Web Workers: Schedule generation
└── Popup Interface: User interaction
```

## Privacy & Security

- ✅ **Minimal Permissions**: Only requests necessary permissions for core functionality
- ✅ **Local Processing**: Schedule generation happens entirely in your browser (all client-sided)
- ✅ **No Data Storage**: No personal data is permanently stored


## Probability Calculation System

The extension uses the probability calculation algorithm from [UPD Course Probability Calculator](https://github.com/drew-747/UPD-Course-Probability-Calculator/blob/main/popup.js) by drew-747, which is based on available slots and total demand.

## Inspiration

All started just as a Python scraper + scheduler project ([CRScraper](https://github.com/meezlung/CRScraper/)).

## Future Roadmap

### Browser Support Expansion
- 🔄 **Firefox Extension**
- 🔄 **Safari Extension**

### Advanced Features
- 🔄 **Better Heuristics**

## Support

Found a bug or have a feature request? Please open an issue on our GitHub repository.

---

Made with ❤️ for UPD students


