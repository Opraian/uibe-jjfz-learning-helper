const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const folder = path.resolve(__dirname, '../extension');
const content = fs.readFileSync(path.join(folder, 'content.js'), 'utf8');
const site = fs.readFileSync(path.join(folder, 'site.js'), 'utf8');
const savedPlay = fs.readFileSync(path.join(__dirname, 'fixtures/play.html'), 'utf8');
const savedLesson = fs.readFileSync(path.join(__dirname, 'fixtures/lesson.html'), 'utf8');
const URL = 'http://jjfz.uibe.edu.cn/jjfz/play?v_id=101&r_id=201&r=video&pg=1';

async function make({ html = savedPlay, url = URL, running = true, settings = {}, hidden = false, initialPaused = false, workflow = null, denied = false } = {}) {
  const browserErrors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => browserErrors.push(error));
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole });
  const w = dom.window;
  const intervals = [], messages = [], requests = [], writes = [], runtimeListeners = [];
  let root, paused = initialPaused, ended = false, time = 15, duration = 328, pauses = 0, autoplay = 0, now = 10000;
  const attach = w.Element.prototype.attachShadow;
  w.Element.prototype.attachShadow = function (options) { root = attach.call(this, options); return root; };
  w.Element.prototype.getClientRects = () => [{ x: 0, y: 0, width: 10, height: 10 }];
  Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  w.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  w.Date.now = () => now;
  w.chrome = {
    runtime: {
      sendMessage: async message => {
        messages.push(message.type); requests.push(JSON.parse(JSON.stringify(message)));
        if (message.type === 'start') running = true;
        if (message.type === 'stop') running = false;
        if (Object.hasOwn(message, 'workflow')) workflow = message.workflow;
        if (message.clearWorkflow) workflow = null;
        return { running, workflow };
      },
      onMessage: { addListener(fn) { runtimeListeners.push(fn); } }
    },
    storage: { local: { get: async () => ({ settings }), set: async value => writes.push(value) } }
  };
  const video = w.document.querySelector('#video');
  if (video) {
    Object.defineProperties(video, {
      currentTime: { configurable: true, get: () => time, set() { throw new Error('Extension must not seek'); } },
      duration: { configurable: true, get: () => duration },
      ended: { configurable: true, get: () => ended },
      paused: { configurable: true, get: () => paused },
      readyState: { configurable: true, get: () => 4 },
      playbackRate: { configurable: true, get: () => 1, set() { throw new Error('Extension must not change speed'); } }
    });
    video.pause = () => { pauses++; paused = true; };
    video.play = () => {
      autoplay++;
      if (denied) { const error = new Error('User gesture required'); error.name = 'NotAllowedError'; return Promise.reject(error); }
      paused = false; return Promise.resolve();
    };
  }
  w.eval(site);
  w.eval(content);
  await new Promise(resolve => setImmediate(resolve));
  const ui = id => root?.getElementById(id);
  const tick = async () => { for (const interval of intervals) interval.fn(); await new Promise(resolve => setImmediate(resolve)); };
  function dialog(text, labels = ['继续'], { hide = false } = {}) {
    const box = w.document.createElement('div'); box.className = 'public_cont public_cont1';
    if (hide) box.style.display = 'none';
    const body = w.document.createElement('div'); body.className = 'public_text';
    const p = w.document.createElement('p'); p.textContent = text; body.append(p); box.append(body);
    const clicks = [];
    labels.forEach((label, i) => {
      const a = w.document.createElement('a'); a.className = i ? 'public_cancel' : 'public_submit';
      a.textContent = label; a.href = '#'; a.addEventListener('click', event => { event.preventDefault(); clicks.push(label); }); box.append(a);
    });
    w.document.body.append(box);
    return { box, clicks };
  }
  return {
    dom, w, ui, video, tick, dialog, intervals, messages, requests, writes, browserErrors,
    stats: () => ({ pauses, autoplay }),
    finish() { ended = true; time = duration; paused = true; video.dispatchEvent(new w.Event('ended')); },
    setPaused(value) { paused = value; },
    advanceClock(ms) { now += ms; },
    allowPlay() { denied = false; },
    close() { dom.window.close(); }
  };
}

test('synthetic playback fixture: detects title, four chapters and current chapter; no false completion', async () => {
  const s = await make();
  assert.match(s.ui('course').textContent, /示例课程/);
  assert.match(s.ui('chapter').textContent, /第一节/);
  assert.equal(s.ui('catalog').children.length, 4);
  assert.equal(s.ui('next').getAttribute('aria-disabled'), 'true');
  assert.match(s.ui('time').textContent, /0:15 \/ 5:28/);
  assert.equal(s.stats().autoplay, 0);
  s.close();
});
test('synthetic course fixture: reads 19 chapter/standalone links without duplicate course headers; four completion markers', async () => {
  const s = await make({ html: savedLesson, url: 'http://jjfz.uibe.edu.cn/jjfz/lesson/video?lesson_id=10' });
  assert.equal(s.ui('catalog').children.length, 19);
  assert.equal([...s.ui('catalog').querySelectorAll('small')].filter(n => n.textContent === '平台已标记完成').length, 4);
  s.close();
});
test('routine continuation is clicked once, even over repeated timer ticks', async () => {
  const s = await make(), d = s.dialog('视频已暂停，点击按钮后继续学习！');
  await s.tick(); await s.tick();
  assert.deepEqual(d.clicks, ['继续']); assert.match(s.ui('count').textContent, /1 次/); s.close();
});
test('resume dialog chooses continue watching, not restart', async () => {
  const s = await make(), d = s.dialog('同学你好！该课程视频你上次观看到：00:03:20', ['从头开始', '继续观看']);
  await s.tick(); assert.deepEqual(d.clicks, ['继续观看']); s.close();
});
test('initial advice is acknowledged but never counts as completion', async () => {
  const s = await make(), d = s.dialog('您需要完整观看一遍课程视频，才能获取本课学时，看到视频播放完毕提示框即为完成，然后视频可以拖动播放。', ['我知道了']);
  await s.tick(); assert.deepEqual(d.clicks, ['我知道了']);
  assert.equal(s.ui('next').getAttribute('aria-disabled'), 'true'); s.close();
});
for (const text of [
  '系统监测到您有异常学习行为，本视频观看无效，请您重新进行该视频内容学习。',
  '用户登录超时，点击退出重新登录',
  '异地登录，点击退出重新登录后，请及时修改密码',
  '请输入验证码后继续',
  '提交失败，请重试',
  '温馨提示：这是一个未知的新提示'
]) test(`stops without clicking: ${text}`, async () => {
  const s = await make(), d = s.dialog(text, ['我知道了']);
  await s.tick(); await s.tick();
  assert.equal(d.clicks.length, 0); assert.equal(s.stats().pauses, 1);
  assert.equal(s.ui('toggle').textContent, '开启辅助'); assert.equal(s.ui('status').dataset.fault, 'true');
  assert.ok(s.messages.includes('stop')); s.close();
});
test('anomaly takes priority over an earlier routine dialog', async () => {
  const s = await make(), routine = s.dialog('视频已暂停，点击按钮后继续学习！');
  const bad = s.dialog('系统监测到异常学习行为', ['我知道了']);
  await s.tick(); assert.equal(routine.clicks.length + bad.clicks.length, 0); s.close();
});
test('hidden anomaly dialogs do not stop ordinary visible continuation', async () => {
  const s = await make(); s.dialog('异常学习行为', ['我知道了'], { hide: true });
  const routine = s.dialog('视频已暂停，点击按钮后继续学习！');
  await s.tick(); assert.deepEqual(routine.clicks, ['继续']); s.close();
});
test('visible CAPTCHA stops automation and leaves the challenge alone', async () => {
  const s = await make(), routine = s.dialog('视频已暂停，点击按钮后继续学习！');
  const challenge = s.w.document.createElement('div'); challenge.className = 'verifybox'; s.w.document.body.append(challenge);
  await s.tick(); assert.equal(routine.clicks.length, 0); assert.match(s.ui('status').textContent, /验证/); s.close();
});
test('natural ended alone does not unlock the next chapter', async () => {
  const s = await make(); s.finish(); await s.tick();
  assert.match(s.ui('status').textContent, /等待平台完成确认/);
  assert.equal(s.ui('next').getAttribute('aria-disabled'), 'true'); s.close();
});
test('server success toast is acknowledged; next unlocks only after it closes', async () => {
  const s = await make(); s.finish();
  const d = s.dialog('当前视频播放完毕！', ['我知道了']);
  await s.tick(); assert.deepEqual(d.clicks, ['我知道了']);
  assert.equal(s.ui('next').getAttribute('aria-disabled'), 'true');
  d.box.remove(); await s.tick();
  assert.equal(s.ui('next').getAttribute('aria-disabled'), 'false');
  assert.match(s.ui('next').href, /r_id=202/); s.close();
});
test('current selection class alone never counts as completed', async () => {
  const s = await make(); await s.tick();
  assert.equal(s.ui('next').getAttribute('aria-disabled'), 'true'); s.close();
});
test('fresh platform red marker unlocks the next chapter without invented local records', async () => {
  const s = await make();
  s.w.document.querySelector('.video_red1 a').style.color = 'red'; await s.tick();
  assert.equal(s.ui('next').getAttribute('aria-disabled'), 'false');
  assert.equal(s.writes.length, 0); s.close();
});
test('last chapter offers no next link and displays completion', async () => {
  const s = await make({ url: URL.replace('201', '204') });
  s.w.document.querySelector('a[href*="r_id=204"]').style.color = 'red'; await s.tick();
  assert.equal(s.ui('next').hasAttribute('href'), false); assert.match(s.ui('status').textContent, /没有后续/); s.close();
});
test('no clicks in background; platform visibility rules remain intact', async () => {
  const s = await make({ hidden: true }), d = s.dialog('视频已暂停，点击按钮后继续学习！');
  await s.tick(); assert.equal(d.clicks.length, 0); s.close();
});
test('disabled dialog preference leaves routine prompts for the user', async () => {
  const s = await make({ settings: { autoDialogs: false } }), d = s.dialog('视频已暂停，点击按钮后继续学习！');
  await s.tick(); assert.equal(d.clicks.length, 0); s.close();
});
test('automation is off on a new tab until explicitly started', async () => {
  const s = await make({ running: false }), d = s.dialog('视频已暂停，点击按钮后继续学习！');
  await s.tick(); assert.equal(d.clicks.length, 0);
  s.ui('toggle').click(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(d.clicks, ['继续']); s.close();
});
test('two content-script instances remain independently enabled', async () => {
  const first = await make(), second = await make();
  first.ui('toggle').click(); await first.tick(); await second.tick();
  assert.equal(first.ui('toggle').textContent, '开启辅助');
  assert.equal(second.ui('toggle').textContent, '停止辅助');
  assert.equal(second.stats().pauses, 0); first.close(); second.close();
});
test('auto-next never navigates on ended without platform confirmation', async () => {
  const s = await make({ settings: { autoNext: true } });
  s.finish(); await s.tick(); await s.tick();
  assert.equal(s.browserErrors.length, 0); s.close();
});
test('auto-next waits for completion acknowledgement to close and navigates once', async () => {
  const s = await make({ settings: { autoNext: true } });
  s.finish(); const d = s.dialog('当前视频播放完毕！', ['我知道了']);
  await s.tick(); assert.equal(s.browserErrors.length, 0);
  d.box.remove(); await s.tick(); await s.tick();
  // JSDOM records navigation attempts without actually navigating or loading a page.
  assert.equal(s.browserErrors.length, 1);
  assert.match(s.browserErrors[0].message, /navigation/);
  assert.match(s.ui('logs').textContent, /进入：第二节/); s.close();
});
test('a platform-completed chapter still cannot navigate while an anomaly exists', async () => {
  const s = await make({ settings: { autoNext: true } });
  s.w.document.querySelector('.video_red1 a').style.color = 'red';
  const d = s.dialog('异常学习行为', ['我知道了']); await s.tick();
  assert.equal(d.clicks.length, 0); assert.equal(s.browserErrors.length, 0);
  assert.equal(s.ui('next').getAttribute('aria-disabled'), 'true'); s.close();
});
test('turning off auto-dialogs leaves completion modal open and blocks auto-next', async () => {
  const s = await make({ settings: { autoNext: true, autoDialogs: false } });
  const d = s.dialog('当前视频播放完毕！', ['我知道了']); await s.tick();
  assert.equal(d.clicks.length, 0); assert.equal(s.browserErrors.length, 0); s.close();
});
test('media loading error stops assistance and leaves any routine prompt untouched', async () => {
  const s = await make(), d = s.dialog('视频已暂停，点击按钮后继续学习！');
  Object.defineProperty(s.video, 'error', { configurable: true, get: () => ({ code: 3 }) });
  await s.tick(); assert.equal(d.clicks.length, 0); assert.match(s.ui('status').textContent, /视频加载错误/); s.close();
});
test('duplicate content-script injection creates no duplicate panel or timer', async () => {
  const s = await make(); s.w.eval(content);
  assert.equal(s.intervals.length, 1);
  assert.equal(s.w.document.querySelectorAll('#uibe-learning-helper').length, 1); s.close();
});
test('a standard stop button releases ownership and prevents further clicks', async () => {
  const s = await make(); s.ui('toggle').click(); await new Promise(resolve => setImmediate(resolve));
  const d = s.dialog('视频已暂停，点击按钮后继续学习！'); await s.tick();
  assert.ok(s.messages.includes('stop')); assert.equal(d.clicks.length, 0); s.close();
});
test('completion style on a different course is excluded from the playback directory', async () => {
  const s = await make();
  const li = s.w.document.createElement('li'); li.innerHTML = '<a style="color:red" href="/jjfz/play?v_id=9999&r_id=1">other course</a>';
  s.w.document.querySelector('.video_lists ul').append(li); await s.tick();
  assert.equal(s.ui('catalog').children.length, 4);
  assert.equal(s.ui('next').getAttribute('aria-disabled'), 'true'); s.close();
});
test('unsafe or off-site chapter URLs are discarded', async () => {
  const s = await make();
  const li = s.w.document.createElement('li'); li.innerHTML = '<a href="https://evil.example/jjfz/play?v_id=2&r_id=3">offsite</a><a href="javascript:alert(1)">script</a>';
  s.w.document.querySelector('.video_lists ul').append(li); await s.tick();
  assert.equal(s.ui('catalog').children.length, 4); s.close();
});
test('site texts are rendered as text; no injected markup is created', async () => {
  const s = await make();
  s.w.document.querySelector('.video_red1 a').textContent = '<img src=x onerror=alert(1)>'; await s.tick();
  assert.equal(s.ui('catalog').querySelectorAll('img').length, 0); s.close();
});
test('login page releases ownership and never operates login fields', async () => {
  const s = await make({ html: '<form><input type="password"></form>', url: 'http://jjfz.uibe.edu.cn/user/login' });
  assert.match(s.ui('status').textContent, /登录状态/); assert.ok(s.messages.includes('stop')); s.close();
});
test('unrelated domains are untouched even with identical HTML', async () => {
  const s = await make({ url: 'https://example.com/jjfz/play?v_id=101&r_id=201' });
  assert.equal(s.w.document.getElementById('uibe-learning-helper'), null); s.close();
});
test('production source has no seeking, rate changes, network calls or page-timer cancellation', () => {
  const runtimeSource = content + site + fs.readFileSync(path.join(folder, 'background.js'), 'utf8');
  assert.doesNotMatch(runtimeSource, /(?:currentTime|playbackRate)\s*=/);
  assert.doesNotMatch(runtimeSource, /\b(?:fetch|XMLHttpRequest|WebSocket|eval|clearInterval|clearTimeout)\s*\(/);
  assert.doesNotMatch(runtimeSource, /document\.(?:cookie|hidden|visibilityState)\s*=(?!=|>)/);
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json')));
  assert.deepEqual(manifest.permissions, ['storage']); assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.content_scripts[0].matches.every(url => /^https?:\/\/jjfz\.uibe\.edu\.cn\//.test(url)));
});
test('background retains independent concurrent tab sessions and workflows', async () => {
  const data = {}, listeners = [], removed = [];
  const chrome = {
    runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } },
    storage: { session: {
      get: async key => ({ [key]: data[key] }),
      set: async value => Object.assign(data, value),
      remove: async key => { delete data[key]; }
    } },
    tabs: { onRemoved: { addListener(fn) { removed.push(fn); } } }
  };
  vm.runInNewContext(fs.readFileSync(path.join(folder, 'background.js'), 'utf8'), { chrome });
  const send = (id, type, extra = {}) => new Promise(resolve => listeners[0]({ type, ...extra }, { tab: { id } }, resolve));
  await Promise.all([send(1, 'start'), send(2, 'start')]);
  assert.equal((await send(1, 'state')).running, true);
  assert.equal((await send(2, 'state')).running, true);
  await send(1, 'updateWorkflow', { workflow: { index: 2 } });
  assert.equal((await send(1, 'state')).workflow.index, 2);
  assert.equal((await send(2, 'state')).workflow, null);
  await send(1, 'stop'); assert.equal((await send(2, 'state')).running, true);
  assert.equal((await send(1, 'state')).running, false);
  removed[0](1); await send(2, 'state');
  assert.equal(data.tabSessions['1'], undefined);
  assert.equal((await send(2, 'state')).running, true);
});

test('public package metadata uses UIBE jjfz branding', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json')));
  assert.equal(manifest.name, 'UIBE jjfz 学习助手');
  assert.equal(manifest.version, '1.1.0');
  for (const file of ['content.js', 'help.html']) assert.ok(fs.readFileSync(path.join(folder, file), 'utf8').includes(manifest.name));
});

test('paused playback automatically resumes without changing speed or time', async () => {
  const s = await make({ initialPaused: true });
  assert.equal(s.stats().autoplay, 1); assert.equal(s.video.paused, false);
  s.setPaused(true); s.advanceClock(3000); await s.tick();
  assert.equal(s.stats().autoplay, 2); s.close();
});
test('auto-resume preference can be disabled', async () => {
  const s = await make({ initialPaused: true, settings: { autoResume: false } });
  await s.tick(); assert.equal(s.stats().autoplay, 0); assert.equal(s.video.paused, true); s.close();
});
test('background paused playback is not forcibly resumed', async () => {
  const s = await make({ initialPaused: true, hidden: true });
  await s.tick(); assert.equal(s.stats().autoplay, 0); s.close();
});
test('browser autoplay denial exposes one manual button instead of retrying continuously', async () => {
  const s = await make({ initialPaused: true, denied: true });
  await s.tick(); assert.equal(s.stats().autoplay, 1); assert.equal(s.ui('playNow').hidden, false);
  s.advanceClock(10000); await s.tick(); assert.equal(s.stats().autoplay, 1);
  s.allowPlay(); s.ui('playNow').click(); await s.tick();
  assert.equal(s.stats().autoplay, 2); assert.equal(s.video.paused, false); assert.equal(s.ui('playNow').hidden, true); s.close();
});
test('continuation modal closes before auto-resume is attempted', async () => {
  const s = await make(), d = s.dialog('视频已暂停，点击按钮后继续学习！');
  s.setPaused(true); d.box.querySelector('a').addEventListener('click', () => d.box.remove());
  await s.tick(); assert.equal(s.stats().autoplay, 0);
  await s.tick(); assert.equal(s.stats().autoplay, 1); s.close();
});
test('an unknown prompt prevents auto-resume', async () => {
  const s = await make(); s.setPaused(true); s.dialog('请阅读这个新提示', ['继续']);
  await s.tick(); assert.equal(s.stats().autoplay, 0); s.close();
});
test('a video that has ended is not automatically restarted', async () => {
  const s = await make(); s.finish(); s.advanceClock(3000); await s.tick();
  assert.equal(s.stats().autoplay, 0); s.close();
});
test('a player without buffered metadata waits rather than repeatedly calling play', async () => {
  const s = await make(); s.setPaused(true);
  Object.defineProperty(s.video, 'readyState', { configurable: true, get: () => 0 });
  await s.tick(); assert.equal(s.stats().autoplay, 0); assert.equal(s.ui('status').dataset.fault, 'false'); s.close();
});
test('a course-list panel entry enables assistance before attempting video navigation', async () => {
  const s = await make({ html: savedLesson, url: 'http://jjfz.uibe.edu.cn/jjfz/lesson/video?lesson_id=10', running: false });
  s.ui('catalog').querySelector('a[href*="v_id=102"]').click(); await s.tick();
  assert.ok(s.requests.some(request => request.type === 'start'));
  assert.ok(s.requests.some(request => request.type === 'updateWorkflow'));
  assert.equal(s.browserErrors.length, 1); s.close();
});
test('course cards contain a direct enter-and-assist action', async () => {
  const s = await make({ html: savedLesson, url: 'http://jjfz.uibe.edu.cn/jjfz/lesson/video?lesson_id=10', running: false });
  const buttons = [...s.w.document.querySelectorAll('[data-uibe-entry]')];
  assert.equal(buttons.length, 5);
  buttons.find(button => !button.disabled).click(); await s.tick();
  assert.ok(s.requests.some(request => request.type === 'start')); assert.equal(s.browserErrors.length, 1); s.close();
});
test('hub start captures all unfinished chapters and preserves the queue before navigation', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/hub.html'), 'utf8');
  const s = await make({ html, url: 'http://jjfz.uibe.edu.cn/jjfz/lesson', running: false });
  assert.equal(s.ui('catalog').children.length, 3);
  s.ui('toggle').click(); await s.tick();
  const start = s.requests.find(request => request.type === 'start');
  assert.equal(start.workflow.chapters.length, 2);
  assert.equal(start.workflow.chapters[0].lessonId, '10');
  assert.equal(s.browserErrors.length, 1); s.close();
});
test('a hub card can independently start just that chapter', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/hub.html'), 'utf8');
  const s = await make({ html, url: 'http://jjfz.uibe.edu.cn/jjfz/lesson', running: false });
  s.w.document.querySelectorAll('[data-uibe-entry]')[1].click(); await s.tick();
  const start = s.requests.find(request => request.type === 'start');
  assert.equal(start.workflow.chapters.length, 1); assert.equal(start.workflow.chapters[0].lessonId, '20'); s.close();
});
test('starting from a chapter page selects its premium-video tab', async () => {
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/chapter.html'), 'utf8');
  const s = await make({ html, url: 'http://jjfz.uibe.edu.cn/jjfz/lesson/lecture?lesson_id=10', running: false });
  s.ui('toggle').click(); await s.tick();
  assert.equal(s.browserErrors.length, 1);
  assert.match(s.ui('logs').textContent, /lesson\/video/); s.close();
});
test('required workflow resumes normal playback on arrival at a video', async () => {
  const workflow = { kind: 'required', chapters: [{ lessonId: '10', title: '章一', href: 'http://jjfz.uibe.edu.cn/jjfz/lesson/lecture?lesson_id=10' }], index: 0, listUrl: 'http://jjfz.uibe.edu.cn/jjfz/lesson/video?lesson_id=10&required=1' };
  const s = await make({ workflow, initialPaused: true });
  assert.equal(s.stats().autoplay, 1); assert.equal(s.browserErrors.length, 0); s.close();
});

test('standalone course completion badges are respected by list entry actions', async () => {
  const s = await make({ html: savedLesson, url: 'http://jjfz.uibe.edu.cn/jjfz/lesson/video?lesson_id=10', running: false });
  const card = s.w.document.querySelector('a[href*="v_id=102"]').closest('li');
  const badge = s.w.document.createElement('div'); badge.className = 'lesson_pass'; badge.textContent = '完成'; card.append(badge);
  await s.tick();
  assert.equal(card.querySelector('[data-uibe-entry]').disabled, true);
  assert.equal(s.ui('catalog').querySelector('a[href*="v_id=102"]').parentElement.querySelector('small').textContent, '平台已标记完成');
  s.close();
});
