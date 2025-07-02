// This is for launching the popup to another tab.
// We'll set this file as background service worker in manifest.json.

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: chrome.runtime.getURL("popup.html")
  });
});