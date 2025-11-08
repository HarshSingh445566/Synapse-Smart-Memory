chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveToSynapse",
    title: "Save to Synapse",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "saveToSynapse" && info.selectionText) {
    fetch("http://localhost:5000/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: info.selectionText,
        createdAt: new Date().toISOString()
      })
    });
    console.log("Saved to Synapse:", info.selectionText);
  }
});
