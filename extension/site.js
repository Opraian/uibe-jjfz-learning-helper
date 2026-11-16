/* Navigation planning uses only links already exposed by the platform page. */
(() => {
  'use strict';
  const text = value => String(value || '').replace(/\s+/g, ' ').trim();
  function info(href) {
    const url = new URL(href);
    return {
      url, play: /^\/jjfz\/play\/?$/.test(url.pathname),
      hub: /^\/(?:jjfz\/lesson|user\/lesson)\/?$/.test(url.pathname),
      chapter: /^\/jjfz\/lesson\/(?:lecture|video|read|resources)\/?$/.test(url.pathname),
      videoList: /^\/jjfz\/lesson\/video\/?$/.test(url.pathname),
      lessonId: url.searchParams.get('lesson_id'),
      required: url.searchParams.get('required') === '1'
    };
  }
  function safeURL(value, base) {
    try {
      const url = new URL(value, base), origin = new URL(base).origin;
      if (url.origin !== origin || url.hostname !== 'jjfz.uibe.edu.cn' || url.username || url.password) return null;
      if (!/^\/jjfz\/(?:play|lesson(?:\/(?:lecture|video|read|resources))?)\/?$/.test(url.pathname) && url.pathname !== '/user/lesson') return null;
      url.hash = '';
      return url.href;
    } catch { return null; }
  }
  function link(anchor, base) { return anchor && safeURL(anchor.getAttribute('href'), base); }
  function readChapters(document, base) {
    const seen = new Set(), entries = [];
    for (const anchor of document.querySelectorAll('a[href]')) {
      const href = link(anchor, base);
      if (!href) continue;
      const page = info(href);
      if (!page.chapter || !page.lessonId || seen.has(page.lessonId)) continue;
      seen.add(page.lessonId);
      const card = anchor.closest('.lesson_c_ul > li, .study_plan2, .lesson-card') || anchor.closest('li');
      const title = text(card?.querySelector('.lesson_ul_title h2, h2, h3')?.textContent) || text(anchor.textContent) || `章节 ${page.lessonId}`;
      const numbers = [...(card?.querySelectorAll('.lesson_center_dl dd') || [])].map(dd => text(dd.textContent));
      const total = numbers.find(line => /^必读课件/.test(line))?.match(/\d+/);
      const completed = numbers.find(line => /^已完成必读课件/.test(line))?.match(/\d+/);
      entries.push({ href, lessonId: page.lessonId, title, done: Boolean(total && completed && Number(total[0]) > 0 && Number(completed[0]) >= Number(total[0])), anchor, card });
    }
    return entries;
  }
  function videoTab(document, base, lessonId) {
    return [...document.querySelectorAll('a[href]')].find(anchor => {
      const href = link(anchor, base);
      return href && info(href).videoList && info(href).lessonId === lessonId && text(anchor.querySelector('span')?.textContent || anchor.textContent).includes('精品课程');
    });
  }
  function requiredTab(document, base, lessonId) {
    return [...document.querySelectorAll('a[href]')].find(anchor => {
      const href = link(anchor, base);
      return href && info(href).videoList && info(href).lessonId === lessonId && info(href).required && text(anchor.textContent) === '必修';
    });
  }
  function nextPage(document, base) {
    const current = info(base), pageNumber = Number(current.url.searchParams.get('page') || 1);
    return [...document.querySelectorAll('.pages a[href], a[rel="next"][href]')].map(anchor => ({ anchor, href: link(anchor, base) }))
      .filter(item => item.href && info(item.href).videoList && info(item.href).lessonId === current.lessonId && info(item.href).required)
      .filter(item => Number(new URL(item.href).searchParams.get('page') || 1) > pageNumber)
      .sort((a, b) => Number(new URL(a.href).searchParams.get('page')) - Number(new URL(b.href).searchParams.get('page')))[0]?.href || null;
  }
  function workflow(entries, hubUrl = null) {
    return { kind: 'required', chapters: entries.filter(entry => !entry.done).map(({ href, lessonId, title }) => ({ href, lessonId, title })), index: 0, listUrl: null, hubUrl };
  }
  function plan(document, base, state, catalog, confirmed, next) {
    const current = info(base), chapter = state.chapters[state.index];
    if (!chapter) return { kind: 'done', text: '本次章节必修辅助已完成' };
    const navigate = (href, updated = state) => ({ kind: 'navigate', href, workflow: updated });
    const stop = message => ({ kind: 'stop', text: message });
    if (current.hub) return navigate(chapter.href);
    if (current.play) {
      const back = link(document.querySelector('a.video_goback[href]'), base);
      if (back && info(back).lessonId && info(back).lessonId !== chapter.lessonId) return stop('当前视频不属于本次辅助章节，请返回必修列表');
      if (!confirmed) return { kind: 'wait' };
      if (next) return navigate(next.href);
      if (!state.listUrl || !safeURL(state.listUrl, base)) return stop('缺少本章必修列表入口，请从课程列表重新开始');
      return navigate(state.listUrl);
    }
    if (!current.chapter || current.lessonId !== chapter.lessonId) return stop('当前页面不属于本次章节辅助流程，请重新选择入口');
    if (!current.videoList) {
      const target = videoTab(document, base, chapter.lessonId);
      return target ? navigate(link(target, base)) : stop('未找到本章的“精品课程”入口，请检查页面');
    }
    if (!current.required) {
      const target = requiredTab(document, base, chapter.lessonId);
      return target ? navigate(link(target, base)) : stop('未找到本章的“必修”入口，请检查页面');
    }
    const unfinished = catalog.find(item => !item.done);
    if (unfinished) return navigate(unfinished.href, { ...state, listUrl: current.url.href });
    const empty = /暂无|没有.*课程|无.*课程/.test(text(document.querySelector('.lesson1_lists, .lesson1_cont')?.textContent));
    if (!catalog.length && !empty) return stop('未识别到必修视频，请检查列表页面');
    const page = nextPage(document, base);
    if (page) return navigate(page, { ...state, listUrl: page });
    const totalPages = text(document.querySelector('.pages')?.textContent).match(/共\s*(\d+)\s*页/);
    if (totalPages && Number(totalPages[1]) > Number(current.url.searchParams.get('page') || 1)) return stop('未识别到下一页必修课程入口，请检查分页');
    const advanced = { ...state, index: state.index + 1, listUrl: null };
    return advanced.index < advanced.chapters.length ? navigate(advanced.chapters[advanced.index].href, advanced) : { kind: 'done', text: '本次章节必修辅助已完成' };
  }
  globalThis.UIBEHelperSite = Object.freeze({ info, safeURL, readChapters, workflow, plan });
})();
