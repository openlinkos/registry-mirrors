// The usage page's script. It fills in the mirror addresses (site.json's domains, or worked out from this
// page's own address: docker.example.com → gcr.example.com and so on), the name, operator, brand and links
// from site.json, and switches the language and the theme, the runtime tabs, copies and converts image
// addresses. Without it the page still reads whole, with placeholders for the addresses.
// It only writes text and DOM nodes: the page enforces Trusted Types with no policy at all, so assigning
// markup throws straight away.

const root = document.documentElement;
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
let lang = root.lang.startsWith('zh') ? 'zh' : 'en';

const MESSAGES = {
  en: {
    copy: 'Copy',
    copied: 'Copied',
    list: ', ',
    yourDomain: 'your-domain',
    outUpstream: 'Registry',
    outMirror: 'Mirror',
    commands: 'Commands',
    tool: 'Tool',
    noteLatest: 'No tag given, so latest is used.',
    noteLibrary: 'Added library/ for an official Docker Hub image.',
    noteAlias: '{domain} is another name of {label}.',
    noteK8sGcr: 'k8s.gcr.io was frozen in 2023, so this uses registry.k8s.io. If the pull fails, that version was never moved; use a newer one.',
    noteDigestOnly: 'A digest has no tag, so choose one yourself when you tag the image.',
    noteMirrorInput: 'This is a mirror address already.',
    hubLink: 'See the tags on Docker Hub',
    quayLink: 'See the tags on quay.io',
    errUpper: 'Image names use lowercase letters, digits and . _ - / only. Check the case.',
    errBad: 'This is not an image reference. Try something like nginx:1.27 or ghcr.io/org/app:tag.',
    errTag: 'The tag may use letters, digits and . _ - only, up to 128 characters.',
    errDigest: 'The digest should look like sha256: followed by 64 hexadecimal digits.',
    errUnsupported: '{domain} is not mirrored here. This site mirrors {registries}.',
    errRegionalGcr: '{domain} is not mirrored here: only gcr.io is, not regional hosts such as us.gcr.io or *.pkg.dev.',
    'link.status': 'Status',
    'link.terms': 'Terms',
    'link.privacy': 'Privacy',
    'link.abuse': 'Report abuse',
    'link.source': 'Source code',
    'link.home': 'Home',
  },
  zh: {
    copy: '复制',
    copied: '已复制',
    list: '、',
    yourDomain: '你的域名',
    outUpstream: '原地址',
    outMirror: '加速地址',
    commands: '命令',
    tool: '工具',
    noteLatest: '没写标签，默认是 latest。',
    noteLibrary: 'Docker Hub 官方镜像已补上 library/。',
    noteAlias: '{domain} 是 {label} 的别名。',
    noteK8sGcr: 'k8s.gcr.io 已于 2023 年冻结，已改用 registry.k8s.io；如果拉不到，说明这个版本没有迁移过去，请换用新版本。',
    noteDigestOnly: '按 digest 拉取时没有标签，打标签时请自己指定一个。',
    noteMirrorInput: '输入的已经是加速地址。',
    hubLink: '在 Docker Hub 上查看可用的标签',
    quayLink: '在 quay.io 上查看可用的标签',
    errUpper: '镜像名只能用小写字母、数字和 . _ - /，请检查大小写。',
    errBad: '看不懂这个地址，请检查格式，例如 nginx:1.27 或 ghcr.io/org/app:tag。',
    errTag: '标签只能用字母、数字和 . _ -，最长 128 个字符。',
    errDigest: 'digest 应该是 sha256: 加 64 位十六进制数字。',
    errUnsupported: '本站不加速 {domain}。本站加速 {registries}。',
    errRegionalGcr: '本站不加速 {domain}：只加速 gcr.io，不含 us.gcr.io 等区域地址和 *.pkg.dev。',
    'link.status': '服务状态',
    'link.terms': '使用须知',
    'link.privacy': '隐私说明',
    'link.abuse': '举报',
    'link.source': '源代码',
    'link.home': '主页',
  },
};

// msg is one of the script's messages in the language in use, with {name} filled in.
function msg(key, vars = {}) {
  let s = MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// el creates an element: attributes (class, text, and the rest as attributes) and children.
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

// ---- The registries and their mirrors

const UPSTREAMS = [
  { key: 'docker', name: 'docker.io', label: 'Docker Hub', library: true,
    aliases: ['index.docker.io', 'registry-1.docker.io', 'registry.hub.docker.com', 'hub.docker.com'] },
  { key: 'gcr', name: 'gcr.io', label: 'gcr.io' },
  { key: 'ghcr', name: 'ghcr.io', label: 'ghcr.io' },
  { key: 'k8s', name: 'registry.k8s.io', label: 'registry.k8s.io' },
  { key: 'quay', name: 'quay.io', label: 'quay.io' },
];
const KEYS = UPSTREAMS.map((u) => u.key);

let site = {}; // site.json
let domains = {}; // key → host, missing when it is not known
let current = null; // the key of the mirror this page is on

// computeDomains: site.json's domains first, otherwise the page's own address with each key in front
// (docker.example.com → gcr.example.com). An IP address, localhost or a two-label host gives no base.
function computeDomains() {
  const host = location.hostname.toLowerCase();
  const labels = host.split('.');
  const isIP = /^[\d.]+$/.test(host) || host.includes(':');
  const base = !isIP && labels.length >= 3 ? labels.slice(1).join('.') : null;
  domains = {};
  const given = site.domains && typeof site.domains === 'object' ? site.domains : {};
  for (const k of KEYS) {
    const v = typeof given[k] === 'string' ? given[k].trim().toLowerCase() : '';
    if (v) domains[k] = v;
    else if (base) domains[k] = `${k}.${base}`;
  }
  current = KEYS.find((k) => domains[k] === host) || null;
}

// mirrorOf is where an upstream is pulled from, or a placeholder in the language in use.
const mirrorOf = (u) => domains[u.key] || `${u.key}.<${msg('yourDomain')}>`;

// The placeholders in the page, kept so that they can come back if site.json takes a domain away.
const placeholders = new Map();
for (const s of $$('[data-d]')) placeholders.set(s, [...s.childNodes].map((n) => n.cloneNode(true)));

function renderDomains() {
  computeDomains();
  for (const [s, nodes] of placeholders) {
    const d = domains[s.dataset.d];
    if (d) s.textContent = d;
    else s.replaceChildren(...nodes.map((n) => n.cloneNode(true)));
  }
  const missing = KEYS.some((k) => !domains[k]);
  for (const e of $$('[data-if="placeholder"]')) e.hidden = !missing;
  for (const card of $$('.ol-card[data-key]')) {
    const on = card.dataset.key === current;
    card.toggleAttribute('data-current', on);
    const badge = $('[data-this-site]', card);
    if (badge) badge.hidden = !on;
  }
}

// ---- What site.json says about the site: name, operator, brand and links

const MARKS = /^[a-z0-9-]+$/;

function renderSite() {
  const name = typeof site.name === 'string' && site.name.trim() ? site.name.trim() : 'LinkOS Mirrors';
  document.title = name;
  for (const e of $$('[data-name]')) e.textContent = name;

  const op = typeof site.operator === 'string' ? site.operator.trim() : '';
  for (const e of $$('[data-operator]')) e.textContent = op;
  for (const e of $$('[data-if="operator"]')) e.hidden = !op;

  // brand: an OpenLinkOS or LinkOS brand id; "" or "none" for the neutral look; absent keeps linkos-mirrors.
  if (typeof site.brand === 'string') {
    const id = site.brand.trim();
    const neutral = id === '' || id === 'none' || !MARKS.test(id);
    if (neutral) delete document.body.dataset.brand;
    else document.body.dataset.brand = id;
    for (const e of $$('[data-mark]')) {
      const src = `/assets/brands/${neutral ? 'neutral' : id}/${e.dataset.mark}`;
      e.setAttribute(e.tagName === 'LINK' ? 'href' : 'src', src);
    }
  }

  const links = site.links && typeof site.links === 'object' ? site.links : {};
  const url = (k) => (typeof links[k] === 'string' && /^https?:\/\//.test(links[k]) ? links[k] : '');
  for (const k of ['status', 'privacy']) {
    for (const e of $$(`[data-link="${k}"]`)) {
      if (url(k)) e.setAttribute('href', url(k));
      else e.removeAttribute('href');
    }
    for (const e of $$(`[data-if="${k}"]`)) e.hidden = !url(k);
    for (const e of $$(`[data-link-host="${k}"]`)) e.textContent = url(k) ? new URL(url(k)).host : '';
  }
  const nav = $('#footer-links');
  if (nav) {
    const items = ['status', 'terms', 'privacy', 'abuse', 'source', 'home'].filter(url)
      .map((k) => el('a', { href: url(k), rel: 'noopener', text: msg(`link.${k}`) }));
    nav.replaceChildren(...items);
    nav.hidden = items.length === 0;
  }
}

// ---- Copying

function writeClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = el('textarea', { class: 'ol-sr-only', readonly: true });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand('copy') ? resolve() : reject(new Error('copy'));
    } catch (err) {
      reject(err);
    } finally {
      ta.remove();
    }
  });
}

function wireCopy(button) {
  let timer;
  button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.copy || '');
    if (!target) return;
    writeClipboard((target.innerText || target.textContent || '').trim()).then(() => {
      const label = button.getAttribute('aria-label') || '';
      if (!button.dataset.label) button.dataset.label = label;
      $('[data-copy-icon]', button).hidden = true;
      $('[data-copied-icon]', button).hidden = false;
      button.setAttribute('aria-label', msg('copied'));
      clearTimeout(timer);
      timer = setTimeout(() => {
        $('[data-copy-icon]', button).hidden = false;
        $('[data-copied-icon]', button).hidden = true;
        button.setAttribute('aria-label', button.dataset.label);
        delete button.dataset.label;
      }, 1500);
    }, () => {});
  });
}

function copyButton(id) {
  const b = $('#tpl-copy').content.firstElementChild.cloneNode(true);
  b.dataset.copy = id;
  swapAttrs(b);
  wireCopy(b);
  return b;
}

for (const b of $$('button[data-copy]')) if (b.dataset.copy) wireCopy(b);

// ---- Language

// swapAttrs puts the Chinese or English text into the attributes that have both.
function swapAttrs(e) {
  for (const a of ['aria-label', 'placeholder', 'title']) {
    const zh = e.getAttribute(`data-zh-${a}`);
    if (zh === null) continue;
    if (!e.hasAttribute(`data-en-${a}`)) e.setAttribute(`data-en-${a}`, e.getAttribute(a) || '');
    e.setAttribute(a, lang === 'zh' ? zh : e.getAttribute(`data-en-${a}`));
  }
}

function setLang(l, save) {
  lang = l;
  root.lang = l === 'zh' ? 'zh-CN' : 'en';
  for (const e of $$('[data-zh-aria-label], [data-zh-placeholder], [data-zh-title]')) swapAttrs(e);
  for (const a of $$('#lang-menu [data-lang]')) {
    if (a.dataset.lang === l) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
  if (save) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `relay-lang=${l}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    const q = new URLSearchParams(location.search);
    if (q.has('lang')) {
      q.delete('lang');
      const s = q.toString();
      history.replaceState(null, '', location.pathname + (s ? `?${s}` : '') + location.hash);
    }
  }
  renderSite();
  renderConvert();
}

for (const a of $$('#lang-menu [data-lang]')) {
  a.addEventListener('click', (ev) => {
    ev.preventDefault();
    setLang(a.dataset.lang === 'zh' ? 'zh' : 'en', true);
    $('#lang-menu').hidePopover?.();
  });
}

// ---- Theme: auto, light or dark, kept in this browser

function setTheme(t, save) {
  if (t === 'light' || t === 'dark') root.dataset.theme = t;
  else delete root.dataset.theme;
  for (const b of $$('button[data-set-theme]')) b.setAttribute('aria-pressed', String(b.dataset.setTheme === t));
  if (save) {
    try {
      localStorage.setItem('relay-theme', t);
    } catch {
      // storage blocked
    }
  }
}

for (const b of $$('button[data-set-theme]')) b.addEventListener('click', () => setTheme(b.dataset.setTheme, true));
setTheme(root.dataset.theme || 'auto', false);

// ---- Tabs: the ARIA tabs pattern, with the arrow keys

const tablist = $('[role="tablist"]');
if (tablist) {
  const tabs = $$('[role="tab"]', tablist);
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    }
    if (focus) tab.focus();
  };
  for (const t of tabs) {
    t.addEventListener('click', () => select(t, false));
    t.addEventListener('keydown', (ev) => {
      const i = tabs.indexOf(t);
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[ev.key];
      if (to === undefined) return;
      ev.preventDefault();
      select(tabs[(to + tabs.length) % tabs.length], true);
    });
  }
  select(tabs.find((t) => t.getAttribute('aria-selected') === 'true') || tabs[0], false);
}

// ---- Section links follow the reader

const navLinks = $$('.ol-site-nav a[href^="#"]');
if ('IntersectionObserver' in window && navLinks.length) {
  const seen = new Map();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const first = navLinks.find((a) => !a.hidden && seen.get(a.hash.slice(1)));
      for (const a of navLinks) {
        if (a === first) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
      }
    },
    { rootMargin: '-30% 0px -60% 0px' },
  );
  for (const a of navLinks) {
    const s = document.getElementById(a.hash.slice(1));
    if (s) io.observe(s);
  }
}

// ---- Converting an image address (the rules of distribution/reference)

const EXAMPLES = ['nginx', 'nginx:1.27', 'bitnami/redis:7', 'ghcr.io/containerd/busybox:1.36', 'quay.io/coreos/etcd:v3.5.0',
  'registry.k8s.io/pause:3.10', 'gcr.io/distroless/static:nonroot', 'k8s.gcr.io/pause:3.2'];
const findUp = (name) => UPSTREAMS.find((u) => u.name === name) || null;
const registryList = () => UPSTREAMS.map((u) => u.label).join(msg('list'));

function parseRef(raw) {
  let s = raw.trim();
  if (!s) return { empty: true };
  if (/\s/.test(s)) {
    const parts = s.split(/\s+/); // a whole docker pull command pasted in
    s = parts[parts.length - 1];
  }
  s = s.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
  const notes = [];
  let digest = '';
  const at = s.indexOf('@');
  if (at >= 0) {
    digest = s.slice(at + 1);
    s = s.slice(0, at);
    if (!/^[a-z0-9]+(?:[.+_-][a-z0-9]+)*:[a-fA-F0-9]{32,}$/.test(digest)) return { error: msg('errDigest') };
  }
  let tag = '';
  const slash = s.lastIndexOf('/');
  const colon = s.lastIndexOf(':');
  if (colon > slash) {
    tag = s.slice(colon + 1);
    s = s.slice(0, colon);
    if (!/^[\w][\w.-]{0,127}$/.test(tag)) return { error: msg('errTag') };
  }
  let domain = 'docker.io';
  let path = s;
  const first = s.split('/')[0];
  if (s.includes('/') && (first.includes('.') || first.includes(':') || first === 'localhost')) {
    domain = first.toLowerCase();
    path = s.slice(first.length + 1);
  }
  let up = UPSTREAMS.find((u) => domains[u.key] && domains[u.key] === domain) || null;
  if (up) notes.push(msg('noteMirrorInput'));
  if (!up) {
    up = findUp(domain);
    if (!up) {
      up = UPSTREAMS.find((u) => (u.aliases || []).includes(domain)) || null;
      if (up) notes.push(msg('noteAlias', { domain, label: up.label }));
    }
    if (!up && domain === 'k8s.gcr.io') {
      up = findUp('registry.k8s.io');
      notes.push(msg('noteK8sGcr'));
    }
    if (!up && (/^[a-z]+\.gcr\.io$/.test(domain) || /\.pkg\.dev$/.test(domain))) {
      return { error: msg('errRegionalGcr', { domain }) };
    }
    if (!up) return { error: msg('errUnsupported', { domain, registries: registryList() }) };
  }
  if (!path) return { error: msg('errBad') };
  if (/[A-Z]/.test(path)) return { error: msg('errUpper') };
  if (!/^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/.test(path)) return { error: msg('errBad') };
  if (up.library && !path.includes('/')) {
    path = `library/${path}`;
    notes.push(msg('noteLibrary'));
  }
  if (!tag && !digest) notes.push(msg('noteLatest'));
  return { up, path, tag, digest, notes };
}

const input = $('#convert-input');
const result = $('#convert-result');
let tool = 'docker';

function renderConvert() {
  if (!input || !result) return;
  const r = parseRef(input.value);
  if (r.empty) {
    result.replaceChildren();
    return;
  }
  if (r.error) {
    result.replaceChildren(el('div', { class: 'ol-alert ol-alert-warning', role: 'status' }, el('div', { class: 'ol-alert-body' }, el('p', { text: r.error }))));
    return;
  }
  const u = r.up;
  const suffix = (r.tag ? `:${r.tag}` : '') + (r.digest ? `@${r.digest}` : '');
  const mirror = `${mirrorOf(u)}/${r.path}${suffix}`;
  const original = `${u.name}/${r.path}${suffix}`;
  const short = u.library && r.path.startsWith('library/') ? r.path.slice(8) : u.name === 'docker.io' ? r.path : `${u.name}/${r.path}`;
  const local = tool === 'podman' ? `${u.name}/${r.path}` : short;
  const lines = [`${tool} pull ${mirror}`];
  if (!r.digest || r.tag) {
    lines.push(`${tool} tag ${mirror} ${local}:${r.tag || 'latest'}`);
    lines.push(`${tool} rmi ${mirror}`);
  }

  const grid = el('dl', { class: 'site-result-grid' },
    el('dt', { text: msg('outUpstream') }), el('dd', { class: 'ol-mono' }, original),
    el('dt', { text: msg('outMirror') }), el('dd', {}, el('span', { class: 'ol-mono', id: 'convert-mirror' }, mirror), copyButton('convert-mirror')));
  const notes = r.notes.map((n) => el('p', { class: 'ol-hint', text: n }));
  if (r.digest && !r.tag) notes.push(el('p', { class: 'ol-hint', text: msg('noteDigestOnly') }));

  const tools = el('fieldset', { class: 'ol-segmented' }, el('legend', { class: 'ol-sr-only', text: msg('tool') }));
  for (const x of ['docker', 'nerdctl', 'podman']) {
    const b = el('button', { type: 'button', 'aria-pressed': String(x === tool) }, el('span', { text: x }));
    b.addEventListener('click', () => {
      tool = x;
      renderConvert();
    });
    tools.append(b);
  }
  const codeBox = el('div', { class: 'ol-code' },
    el('div', { class: 'ol-code-label' }, msg('commands')),
    el('pre', {}, el('code', { id: 'convert-commands', text: lines.join('\n') })),
    copyButton('convert-commands'));

  let link = null;
  if (u.name === 'docker.io') {
    const name = r.path.startsWith('library/') ? `_/${r.path.slice(8)}` : `r/${r.path}`;
    link = el('a', { href: `https://hub.docker.com/${name}/tags`, target: '_blank', rel: 'noopener noreferrer', text: msg('hubLink') });
  } else if (u.name === 'quay.io') {
    link = el('a', { href: `https://quay.io/repository/${r.path}?tab=tags`, target: '_blank', rel: 'noopener noreferrer', text: msg('quayLink') });
  }
  result.replaceChildren(el('div', { class: 'ol-stack' }, grid, ...notes, tools, codeBox, link ? el('p', { class: 'ol-text-sm' }, link) : null));
}

if (input) {
  input.addEventListener('input', renderConvert);
  $('#convert-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    renderConvert();
  });
  const box = $('#convert-examples');
  for (const ex of EXAMPLES) {
    const b = el('button', { type: 'button', class: 'ol-chip ol-chip-mono' }, el('span', { class: 'ol-chip-label', text: ex }));
    b.addEventListener('click', () => {
      input.value = ex;
      renderConvert();
      input.focus();
    });
    box.append(b);
  }
  const pre = new URLSearchParams(location.search).get('image');
  if (pre) input.value = pre;
}

// ---- Start: the addresses from this page's own address, then from site.json when it arrives

function render() {
  renderDomains();
  setLang(lang, false);
}

render();
fetch('/site.json', { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : null))
  .then((j) => {
    if (j && typeof j === 'object') {
      site = j;
      render();
    }
  })
  .catch(() => {
    // site.json is optional
  });
