// One automation owner per browser profile. Navigation within the tab retains ownership.
const KEY = 'automationOwner';
let queue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab || !['state', 'start', 'stop'].includes(message?.type)) return;
  const work = queue.then(async () => {
    const stored = await chrome.storage.session.get(KEY);
    const previous = Number.isInteger(stored[KEY]) ? stored[KEY] : null;
    let owner = previous;
    if (message.type === 'start') owner = sender.tab.id;
    if (message.type === 'stop' && owner === sender.tab.id) owner = null;
    if (owner !== previous) {
      await chrome.storage.session.set({ [KEY]: owner });
      if (previous !== null && previous !== sender.tab.id) {
        await chrome.tabs.sendMessage(previous, { type: 'ownershipLost' }).catch(() => {});
      }
    }
    return { running: owner === sender.tab.id };
  });
  queue = work.catch(() => {});
  work.then(reply, () => reply({ running: false, error: true }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  queue = queue.then(async () => {
    const stored = await chrome.storage.session.get(KEY);
    if (stored[KEY] === tabId) await chrome.storage.session.remove(KEY);
  }).catch(() => {});
});
