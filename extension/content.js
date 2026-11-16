/*
 * UIBE jjfz 学习助手 v1.1.0 — MIT
 * Adaptation reference: Onion / Onion_Big, 党旗飘飘~~~UESTC 1.4.0 (MIT)
 * https://greasyfork.org/zh-CN/scripts/442470
 * Retains its course-selector, start/stop, dialog-click and next-chapter approach.
 * Replaces broad clicking, timer/cookie handling and old course navigation;
 * adds strict dialog classification and server-rendered completion gating.
 */
(() => {
  'use strict';
  if (location.hostname !== 'jjfz.uibe.edu.cn' || window.top !== window) return;
  if (document.getElementById('uibe-learning-helper')) return;
  const Site = globalThis.UIBEHelperSite;
  const pageInfo = Site.info(location.href);
  const playPage = pageInfo.play;
  const lessonPage = pageInfo.hub || pageInfo.chapter;
  const loginPage = /\/(?:login|logout)(?:\/|$)/.test(location.pathname);
  if (!playPage && !lessonPage && !loginPage) return;

  const DEFAULTS = { autoDialogs: true, autoNext: false, autoResume: true, collapsed: false };
  let settings = { ...DEFAULTS };
  let running = false, fault = '', pending = false, media = null;
  let ended = false, confirmed = false, navigating = false, clickedCount = 0;
  let listSignature = '', lastAnnouncement = '', initDone = false;
  let workflow = null, sequenceDone = '', needsGesture = false, playPending = false;
  let lastPlayAttempt = -Infinity;
  const processed = new WeakSet();
  const logs = [];
  const currentParams = new URL(location.href).searchParams;
  const currentRid = currentParams.get('r_id');
  const currentVid = currentParams.get('v_id');
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
  const host = document.createElement('div');
  host.id = 'uibe-learning-helper';
  host.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:1000000;max-width:calc(100vw - 24px);';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host{all:initial;color-scheme:light}*{box-sizing:border-box}
      section{width:332px;max-width:calc(100vw - 24px);max-height:80vh;overflow:auto;background:#fff;color:#263240;border:1px solid #e0e3e7;border-radius:14px;box-shadow:0 8px 35px #0003;font:13px/1.6 "Microsoft YaHei",system-ui,sans-serif}
      header{display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px solid #edf0f3}strong{font-size:15px}button,a{font:inherit}button{cursor:pointer;border:1px solid #d6dce3;border-radius:7px;padding:6px 10px;background:#fff;color:#263240}button:hover{background:#f4f6f8}button:disabled{cursor:wait;opacity:.5}
      #toggle{background:#a32d3b;color:#fff;border-color:#a32d3b}#fold{padding:1px 8px}main{padding:12px 15px}.collapsed main{display:none}.collapsed{width:224px}
      #course{font-weight:600;margin-bottom:3px}#chapter{font-size:12px;color:#5b6775}#status{margin:10px 0 6px;color:#48596d}#status[data-fault="true"]{color:#a82435;font-weight:600}progress{width:100%;height:7px;accent-color:#a32d3b}#time{font:12px/1.8 ui-monospace,monospace;color:#5b6775}.actions{display:flex;align-items:center;gap:8px;margin:10px 0;flex-wrap:wrap}.actions a{color:#962b39}a{color:#344b64;text-decoration:none}a:hover{text-decoration:underline}a[aria-disabled="true"]{pointer-events:none;color:#89929c}label{display:block;margin:5px 0}input{accent-color:#a32d3b;vertical-align:middle;margin-right:6px}
      details{border-top:1px solid #edf0f3;margin-top:12px;padding-top:9px}summary{cursor:pointer;color:#5b6775}#catalog{list-style:none;padding:0;margin:8px 0;max-height:210px;overflow:auto}#catalog li{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid #f0f2f4}#catalog a{flex:1}#catalog small{white-space:nowrap;color:#6d7987;font-size:11px}#catalog li[data-current="true"] a{font-weight:bold;color:#a32d3b}#logs{padding:0;list-style:none;font-size:11px;color:#697585;max-height:110px;overflow:auto}.note{font-size:11px;color:#7b8592;margin-top:9px}
    </style>
    <section><header><strong>UIBE jjfz · 学习助手</strong><button id="fold" aria-label="收起面板">−</button></header><main>
      <div id="course">正在识别课程…</div><div id="chapter"></div>
      <div id="status" role="status" aria-live="polite"></div>
      <progress id="progress" max="100" value="0" aria-label="视频播放进度"></progress><div id="time">等待视频信息</div>
      <div class="actions"><button id="toggle">开启辅助</button><button id="playNow" hidden>点击继续播放</button><a id="next" aria-disabled="true">下一节</a><a id="back" hidden>返回课程页</a></div>
      <label><input id="dialogs" type="checkbox">自动点击常规继续学习 / 结束提示</label>
      <label><input id="resume" type="checkbox">暂停后自动尝试继续播放</label>
      <label><input id="autoNext" type="checkbox">平台确认完成后自动进入下一节</label>
      <details open><summary id="catalogTitle">课程目录</summary><ul id="catalog"></ul></details>
      <details><summary>本页运行记录</summary><ul id="logs"></ul></details>
      <div class="note">仅依据平台页面确认完成；异常或验证会停止辅助。<span id="count"></span></div>
      <div id="announcement" role="status" aria-live="assertive"></div>
    </main></section>`;
  document.documentElement.append(host);
  const ui = id => root.getElementById(id);
  function put(id, value) { if (ui(id).textContent !== value) ui(id).textContent = value; }
  function log(message) {
    logs.unshift(`${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${message}`);
    logs.splice(12);
    ui('logs').replaceChildren(...logs.map(line => { const li = document.createElement('li'); li.textContent = line; return li; }));
  }
  function visible(element) {
    if (!element || element.hidden || element.closest('[hidden], .hidden')) return false;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0') return false;
    }
    return element.getClientRects().length > 0;
  }
  function safeLink(anchor) {
    try {
      const href = Site.safeURL(anchor.getAttribute('href'), location.href);
      if (!href) return null;
      const url = new URL(href);
      return url.origin === location.origin && url.pathname === '/jjfz/play' && url.searchParams.has('v_id') ? url.href : null;
    } catch { return null; }
  }
  function platformDone(anchor) {
    const li = anchor.closest('li');
    return anchor.classList.contains('dd_cut_on') || li?.classList.contains('video_red2') ||
      Boolean(li && !li.querySelector('.lesson1_a a[href]') && normalize(li.querySelector('.lesson_pass')?.textContent) === '完成') ||
      ['red', 'rgb(255, 0, 0)', '#ff0000'].includes(anchor.style.color.toLowerCase());
  }
  function readCatalog() {
    if (pageInfo.hub) return Site.readChapters(document, location.href).map(item => ({ ...item, kind: 'chapter', selected: false }));
    const selectors = playPage ? '.video_lists li a[href]' : '.lesson1_a a[href], .l_list_right h2 a[href]';
    const found = [], seen = new Set();
    for (const anchor of document.querySelectorAll(selectors)) {
      if (!playPage && anchor.closest('h2') && anchor.closest('li')?.querySelector('.lesson1_a a[href]')) continue;
      const href = safeLink(anchor);
      if (!href) continue;
      const url = new URL(href), rid = url.searchParams.get('r_id'), vid = url.searchParams.get('v_id');
      if (playPage && currentVid && vid !== currentVid) continue;
      const key = `${vid}:${rid || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const selected = Boolean(playPage && (currentRid ? rid === currentRid : anchor.closest('li')?.classList.contains('video_red1')));
      found.push({ href, rid, vid, title: normalize(anchor.textContent), done: platformDone(anchor), selected, anchor, card: anchor.closest('.lesson1_lists > ul > li') });
    }
    return found;
  }
  function dialogText(dialog) {
    const paragraphs = [...dialog.querySelectorAll('.public_text p')].map(p => normalize(p.textContent)).filter(Boolean);
    return normalize(paragraphs.length ? paragraphs.join(' ') : (dialog.querySelector('.public_text') || dialog).textContent);
  }
  function classify(dialog) {
    const text = dialogText(dialog);
    if (/异常|无效|重新.*学习|登录|登陆|验证码|验证|人脸|异地|账号|账户|超时|错误|失败|网络|刷新|重试|不支持/.test(text)) return { type: 'blocked', text };
    const buttons = [...dialog.querySelectorAll('a.public_submit, a.public_cancel, button')];
    const find = label => buttons.find(button => normalize(button.textContent) === label && visible(button));
    if (/^视频已暂停，点击按钮后继续学习[！!。]?$/.test(text)) return { type: 'continue', text, button: find('继续') };
    if (/^同学你好！该课程视频你上次观看到：[\d:： ]+$/.test(text)) return { type: 'resume', text, button: find('继续观看') };
    if (/^当前视频播放完毕[！!。]?$/.test(text)) return { type: 'completed', text, button: find('我知道了') };
    if (text === '您需要完整观看一遍课程视频，才能获取本课学时，看到视频播放完毕提示框即为完成，然后视频可以拖动播放。') return { type: 'intro', text, button: find('我知道了') };
    return { type: 'unknown', text };
  }
  async function send(type, extra = {}) { return chrome.runtime.sendMessage({ type, ...extra }); }
  async function navigate(href, nextWorkflow = workflow) {
    const target = Site.safeURL(href, location.href);
    if (!target) { pause('页面提供的目标地址无法识别，请检查课程入口'); return; }
    if (navigating || !running) return;
    navigating = true;
    try {
      const result = await send('updateWorkflow', { workflow: nextWorkflow });
      if (result.error) throw new Error('状态保存失败');
      if (!running || !result.running) { navigating = false; return; }
      workflow = nextWorkflow;
      log(`进入：${new URL(target).pathname}`);
      location.assign(target);
    } catch { pause('课程切换状态保存失败，请重新开启辅助'); }
  }
  async function startRun(nextWorkflow = workflow) {
    const result = await send('start', { workflow: nextWorkflow });
    if (result.error) throw new Error('状态保存失败');
    running = result.running; workflow = result.workflow || null;
    fault = ''; navigating = false; needsGesture = false; sequenceDone = '';
    lastPlayAttempt = -Infinity;
    log('辅助已开启；本标签页独立运行');
  }
  async function openEntry(item) {
    if (pending) return;
    pending = true;
    try {
      if (item.kind === 'chapter') {
        await startRun(Site.workflow([item], location.href));
        tick();
      } else {
        await startRun(null);
        await navigate(item.href, null);
      }
    } catch { pause('视频辅助入口启动失败，请刷新页面'); }
    finally { pending = false; tick(); }
  }
  function injectEntryButtons(catalog) {
    if (playPage || loginPage) return;
    const groups = new Map();
    for (const item of catalog) {
      const container = item.card || item.anchor?.closest('li') || item.anchor?.parentElement;
      if (!container) continue;
      if (!groups.has(container)) groups.set(container, []);
      groups.get(container).push(item);
    }
    for (const [container, items] of groups) {
      let button = container.querySelector('button[data-uibe-entry]');
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.dataset.uibeEntry = 'true';
        button.style.cssText = 'display:inline-block;margin:8px;padding:5px 12px;border:1px solid #a32d3b;border-radius:6px;background:#fff;color:#a32d3b;cursor:pointer;font-size:13px';
        (container.querySelector('.l_list_right, .lesson_ul_title') || container).append(button);
      }
      const target = items.find(item => !item.done);
      button.disabled = !target;
      button.textContent = target ? (target.kind === 'chapter' ? '辅助本章必修' : '进入并辅助') : '平台已标记完成';
      button.onclick = event => { event.preventDefault(); event.stopPropagation(); if (target) void openEntry(target); };
    }
  }
  function attemptPlay(force = false) {
    if (!playPage || !running || fault || !media || media.ended || ended || confirmed || navigating || !media.paused || media.readyState < 2 || document.visibilityState !== 'visible') return;
    if (playPending || (!force && (!settings.autoResume || needsGesture || Date.now() - lastPlayAttempt < 3000))) return;
    lastPlayAttempt = Date.now(); playPending = true;
    try {
      Promise.resolve(media.play()).then(() => { needsGesture = false; ui('playNow').hidden = true; }, error => {
        if (!running) return;
        if (error?.name === 'NotAllowedError') {
          needsGesture = true; ui('playNow').hidden = false; log('浏览器要求点击播放，请点击“点击继续播放”');
        } else if (error?.name !== 'AbortError') pause('播放器无法继续播放，请检查网站提示');
      }).finally(() => { playPending = false; });
    } catch { playPending = false; pause('播放器无法继续播放，请检查网站提示'); }
  }
  function pause(reason, record = true) {
    if (fault === reason && !running) return;
    const wasRunning = running;
    running = false; fault = reason; navigating = false; needsGesture = false;
    if (media && !media.paused && !media.ended) media.pause();
    if (wasRunning) void send('stop').catch(() => {});
    if (record) log(reason);
  }
  function bindMedia() {
    const nextMedia = document.querySelector('video#video');
    if (nextMedia === media) return;
    if (media) media.removeEventListener('ended', onEnded);
    media = nextMedia;
    ended = false; confirmed = false; needsGesture = false; lastPlayAttempt = -Infinity;
    if (media) { media.addEventListener('ended', onEnded); log('已连接当前视频'); }
  }
  function onEnded() {
    ended = true;
    const message = '视频已自然结束，等待平台确认完成。';
    put('announcement', message); lastAnnouncement = message;
    log(message);
    tick();
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
    const whole = Math.floor(seconds), minutes = Math.floor(whole / 60), remainder = String(whole % 60).padStart(2, '0');
    return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
  }
  function render(catalog, current, next, dialogs) {
    put('course', normalize(document.querySelector('.video_cont h2, .video_head h3, .lesson_h1')?.textContent) || (loginPage ? '党校登录页' : pageInfo.hub ? '综合课程列表' : '课程列表'));
    put('chapter', current ? `当前章节 · ${current.title}` : (workflow ? `章节必修辅助 · ${workflow.index + 1}/${workflow.chapters.length}` : playPage ? '当前章节尚未识别' : `本页识别 ${catalog.length} 个章节 / 课程入口`));
    let status = running ? '辅助已开启，正在正常学习' : '辅助未开启，可查看目录和播放进度';
    if (playPage && !media) status = '等待播放器加载';
    if (media?.paused && !ended && running) status = document.visibilityState === 'hidden' ? '页面在后台，保留平台暂停行为' : settings.autoResume ? '视频已暂停，正在尝试恢复播放' : '视频已暂停，自动续播已关闭';
    if (needsGesture && running) status = '浏览器要求手动点击，请点击“点击继续播放”';
    if (workflow && !playPage && running) status = '正在进入本章“精品课程 → 必修”';
    if (ended && !confirmed) status = '视频已结束，等待平台完成确认';
    if (confirmed) status = next ? '平台已确认完成，可以进入下一节' : '本节已完成，本课程没有后续未完成章节';
    if (dialogs.length && !fault && !running) status = '页面有提示；开启辅助后可处理已识别的常规提示';
    if (fault) status = `已停止：${fault}`;
    else if (sequenceDone) status = sequenceDone;
    put('status', status); ui('status').dataset.fault = String(Boolean(fault));
    put('toggle', running ? '停止辅助' : lessonPage ? '开始必修辅助' : '开启辅助'); ui('toggle').disabled = pending;
    ui('playNow').hidden = !(running && needsGesture && !fault);
    ui('autoNext').checked = Boolean(workflow) || settings.autoNext;
    ui('autoNext').disabled = Boolean(workflow);
    const duration = media?.duration, time = media?.currentTime;
    ui('progress').value = Number.isFinite(duration) && duration > 0 ? Math.min(100, Math.max(0, time / duration * 100)) : 0;
    put('time', media ? `${formatTime(time)} / ${formatTime(duration)} · ${Number.isFinite(duration) ? formatTime(Math.max(0, duration - time)) : '--:--'} 剩余` : '等待视频信息');
    const nextAllowed = Boolean(confirmed && next && !fault && !dialogs.length && !navigating);
    ui('next').setAttribute('aria-disabled', String(!nextAllowed));
    if (nextAllowed) ui('next').href = next.href; else ui('next').removeAttribute('href');
    ui('next').title = nextAllowed ? next.title : '平台确认本节完成后可用';
    const back = document.querySelector('a.video_goback[href]');
    if (back) {
      const url = new URL(back.getAttribute('href'), location.href);
      if (url.origin === location.origin && /^\/jjfz\/lesson/.test(url.pathname)) { ui('back').href = url.href; ui('back').hidden = false; }
    }
    put('count', clickedCount ? ` 本页已处理 ${clickedCount} 次常规提示。` : '');
    const signature = JSON.stringify(catalog.map(item => [item.href, item.title, item.done, item.selected]));
    if (signature !== listSignature) {
      listSignature = signature;
      ui('catalog').replaceChildren(...catalog.map(item => {
        const li = document.createElement('li'), a = document.createElement('a'), badge = document.createElement('small');
        a.href = item.href; a.textContent = item.title; li.dataset.current = String(item.selected);
        a.addEventListener('click', event => { event.preventDefault(); void openEntry(item); });
        badge.textContent = item.done ? '平台已标记完成' : '未标记完成';
        li.append(a, badge); return li;
      }));
      put('catalogTitle', `课程目录 · 平台已标记 ${catalog.filter(item => item.done).length}/${catalog.length}`);
    }
  }
  function tick() {
    if (!initDone) return;
    bindMedia();
    const catalog = readCatalog(), index = catalog.findIndex(item => item.selected), current = catalog[index];
    injectEntryButtons(catalog);
    if (current?.done) confirmed = true;
    const next = index >= 0 ? catalog.slice(index + 1).find(item => !item.done) || (workflow ? catalog.slice(0, index).find(item => !item.done) : null) : null;
    const dialogs = [...document.querySelectorAll('.public_cont, .layui-layer-dialog, [role="alertdialog"]')].filter(visible);
    const classified = dialogs.map(classify);
    const verification = [...document.querySelectorAll('.verifybox, .verify-box, .geetest_panel, .nc-container, [id*="captcha"], [class*="captcha"], iframe[src*="captcha"]')].some(visible);
    if (running) {
      const bad = classified.find(item => ['blocked', 'unknown'].includes(item.type) || !item.button);
      if (loginPage || [...document.querySelectorAll('input[type="password"]')].some(visible)) pause('登录状态需要人工处理');
      else if (verification) pause('页面出现验证，请人工处理');
      else if (bad) pause(`请检查平台提示：${bad.text.slice(0, 100) || '未识别的弹窗'}`);
      else if (media?.error) pause('视频加载错误，请检查网站播放器后重新开启');
      else if (playPage && !current) pause('当前章节无法识别，已停止自动操作');
      else if (playPage && !media) { render(catalog, current, next, dialogs); return; }
      else {
        const completed = classified.find(item => item.type === 'completed');
        if (completed) confirmed = true;
        // Never dismiss a dialog or navigate while the platform considers the page hidden.
        if (document.visibilityState === 'visible') {
          const indexToClick = classified.findIndex((item, i) => settings.autoDialogs && !processed.has(dialogs[i]));
          if (indexToClick >= 0) {
            const item = classified[indexToClick];
            processed.add(dialogs[indexToClick]); clickedCount++;
            log(`已点击常规提示：${normalize(item.button.textContent)}`);
            item.button.click();
            render(catalog, current, next, dialogs);
            return; // Completion acknowledgement may reload; only navigate after fresh platform markup.
          }
          if (!dialogs.length && !navigating) {
            if (workflow) {
              const action = Site.plan(document, location.href, workflow, catalog, confirmed, next);
              if (action.kind === 'navigate') void navigate(action.href, action.workflow);
              else if (action.kind === 'stop') pause(action.text);
              else if (action.kind === 'done') {
                sequenceDone = action.text; running = false; workflow = null;
                log(sequenceDone); void send('stop', { clearWorkflow: true }).catch(() => {});
              }
            } else if (confirmed && settings.autoNext && next) {
              log(`平台已确认完成，进入：${next.title}`);
              void navigate(next.href, null);
            }
            attemptPlay();
          }
        }
      }
    } else {
      if (classified.some(item => item.type === 'completed')) confirmed = true;
    }
    if (confirmed && lastAnnouncement !== '平台已确认本节完成。') {
      lastAnnouncement = '平台已确认本节完成。'; put('announcement', lastAnnouncement); log(lastAnnouncement);
    }
    render(catalog, current, next, dialogs);
  }
  ui('toggle').addEventListener('click', async () => {
    if (pending) return;
    pending = true;
    try {
      if (running) {
        const result = await send('stop');
        if (result.error) throw new Error('状态保存失败');
        running = false; navigating = false; fault = ''; log('本标签页辅助已停止');
      } else {
        let flow = workflow;
        if (lessonPage && !flow) {
          const entries = pageInfo.hub ? readCatalog() : [{ href: location.href, lessonId: pageInfo.lessonId, title: normalize(document.querySelector('.lesson_h1')?.textContent) || '当前章节', done: false }];
          if (!entries.length) { pause('未识别到章节入口，请检查综合课程列表'); return; }
          flow = Site.workflow(entries, pageInfo.hub ? location.href : null);
        }
        await startRun(flow);
      }
    } catch { pause('扩展连接失效，请刷新页面'); }
    finally { pending = false; tick(); }
  });
  function saveSettings() { void chrome.storage.local.set({ settings }).catch(() => pause('设置保存失败，请刷新页面')); }
  for (const [id, key] of [['dialogs', 'autoDialogs'], ['autoNext', 'autoNext'], ['resume', 'autoResume']]) {
    ui(id).addEventListener('change', () => { settings[key] = ui(id).checked; saveSettings(); tick(); });
  }
  ui('fold').addEventListener('click', () => {
    settings.collapsed = !settings.collapsed;
    root.querySelector('section').classList.toggle('collapsed', settings.collapsed);
    put('fold', settings.collapsed ? '+' : '−');
    ui('fold').setAttribute('aria-label', settings.collapsed ? '展开面板' : '收起面板'); saveSettings();
  });
  ui('playNow').addEventListener('click', () => {
    tick();
    const dialogs = [...document.querySelectorAll('.public_cont, .layui-layer-dialog, [role="alertdialog"]')].some(visible);
    if (!dialogs) attemptPlay(true);
  });
  ui('next').addEventListener('click', async event => {
    event.preventDefault();
    tick();
    if (ui('next').getAttribute('aria-disabled') === 'true' || pending) return;
    const href = ui('next').href;
    try { await startRun(workflow); await navigate(href, workflow); }
    catch { pause('下一节辅助启动失败，请刷新页面'); }
  });
  Promise.all([chrome.storage.local.get('settings'), send('state')]).then(([saved, state]) => {
    for (const key of Object.keys(DEFAULTS)) if (typeof saved.settings?.[key] === 'boolean') settings[key] = saved.settings[key];
    running = Boolean(state.running); workflow = state.workflow || null; initDone = true;
    ui('dialogs').checked = settings.autoDialogs; ui('autoNext').checked = settings.autoNext; ui('resume').checked = settings.autoResume;
    root.querySelector('section').classList.toggle('collapsed', settings.collapsed);
    put('fold', settings.collapsed ? '+' : '−');
    ui('fold').setAttribute('aria-label', settings.collapsed ? '展开面板' : '收起面板');
    tick();
    window.setInterval(() => { try { tick(); } catch { pause('页面结构发生变化，请刷新后检查'); } }, 1000);
  }).catch(() => { initDone = true; pause('扩展连接失效，请刷新页面'); put('status', '扩展连接失效，请刷新页面'); });
})();
