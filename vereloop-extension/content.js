// Example: read a stored value so we know permissions work
chrome.storage.local.get(["fullName"], ({ fullName }) => {
  console.log("Vereloop fullName:", fullName);
});
