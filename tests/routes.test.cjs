const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../extension/site.js'), 'utf8');
const base = 'http://jjfz.uibe.edu.cn';
function page(name, url) {
  const html = name.startsWith('<') ? name : fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');
  const dom = new JSDOM(html, { url: base + url, runScripts: 'outside-only' });
  dom.window.eval(source);
  return { dom, document: dom.window.document, site: dom.window.UIBEHelperSite, href: base + url, close: () => dom.window.close() };
}
function flow(site) { return site.workflow([
  { href: base + '/jjfz/lesson/lecture?lesson_id=10', lessonId: '10', title: '第一章' },
  { href: base + '/jjfz/lesson/lecture?lesson_id=20', lessonId: '20', title: '第二章' }
]); }

test('hub discovery deduplicates links and preserves chapter titles/completion', () => {
  const p = page('hub.html', '/jjfz/lesson'); const chapters = p.site.readChapters(p.document, p.href);
  assert.equal(chapters.length, 3); assert.equal(chapters[0].title, '示例章一');
  assert.equal(chapters[2].done, true); assert.equal(p.site.workflow(chapters).chapters.length, 2); p.close();
});
test('the first queue step uses the actual chapter link', () => {
  const p = page('hub.html', '/jjfz/lesson'), action = p.site.plan(p.document, p.href, flow(p.site), [], false, null);
  assert.equal(action.kind, 'navigate'); assert.equal(action.href, base + '/jjfz/lesson/lecture?lesson_id=10'); p.close();
});
test('chapter pages choose premium courses before any video', () => {
  const p = page('chapter.html', '/jjfz/lesson/lecture?lesson_id=10'), action = p.site.plan(p.document, p.href, flow(p.site), [], false, null);
  assert.equal(action.href, base + '/jjfz/lesson/video?lesson_id=10'); p.close();
});
test('premium courses select required courses before a video', () => {
  const p = page('lesson.html', '/jjfz/lesson/video?lesson_id=10');
  const action = p.site.plan(p.document, p.href, flow(p.site), [{ done: false, href: base + '/jjfz/play?v_id=101' }], false, null);
  assert.equal(action.href, base + '/jjfz/lesson/video?lesson_id=10&required=1'); p.close();
});
test('required list enters the first unmarked video and saves its exact return URL', () => {
  const p = page('lesson.html', '/jjfz/lesson/video?lesson_id=10&required=1&page=2');
  const target = base + '/jjfz/play?v_id=102';
  const action = p.site.plan(p.document, p.href, flow(p.site), [{ done: true, href: 'unused' }, { done: false, href: target }], false, null);
  assert.equal(action.href, target); assert.equal(action.workflow.listUrl, p.href); p.close();
});
test('video completion is never inferred from navigation context', () => {
  const p = page('play.html', '/jjfz/play?v_id=101&r_id=201');
  const state = { ...flow(p.site), listUrl: base + '/jjfz/lesson/video?lesson_id=10&required=1' };
  assert.equal(p.site.plan(p.document, p.href, state, [], false, null).kind, 'wait'); p.close();
});
test('confirmed video advances within its course, then returns to the required list', () => {
  const p = page('play.html', '/jjfz/play?v_id=101&r_id=201');
  const state = { ...flow(p.site), listUrl: base + '/jjfz/lesson/video?lesson_id=10&required=1' };
  const next = { href: base + '/jjfz/play?v_id=101&r_id=202' };
  assert.equal(p.site.plan(p.document, p.href, state, [], true, next).href, next.href);
  assert.equal(p.site.plan(p.document, p.href, state, [], true, null).href, state.listUrl); p.close();
});
test('a completed required list advances to the next actual chapter', () => {
  const p = page('lesson.html', '/jjfz/lesson/video?lesson_id=10&required=1');
  const action = p.site.plan(p.document, p.href, flow(p.site), [{ done: true }], false, null);
  assert.equal(action.workflow.index, 1); assert.equal(action.href, base + '/jjfz/lesson/lecture?lesson_id=20'); p.close();
});
test('required pagination stays within the same chapter and filter', () => {
  const p = page('<div class="pages">共2页<a href="/jjfz/lesson/video?lesson_id=10&required=1&page=2">下一页</a><a href="/jjfz/lesson/video?lesson_id=20&required=1&page=2">其他章</a></div>', '/jjfz/lesson/video?lesson_id=10&required=1');
  const action = p.site.plan(p.document, p.href, flow(p.site), [{ done: true }], false, null);
  assert.equal(action.href, base + '/jjfz/lesson/video?lesson_id=10&required=1&page=2'); p.close();
});
test('missing pagination stops instead of silently skipping required work', () => {
  const p = page('<div class="pages">共2页</div>', '/jjfz/lesson/video?lesson_id=10&required=1');
  assert.equal(p.site.plan(p.document, p.href, flow(p.site), [{ done: true }], false, null).kind, 'stop'); p.close();
});
test('missing premium tab stops without inventing a URL', () => {
  const p = page('<p>其他页面</p>', '/jjfz/lesson/lecture?lesson_id=10');
  assert.equal(p.site.plan(p.document, p.href, flow(p.site), [], false, null).kind, 'stop'); p.close();
});
test('missing required tab stops without opening optional videos', () => {
  const p = page('<p>没有筛选入口</p>', '/jjfz/lesson/video?lesson_id=10');
  assert.equal(p.site.plan(p.document, p.href, flow(p.site), [], false, null).kind, 'stop'); p.close();
});
test('an unrecognized empty list never implies completion', () => {
  const p = page('<div class="lesson1_lists"></div>', '/jjfz/lesson/video?lesson_id=10&required=1');
  assert.equal(p.site.plan(p.document, p.href, flow(p.site), [], false, null).kind, 'stop'); p.close();
});
test('explicitly empty required list can advance to the next chapter', () => {
  const p = page('<div class="lesson1_lists">暂无课程</div>', '/jjfz/lesson/video?lesson_id=10&required=1');
  assert.equal(p.site.plan(p.document, p.href, flow(p.site), [], false, null).workflow.index, 1); p.close();
});
test('the last completed chapter ends the sequence without more navigation', () => {
  const p = page('lesson.html', '/jjfz/lesson/video?lesson_id=20&required=1');
  const state = { ...flow(p.site), index: 1 };
  assert.equal(p.site.plan(p.document, p.href, state, [{ done: true }], false, null).kind, 'done'); p.close();
});
test('manual navigation outside the queued chapter pauses the workflow', () => {
  const p = page('chapter.html', '/jjfz/lesson/lecture?lesson_id=99');
  assert.equal(p.site.plan(p.document, p.href, flow(p.site), [], false, null).kind, 'stop'); p.close();
});
test('off-site, credential-bearing, JavaScript and examination URLs are rejected', () => {
  const p = page('hub.html', '/jjfz/lesson');
  for (const value of ['https://evil.example/jjfz/play?v_id=1', 'http://name:pass@jjfz.uibe.edu.cn/jjfz/lesson', 'javascript:alert(1)', '/jjfz/exam_center']) assert.equal(p.site.safeURL(value, p.href), null);
  p.close();
});

test('two-chapter required workflow returns to each list and finishes only after simulated confirmations', () => {
  let state;
  function step(name, url, catalog = [], confirmed = false) {
    const p = page(name, url);
    if (!state) state = flow(p.site);
    const action = p.site.plan(p.document, p.href, state, catalog, confirmed, null);
    if (action.workflow) state = action.workflow;
    p.close(); return action;
  }
  assert.match(step('hub.html', '/jjfz/lesson').href, /lecture\?lesson_id=10/);
  assert.match(step('chapter.html', '/jjfz/lesson/lecture?lesson_id=10').href, /video\?lesson_id=10$/);
  assert.match(step('lesson.html', '/jjfz/lesson/video?lesson_id=10').href, /required=1/);
  const firstVideo = base + '/jjfz/play?v_id=101&r_id=201';
  assert.equal(step('lesson.html', '/jjfz/lesson/video?lesson_id=10&required=1', [{ href: firstVideo, done: false }]).href, firstVideo);
  assert.equal(step('play.html', '/jjfz/play?v_id=101&r_id=201').kind, 'wait');
  assert.match(step('play.html', '/jjfz/play?v_id=101&r_id=201', [], true).href, /required=1/);
  assert.match(step('lesson.html', '/jjfz/lesson/video?lesson_id=10&required=1', [{ done: true }]).href, /lecture\?lesson_id=20/);
  const chapter20 = fs.readFileSync(path.join(__dirname, 'fixtures/chapter.html'), 'utf8').replaceAll('lesson_id=10', 'lesson_id=20');
  const list20 = fs.readFileSync(path.join(__dirname, 'fixtures/lesson.html'), 'utf8').replaceAll('lesson_id=10', 'lesson_id=20');
  const play20 = fs.readFileSync(path.join(__dirname, 'fixtures/play.html'), 'utf8').replaceAll('lesson_id=10', 'lesson_id=20');
  assert.match(step(chapter20, '/jjfz/lesson/lecture?lesson_id=20').href, /video\?lesson_id=20$/);
  assert.match(step(list20, '/jjfz/lesson/video?lesson_id=20').href, /required=1/);
  step(list20, '/jjfz/lesson/video?lesson_id=20&required=1', [{ href: base + '/jjfz/play?v_id=201&r_id=301', done: false }]);
  assert.equal(step(play20, '/jjfz/play?v_id=201&r_id=301').kind, 'wait');
  assert.match(step(play20, '/jjfz/play?v_id=201&r_id=301', [], true).href, /lesson_id=20&required=1/);
  assert.equal(step(list20, '/jjfz/lesson/video?lesson_id=20&required=1', [{ done: true }]).kind, 'done');
});
