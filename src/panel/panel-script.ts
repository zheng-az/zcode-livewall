/**
 * The injected settings panel: a floating, draggable control surface inside the
 * ZCode renderer for switching Wallpaper Engine projects, tuning blur/dim,
 * playback speed and pause behaviour, and toggling Monet colors.
 *
 * The script always rebuilds the panel, so a stale copy in the DOM can never
 * shadow a newer version, and it is safe to re-evaluate on every injection.
 */

export const PANEL_ROOT_ID = "zcode-livewall-panel-root";

export function buildPanelScript(apiPort: number, token: string): string {
  const api = `http://127.0.0.1:${apiPort}`;
  return `(function boot(){
  var API = ${JSON.stringify(api)};
  var TOKEN = ${JSON.stringify(token)};
  var ROOT_ID = ${JSON.stringify(PANEL_ROOT_ID)};

  // Page.addScriptToEvaluateOnNewDocument runs before the document has a root
  // element, so appending here would throw and the panel would never install.
  if (!document.documentElement) { setTimeout(boot, 30); return; }

  var stale = document.getElementById(ROOT_ID);
  if (stale) stale.remove();
  var staleStyle = document.getElementById('zcode-livewall-panel-style');
  if (staleStyle) staleStyle.remove();

  var css = [
    '#zcode-livewall-panel-root, #zcode-livewall-panel-root * { box-sizing: border-box; font-family: system-ui, sans-serif; }',
    '#zcode-livewall-panel-root { position: fixed; inset: auto; z-index: 2147483647; font-size: 12px; color: #ececf1;',
      ' text-shadow: 0 1px 2px rgba(0,0,0,.35); }',
    // Floating action button: a small glass disc.
    '#zlw-fab { position: fixed; right: 60px; bottom: 18px; width: 34px; height: 34px; border-radius: 50%;',
      ' background: linear-gradient(135deg, rgba(58,62,88,.55), rgba(28,30,42,.62)); border: 1px solid rgba(255,255,255,.18); cursor: pointer;',
      ' display: flex; align-items: center; justify-content: center;',
      ' backdrop-filter: blur(20px) saturate(1.45); -webkit-backdrop-filter: blur(20px) saturate(1.45);',
      ' box-shadow: 0 2px 16px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.22);',
      ' user-select: none; font-size: 15px; line-height: 1; transition: box-shadow .2s ease, transform .15s ease; }',
    '#zlw-fab:hover { box-shadow: 0 4px 22px rgba(122,162,247,.38), inset 0 1px 0 rgba(255,255,255,.26); transform: translateY(-1px); }',
    '#zlw-fab:active { transform: translateY(0); }',
    // The panel itself: a frosted pane with a light-catching rim and a slow
    // sheen drifting across, matching the wallpaper stage's frost layer.
    '#zlw-panel { position: fixed; right: 18px; bottom: 60px; width: 286px; padding: 0 0 10px;',
      ' background: linear-gradient(150deg, rgba(34,37,54,.55) 0%, rgba(22,23,33,.66) 55%, rgba(26,24,38,.6) 100%);',
      ' border: 1px solid rgba(255,255,255,.16); border-radius: 16px;',
      ' backdrop-filter: blur(28px) saturate(1.5); -webkit-backdrop-filter: blur(28px) saturate(1.5);',
      ' box-shadow: 0 12px 40px rgba(0,0,0,.5), 0 2px 10px rgba(0,0,0,.3), inset 0 1px 0 rgba(255,255,255,.18), inset 0 -1px 0 rgba(255,255,255,.04);',
      ' user-select: none; overflow: hidden; }',
    '#zlw-panel::before { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;',
      ' background: linear-gradient(115deg, transparent 38%, rgba(255,255,255,.07) 50%, transparent 62%);',
      ' animation: zlw-sheen 12s linear infinite; }',
    '@keyframes zlw-sheen { from { transform: translateX(-70%); } to { transform: translateX(70%); } }',
    '#zlw-panel[hidden] { display: none; }',
    '#zlw-head { padding: 10px 12px; font-weight: 600; cursor: move;',
      ' border-bottom: 1px solid rgba(255,255,255,.12); background: linear-gradient(180deg, rgba(255,255,255,.06), transparent);',
      ' display: flex; justify-content: space-between; align-items: center; }',
    '#zlw-close { cursor: pointer; opacity: .7; padding: 0 4px; transition: opacity .15s; } #zlw-close:hover { opacity: 1; }',
    '#zlw-body { padding: 10px 12px 0; max-height: 62vh; overflow-y: auto; }',
    // Thin translucent scrollbars so the glass look is not broken by chunky bars.
    '#zlw-body::-webkit-scrollbar, #zlw-projects::-webkit-scrollbar { width: 8px; }',
    '#zlw-body::-webkit-scrollbar-thumb, #zlw-projects::-webkit-scrollbar-thumb {',
      ' background: rgba(255,255,255,.16); border-radius: 4px; }',
    '#zlw-body::-webkit-scrollbar-thumb:hover, #zlw-projects::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.26); }',
    '#zlw-body::-webkit-scrollbar-track, #zlw-projects::-webkit-scrollbar-track { background: transparent; }',
    '.zlw-row { margin-bottom: 10px; }',
    '.zlw-row label { display: flex; justify-content: space-between; margin-bottom: 4px; opacity: .9; }',
    '.zlw-search { width: 100%; margin-bottom: 5px; padding: 6px 9px; border-radius: 9px; color: inherit; font-size: 12px; outline: none;',
      ' border: 1px solid rgba(255,255,255,.14); background: rgba(8,10,18,.35);',
      ' backdrop-filter: blur(8px); box-shadow: inset 0 1px 3px rgba(0,0,0,.25); transition: border-color .15s, box-shadow .15s; }',
    '.zlw-search:focus { border-color: rgba(122,162,247,.55); box-shadow: inset 0 1px 3px rgba(0,0,0,.25), 0 0 0 3px rgba(122,162,247,.15); }',
    '.zlw-search::placeholder { color: rgba(232,232,234,.4); }',
    '#zlw-panel input[type=range] { width: 100%; accent-color: #7aa2f7; height: 18px; margin: 0; cursor: pointer; }',
    '.zlw-toggles { display: flex; justify-content: center; gap: 14px; flex-wrap: wrap; }',
    '.zlw-toggles label { display: flex; align-items: center; gap: 5px; margin: 0; cursor: pointer; }',
    '.zlw-toggles input[type=checkbox] { accent-color: #7aa2f7; }',
    '.zlw-actions { display: flex; justify-content: center; gap: 8px; }',
    // Buttons: glass pills with a lit rim; hover adds a soft accent glow.
    '.zlw-btn { display: inline-block; padding: 6px 14px; text-align: center; border-radius: 999px; cursor: pointer;',
      ' background: linear-gradient(135deg, rgba(255,255,255,.13), rgba(255,255,255,.05));',
      ' border: 1px solid rgba(255,255,255,.16); color: inherit; font-size: 12px;',
      ' backdrop-filter: blur(8px); box-shadow: inset 0 1px 0 rgba(255,255,255,.14);',
      ' transition: background .15s ease, box-shadow .15s ease; }',
    '.zlw-btn:hover { background: linear-gradient(135deg, rgba(255,255,255,.22), rgba(255,255,255,.1));',
      ' box-shadow: inset 0 1px 0 rgba(255,255,255,.2), 0 2px 14px rgba(122,162,247,.28); }',
    '.zlw-btn:active { box-shadow: inset 0 2px 5px rgba(0,0,0,.25); }',
    // Project list: a glass drawer inside the pane.
    '#zlw-projects { width: 100%; max-height: 260px; overflow-y: auto; border-radius: 10px;',
      ' border: 1px solid rgba(255,255,255,.12); background: rgba(8,10,18,.32);',
      ' backdrop-filter: blur(6px); box-shadow: inset 0 1px 4px rgba(0,0,0,.2); }',
    '.zlw-proj { padding: 6px 8px; cursor: pointer; display: flex; justify-content: space-between; gap: 6px;',
      ' border-bottom: 1px solid rgba(255,255,255,.05); transition: background .12s ease; }',
    '.zlw-proj:last-child { border-bottom: 0; }',
    '.zlw-proj:hover { background: rgba(255,255,255,.08); }',
    '.zlw-proj[data-active="1"] { background: linear-gradient(135deg, rgba(122,162,247,.30), rgba(122,162,247,.12));',
      ' box-shadow: inset 2px 0 0 rgba(122,162,247,.8); }',
    '.zlw-proj[data-busy="1"] { opacity: .65; cursor: progress; }',
    '.zlw-proj .zlw-meta { opacity: .55; font-size: 10px; white-space: nowrap; }',
    '#zlw-status { min-height: 14px; padding: 2px 12px 0; opacity: .65; font-size: 11px; }',
    '#zlw-offline { display: flex; flex-direction: column; gap: 6px; align-items: center;',
      ' padding: 10px 12px; background: rgba(120,53,15,.42); font-size: 11px; line-height: 1.5; text-align: center;',
      ' border-bottom: 1px solid rgba(251,191,36,.2); backdrop-filter: blur(8px); }',
    '#zlw-offline[hidden] { display: none; }',
    '#zlw-offline code { background: rgba(0,0,0,.35); padding: 1px 4px; border-radius: 4px; font-size: 10px; user-select: text; }',
    '#zcode-livewall-panel-root[data-offline="1"] #zlw-body { opacity: .45; pointer-events: none; }',
    '#zcode-livewall-panel-root[data-offline="1"] #zlw-status { display: none; }',
    '#zcode-livewall-panel-root[data-offline="1"] #zlw-fab { border-color: rgba(248,113,113,.7); }',
    '@media (prefers-reduced-motion: reduce) { #zlw-panel::before { animation: none; } }',
    // Crystal gem mark: line-drawn facets over the glass disc.
    '#zlw-fab svg { width: 18px; height: 18px; display: block;',
      ' filter: drop-shadow(0 0 4px rgba(140,175,255,.5)) drop-shadow(0 0 10px rgba(180,140,255,.25)); }'
  ].join('');

  var style = document.createElement('style');
  style.id = 'zcode-livewall-panel-style';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  var root = document.createElement('div');
  root.id = ROOT_ID;
  // The mark is a line-drawn faceted crystal: an icy-blue-to-violet gradient
  // stroke keeps it crystalline against the dark glass disc.
  root.innerHTML =
    '<div id="zlw-fab" title="ZCode LiveWall">' +
    '  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '    <defs>' +
    '      <linearGradient id="zlw-gem-g" x1="4" y1="4" x2="20" y2="21" gradientUnits="userSpaceOnUse">' +
    '        <stop offset="0" stop-color="#a8d4ff"/>' +
    '        <stop offset=".5" stop-color="#8fa8ff"/>' +
    '        <stop offset="1" stop-color="#c48cff"/>' +
    '      </linearGradient>' +
    '    </defs>' +
    '    <g stroke="url(#zlw-gem-g)" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">' +
    '      <path d="M4.2 9.3 8.6 4.8h6.8l4.4 4.5L12 20.6 4.2 9.3Z"/>' +
    '      <path d="M4.2 9.3h15.6"/>' +
    '      <path d="M8.6 4.8l2.2 4.5L12 20.6"/>' +
    '      <path d="M15.4 4.8l-2.2 4.5L12 20.6"/>' +
    '      <path d="M8.6 4.8 12 9.3l3.4-4.5"/>' +
    '    </g>' +
    '  </svg>' +
    '</div>' +
    '<div id="zlw-panel" hidden>' +
    '  <div id="zlw-head"><span>ZCode LiveWall</span><span id="zlw-close">✕</span></div>' +
    '  <div id="zlw-offline" hidden>' +
    '    <div>⚠ 动态壁纸服务未运行,面板不可用</div>' +
    '    <div>在插件目录执行 <code>node dist/cli.js serve --detach</code> 启动</div>' +
    '    <button class="zlw-btn" id="zlw-retry">重试连接</button>' +
    '  </div>' +
    '  <div id="zlw-body">' +
    '    <div class="zlw-row"><label><span>壁纸库</span><span id="zlw-count"></span></label>' +
    '      <input type="search" id="zlw-search" class="zlw-search" placeholder="搜索标题 / 类型…">' +
    '      <div id="zlw-projects"></div></div>' +
    '    <div class="zlw-row"><label title="背景模糊程度(像素)"><span>背景模糊</span><span><span id="zlw-blur-val">0</span>px</span></label>' +
    '      <input type="range" id="zlw-blur" min="0" max="40" step="1" value="0"></div>' +
    '    <div class="zlw-row"><label title="背景压暗程度(百分比,越高越暗)"><span>背景压暗</span><span><span id="zlw-dim-val">0</span>%</span></label>' +
    '      <input type="range" id="zlw-dim" min="0" max="85" step="1" value="0"></div>' +
    '    <div class="zlw-row"><label title="播放速度"><span>播放速度</span><span><span id="zlw-speed-val">1</span>×</span></label>' +
    '      <input type="range" id="zlw-speed" min="0.25" max="2" step="0.05" value="1"></div>' +
    '    <div class="zlw-row zlw-toggles">' +
    '      <label title="根据视频抽帧自动生成 UI 配色"><input type="checkbox" id="zlw-monet">UI 莫奈取色</label>' +
    '      <label title="显示或隐藏动态背景"><input type="checkbox" id="zlw-vis">显示壁纸</label>' +
    '      <label title="窗口失焦或最小化时暂停播放"><input type="checkbox" id="zlw-pause-blur">失焦暂停</label>' +
    '      <label title="4K/60fps 视频会占满 CPU，开启后会转码出与屏幕匹配的 30fps 缓存，下次切换自动改用"><input type="checkbox" id="zlw-optimize">性能优化</label>' +
    '    </div>' +
    '    <div class="zlw-row zlw-actions">' +
    '      <button class="zlw-btn" id="zlw-pause" title="暂停或继续播放">暂停</button>' +
    '      <button class="zlw-btn" id="zlw-fit" title="填满裁剪 / 完整显示(模糊垫底)">填充: …</button>' +
    '    </div>' +
    '    <div class="zlw-row zlw-actions">' +
    '      <label class="zlw-btn" for="zlw-file-video" title="选择一个本地视频文件作为动态壁纸">视频…</label>' +
    '      <label class="zlw-btn" for="zlw-file-image" title="选择一张本地图片作为静态壁纸">图片…</label>' +
    '      <input type="file" id="zlw-file-video" accept="video/*" hidden>' +
    '      <input type="file" id="zlw-file-image" accept="image/*" hidden>' +
    '    </div>' +
    '    <div class="zlw-row zlw-actions">' +
    '      <button class="zlw-btn" id="zlw-reset" title="移除动态壁纸,还原 ZCode 默认外观">还原默认外观</button>' +
    '    </div>' +
    '  </div>' +
    '</div>' +
    '<div id="zlw-status"></div>';
  // The body may still be missing when this runs as a new-document script.
  if (!document.body) { setTimeout(boot, 30); return; }
  document.body.appendChild(root);

  function $(id) { return document.getElementById(id); }
  function stageEl() { return document.getElementById('zcode-livewall-stage'); }
  function videoEl() { return document.getElementById('zcode-livewall-video'); }
  function status(msg) {
    var el = $('zlw-status'); if (!el) return;
    el.textContent = msg;
    setTimeout(function () { if (el.textContent === msg) el.textContent = ''; }, 2400);
  }
  function auth(extra) {
    var h = extra || {};
    h['x-zlw-token'] = TOKEN;
    return h;
  }
  function post(path, body, cb) {
    fetch(API + path, { method: 'POST', headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.error) { status('操作失败: ' + d.error); return; }
        if (cb) cb(d);
      })
      .catch(function () { status('无法连接动态壁纸服务'); });
  }

  var FIT_LABELS = { cover: '填满裁剪', contain: '完整显示' };
  var FIT_ORDER = ['contain', 'cover'];
  function applyFitLabel(btn, fit) {
    btn.textContent = '填充: ' + (FIT_LABELS[fit] || fit);
    btn.setAttribute('data-fit', fit);
  }

  var projectsLoaded = false;
  var allProjects = [];
  var activeTitle = null;

  /** Renders the cached list, filtered by the search box. */
  function renderProjects() {
    var box = $('zlw-projects');
    var q = ($('zlw-search') && $('zlw-search').value || '').trim().toLowerCase();
    var list = q
      ? allProjects.filter(function (p) {
          return (p.title || '').toLowerCase().indexOf(q) >= 0 ||
                 (p.type || '').toLowerCase().indexOf(q) >= 0 ||
                 String(p.id).indexOf(q) >= 0;
        })
      : allProjects;

    box.innerHTML = '';
    $('zlw-count').textContent = q ? list.length + ' / ' + allProjects.length : allProjects.length + ' 个';
    if (list.length === 0) {
      box.innerHTML = '<div class="zlw-proj" style="cursor:default;opacity:.6">没有匹配的壁纸</div>';
      return;
    }
    list.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'zlw-proj';
      row.setAttribute('data-id', p.id);
      if (activeTitle && p.title === activeTitle) row.setAttribute('data-active', '1');
      row.innerHTML = '<span></span><span class="zlw-meta"></span>';
      row.firstChild.textContent = p.title;
      row.lastChild.textContent = (p.type || '') + (p.source === 'workshop' ? ' · 工坊' : '') +
        (/preview\./i.test(p.media || '') ? ' · 低清预览' : '');
      row.addEventListener('click', function () {
        // Give the click immediate feedback: the request can take a moment
        // on a cold video, and a row that looks inert reads as a dead click.
        var prev = box.querySelector('.zlw-proj[data-active="1"]');
        if (prev) prev.removeAttribute('data-active');
        row.setAttribute('data-active', '1');
        row.setAttribute('data-busy', '1');
        status('正在切换到 ' + p.title + '…');
        post('/api/source', { project: p.id }, function (res) {
          row.removeAttribute('data-busy');
          if (res && res.error) { status('切换失败: ' + res.error); return; }
          activeTitle = p.title;
          status('已切换到 ' + p.title);
          refresh();
        });
      });
      box.appendChild(row);
    });
  }

  function loadProjects(activeName) {
    if (activeName) activeTitle = activeName;
    fetch(API + '/api/projects', { headers: auth() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        allProjects = (d && d.projects) || [];
        if (allProjects.length === 0) {
          $('zlw-projects').innerHTML = '<div class="zlw-proj" style="cursor:default;opacity:.6">未找到 Wallpaper Engine 壁纸</div>';
          return;
        }
        renderProjects();
        projectsLoaded = true;
      })
      .catch(function () { setOffline(true); });
  }

  $('zlw-search').addEventListener('input', function () {
    if (projectsLoaded) renderProjects();
  });

  function setOffline(on) {
    root.setAttribute('data-offline', on ? '1' : '0');
    $('zlw-offline').hidden = !on;
    $('zlw-fab').title = on ? 'ZCode LiveWall — 服务未运行' : 'ZCode LiveWall';
    if (on) {
      $('zlw-blur').value = 0; $('zlw-blur-val').textContent = '0';
      $('zlw-dim').value = 0; $('zlw-dim-val').textContent = '0';
      $('zlw-monet').checked = false;
      $('zlw-vis').checked = false;
    }
  }

  function refresh() {
    fetch(API + '/api/config', { headers: auth() })
      .then(function (r) { return r.json(); })
      .then(function (c) {
        setOffline(false);
        $('zlw-blur').value = c.blur; $('zlw-blur-val').textContent = c.blur;
        $('zlw-dim').value = c.dim; $('zlw-dim-val').textContent = c.dim;
        $('zlw-speed').value = c.speed; $('zlw-speed-val').textContent = Number(c.speed).toFixed(2).replace(/0+$/,'').replace(/\\.$/,'');
        $('zlw-monet').checked = !!c.monet;
        $('zlw-vis').checked = !!c.wallpaperVisible;
        $('zlw-pause-blur').checked = !!c.pauseOnBlur;
        $('zlw-optimize').checked = !!c.optimize;
        applyFitLabel($('zlw-fit'), c.fit || 'cover');
        $('zlw-pause').textContent = c.paused ? '继续' : '暂停';
        if (c.sourceName) activeTitle = c.sourceName;
        // A source far smaller than the window looks soft no matter the mode;
        // the injected layer reports its upscale factor here. With 低清保护 on
        // the layer has already re-framed it (dataset.eff), so say so.
        var stageEl = document.getElementById('zcode-livewall-stage');
        var up = stageEl && stageEl.dataset.upscale;
        if (up && stageEl.dataset.eff === 'contain') status('提示: 分辨率偏低(放大 ' + up + '×)，已自动改为完整显示；换高清素材会更清晰');
        else if (up) status('提示: 这张壁纸分辨率偏低(放大 ' + up + '×), 换更高清的素材会更清晰');
        if (!projectsLoaded) loadProjects(c.sourceName);
        // Keep the highlight in sync with the server's idea of the source; a
        // busy row is left alone so the click feedback survives the refresh.
        var active = document.querySelectorAll('.zlw-proj');
        for (var i = 0; i < active.length; i++) {
          var row = active[i];
          if (row.getAttribute('data-busy') === '1') continue;
          var label = row.firstChild && row.firstChild.textContent;
          if (activeTitle && label === activeTitle) row.setAttribute('data-active', '1');
          else row.removeAttribute('data-active');
        }
      })
      .catch(function () { setOffline(true); });
  }

  var pushTimer = null;
  function pushConfig(patch) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      post('/api/config', patch, function (d) { status(d && d.windows > 0 ? '已应用' : '已保存(ZCode 未连接)'); });
    }, 250);
  }

  $('zlw-blur').addEventListener('input', function () {
    $('zlw-blur-val').textContent = this.value;
    var px = Number(this.value);
    var filter = px > 0 ? 'blur(' + px + 'px)' : 'none';
    // Match the injected CSS: contain mode keeps scale 1 so the letterbox
    // bars stay visible; growing the layer would crop them away.
    var stage = stageEl();
    var inContain = stage && stage.dataset.fit === 'contain';
    var scale = px > 0 && !inContain ? 'scale(1.04)' : 'none';
    // video: animated wallpapers; poster: still images and GIFs; web: iframe
    // pages — all three carry the blur or the slider looks dead on that type.
    ['zcode-livewall-video', 'zcode-livewall-poster', 'zcode-livewall-web'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.style.filter = filter;
      el.style.transform = scale;
    });
    // The blurred backdrop (letterbox fill) tracks the same value; matches
    // the stylesheet formula blur+12 so preview and injected CSS agree.
    var bd = document.getElementById('zcode-livewall-backdrop');
    if (bd) bd.style.filter = 'blur(' + (px + 12) + 'px) saturate(1.1) brightness(.55)';
    pushConfig({ blur: px });
  });
  $('zlw-dim').addEventListener('input', function () {
    $('zlw-dim-val').textContent = this.value;
    document.documentElement.style.setProperty('--zcode-livewall-dim', String(Number(this.value) / 100));
    var d = document.getElementById('zcode-livewall-dim');
    if (d) d.style.background = 'rgb(0 0 0 / ' + (Number(this.value) / 100) + ')';
    pushConfig({ dim: Number(this.value) });
  });
  $('zlw-speed').addEventListener('input', function () {
    var val = Number(this.value);
    $('zlw-speed-val').textContent = String(Math.round(val * 100) / 100);
    var v = videoEl(); if (v) v.playbackRate = val;
    pushConfig({ speed: val });
  });
  $('zlw-monet').addEventListener('change', function () { pushConfig({ monet: this.checked }); });
  $('zlw-vis').addEventListener('change', function () { pushConfig({ wallpaperVisible: this.checked }); });
  $('zlw-pause-blur').addEventListener('change', function () { pushConfig({ pauseOnBlur: this.checked }); });
  $('zlw-optimize').addEventListener('change', function () {
    pushConfig({ optimize: this.checked });
    if (this.checked) status('已开启：大视频将在后台转码，完成后自动生效');
  });

  $('zlw-pause').addEventListener('click', function () {
    var next = this.textContent === '暂停';
    this.textContent = next ? '继续' : '暂停';
    var v = videoEl();
    if (v) { if (next) v.pause(); else { var p = v.play(); if (p && p.catch) p.catch(function () {}); } }
    pushConfig({ paused: next });
  });

  $('zlw-fit').addEventListener('click', function () {
    var current = this.getAttribute('data-fit') || 'cover';
    var next = FIT_ORDER[(FIT_ORDER.indexOf(current) + 1) % FIT_ORDER.length];
    applyFitLabel(this, next);
    post('/api/config', { fit: next }, function (d) { status('已切换: ' + FIT_LABELS[next]); });
  });

  /**
   * Uploads a picked file and makes it the wallpaper. Images and videos share
   * this path; the service decides the kind from the extension.
   */
  function uploadFile(input, kindLabel) {
    var f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    var limitMb = kindLabel === '视频' ? 120 : 40;
    if (f.size > limitMb * 1024 * 1024) {
      status(kindLabel + '过大，上限 ' + limitMb + ' MB');
      return;
    }
    status('正在导入' + kindLabel + ' ' + f.name + '…');
    // The panel cannot read arbitrary paths, so hand the bytes to the service
    // through a data URI; the service writes them into its data directory.
    var fr = new FileReader();
    fr.onload = function () {
      fetch(API + '/api/upload', {
        method: 'POST',
        headers: auth({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ name: f.name, dataUri: fr.result })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.error) { status('导入失败: ' + d.error); return; }
          status('已应用' + kindLabel + ': ' + f.name);
          refresh();
        })
        .catch(function () { status('导入失败: 服务不可达'); });
    };
    fr.readAsDataURL(f);
  }

  $('zlw-file-video').addEventListener('change', function () { uploadFile(this, '视频'); });
  $('zlw-file-image').addEventListener('change', function () { uploadFile(this, '图片'); });

  $('zlw-reset').addEventListener('click', function () {
    post('/api/reset', {}, function () {
      try {
        localStorage.removeItem('zcode-livewall:css');
        localStorage.removeItem('zcode-livewall:meta');
      } catch (e) {}
      status('已还原默认外观');
      refresh();
    });
  });

  $('zlw-retry').addEventListener('click', function () {
    this.textContent = '正在重试…';
    refresh();
  });

  /**
   * The panel is positioned with right/bottom until the first drag switches it
   * to left/top. That switch must write both in the same frame: setting
   * right/bottom to auto alone leaves the box at its static position, which is
   * below the fold and looks like the panel never opened.
   */
  function clampIntoView(panel) {
    var r = panel.getBoundingClientRect();
    var maxX = Math.max(4, window.innerWidth - r.width - 4);
    var maxY = Math.max(4, window.innerHeight - r.height - 4);
    panel.style.left = Math.min(Math.max(4, r.left), maxX) + 'px';
    panel.style.top = Math.min(Math.max(4, r.top), maxY) + 'px';
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  /**
   * Blur/dim/speed can change behind the panel's back — MCP tools, the CLI,
   * curl, a wallpaper switch pushed by another surface. While the panel is
   * open, poll the service so the sliders never show a stale value; otherwise
   * dragging from a wrong start point reads as "the slider does nothing".
   * Skipped while a slider is being dragged: refreshing then would snap the
   * thumb back mid-drag.
   */
  var beatTimer = null;
  var sliderHeld = 0;
  ['pointerdown'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var t = e.target;
      if (t && t.id && /^zlw-(blur|dim|speed)$/.test(t.id)) sliderHeld++;
    }, true);
  });
  ['pointerup', 'pointercancel'].forEach(function (ev) {
    document.addEventListener(ev, function () { sliderHeld = Math.max(0, sliderHeld - 1); }, true);
  });
  function setBeat(on) {
    if (on && !beatTimer) beatTimer = setInterval(function () {
      if (document.getElementById('zlw-panel').hidden) { setBeat(false); return; }
      if (sliderHeld > 0) return;
      refresh();
    }, 2500);
    if (!on && beatTimer) { clearInterval(beatTimer); beatTimer = null; }
  }

  function togglePanel(show) {
    var p = $('zlw-panel');
    p.hidden = show === undefined ? !p.hidden : !show;
    if (!p.hidden) {
      // A stale off-screen position from a previous window size would make the
      // panel open invisibly, so reclaim it on every open.
      if (p.style.left) clampIntoView(p);
      refresh();
      if (!projectsLoaded) loadProjects();
      setBeat(true);
    } else {
      setBeat(false);
    }
  }

  $('zlw-fab').addEventListener('click', function () { togglePanel(); });
  $('zlw-close').addEventListener('click', function () { $('zlw-panel').hidden = true; });

  refresh();
  loadProjects();

  (function () {
    var head = $('zlw-head'), panel = $('zlw-panel');
    var sx = 0, sy = 0, ox = 0, oy = 0, dragging = false, moved = false;
    var DRAG_THRESHOLD = 3;

    // No setPointerCapture here. Pointer capture retargets every later pointer
    // event — including pointerup and the resulting click — to the capturing
    // element, so the ✕ button inside the header would never receive its own
    // click. Dragging is tracked with document-level move/up listeners instead,
    // which leave the event targets untouched.
    function isInteractive(el) {
      return !!(el && el.closest && el.closest('button, input, select, textarea, a, label'));
    }

    function onMove(e) {
      if (!dragging) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      moved = true;
      var x = Math.max(4, Math.min(window.innerWidth - 80, ox + dx));
      var y = Math.max(4, Math.min(window.innerHeight - 60, oy + dy));
      panel.style.left = x + 'px'; panel.style.top = y + 'px';
    }

    function onUp() {
      dragging = false; moved = false;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    }

    head.addEventListener('pointerdown', function (e) {
      if (e.button !== 0 || isInteractive(e.target)) return;
      dragging = true; moved = false;
      sx = e.clientX; sy = e.clientY;
      var r = panel.getBoundingClientRect(); ox = r.left; oy = r.top;
      // Pin the current position before releasing right/bottom, otherwise the
      // panel jumps to its static flow position until the first pointermove.
      panel.style.left = ox + 'px'; panel.style.top = oy + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });

    window.addEventListener('resize', function () {
      if (!panel.hidden && panel.style.left) clampIntoView(panel);
    });
  })();

  // Self-heal: if the layer was lost but a previous injection saved it.
  if (!document.getElementById('zcode-livewall-style')) {
    var savedCss = null, savedMeta = null;
    try {
      savedCss = localStorage.getItem('zcode-livewall:css');
      savedMeta = localStorage.getItem('zcode-livewall:meta');
    } catch (e) {}
    if (savedCss) {
      var s = document.createElement('style');
      s.id = 'zcode-livewall-style';
      s.textContent = savedCss;
      (document.head || document.documentElement).appendChild(s);
      if (savedMeta && !document.getElementById('zcode-livewall-stage')) {
        try {
          var meta = JSON.parse(savedMeta);
          if (meta.videoUrl) {
            var stage = document.createElement('div');
            stage.id = 'zcode-livewall-stage';
            var v = document.createElement('video');
            v.id = 'zcode-livewall-video';
            v.muted = true; v.loop = true; v.autoplay = true; v.playsInline = true;
            v.src = meta.videoUrl;
            stage.appendChild(v);
            document.documentElement.appendChild(stage);
          }
        } catch (e) {}
      }
    }
  }
})();`;
}
