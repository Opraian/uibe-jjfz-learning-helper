// Each tab owns its own session. Navigation retains that tab's workflow.
const KEY = 'tabSessions';
let queue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!sender.tab || !['state', 'start', 'stop', 'updateWorkflow'].includes(message?.type)) return;
  const work = queue.then(async () => {
    const stored = await chrome.storage.session.get(KEY);
    const sessions = stored[KEY] && typeof stored[KEY] === 'object' ? stored[KEY] : {};
    const id = String(sender.tab.id);
    const session = sessions[id] || { running: false, workflow: null };
    if (message.type === 'start') {
      session.running = true;
      if (Object.hasOwn(message, 'workflow')) session.workflow = message.workflow;
    }
    if (message.type === 'stop') {
      session.running = false;
      if (message.clearWorkflow) session.workflow = null;
    }
    if (message.type === 'updateWorkflow') session.workflow = message.workflow;
    if (message.type !== 'state') {
      sessions[id] = session;
      await chrome.storage.session.set({ [KEY]: sessions });
    }
    return { running: Boolean(session.running), workflow: session.workflow || null };
  });
  queue = work.catch(() => {});
  work.then(reply, () => reply({ running: false, workflow: null, error: true }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => {
  queue = queue.then(async () => {
    const stored = await chrome.storage.session.get(KEY);
    const sessions = stored[KEY] || {};
    delete sessions[String(tabId)];
    await chrome.storage.session.set({ [KEY]: sessions });
  }).catch(() => {});
});
