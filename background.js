// This function runs when the user clicks the extension icon.
chrome.action.onClicked.addListener((tab) => {
  // Create a new tab with our report.html page
  chrome.tabs.create({
    url: chrome.runtime.getURL('report.html')
  });
});