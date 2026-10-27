// Runs before the page is drawn: marks that the script runs, picks the language and applies the theme, so
// the page appears in the right language and colours at once. The language comes from ?lang=, then the
// relay-lang cookie (the same choice as on registry-mirrors-relay's pages), then the older lm-lang choice,
// then the browser's languages, and is English otherwise.
(() => {
  const root = document.documentElement;
  root.classList.add('js');
  const ok = (v) => (v === 'en' || v === 'zh' ? v : '');
  let lang = ok(new URLSearchParams(location.search).get('lang'));
  if (!lang) {
    const m = /(?:^|;\s*)relay-lang=([a-z]+)/.exec(document.cookie);
    lang = ok(m ? m[1] : '');
  }
  if (!lang) {
    try {
      lang = ok(localStorage.getItem('lm-lang'));
    } catch {
      // storage blocked
    }
  }
  if (!lang) {
    for (const l of navigator.languages || [navigator.language || '']) {
      const tag = String(l).toLowerCase();
      if (tag.startsWith('zh')) {
        lang = 'zh';
        break;
      }
      if (tag.startsWith('en')) {
        lang = 'en';
        break;
      }
    }
  }
  root.lang = lang === 'zh' ? 'zh-CN' : 'en';
  let theme = '';
  try {
    theme = localStorage.getItem('relay-theme') || '';
  } catch {
    // storage blocked
  }
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
})();
