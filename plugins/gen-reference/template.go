package genreference

import "html/template"

var referenceTemplate = template.Must(template.New("reference").Parse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>{{.Title}}</title>
  <style>
    :root { color-scheme: light; --canvas:#f6f4ef; --surface:#fffdf8; --surface-2:#f0eee8; --ink:#1f2528; --muted:#687074; --line:#d8d5ce; --accent:#1769aa; --accent-soft:#e7f2fb; --event:#9a5d08; --shadow:0 1px 2px rgba(31,37,40,.08); font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    :root[data-theme="dark"] { color-scheme:dark; --canvas:#15191c; --surface:#1d2226; --surface-2:#262c31; --ink:#edf0f1; --muted:#a7b0b5; --line:#384148; --accent:#71b8ed; --accent-soft:#17344a; --event:#efb65d; --shadow:0 1px 2px rgba(0,0,0,.28); }
    * { box-sizing:border-box; }
    html { scroll-behavior:smooth; }
    body { margin:0; background:var(--canvas); color:var(--ink); font-size:14px; line-height:1.5; }
    button,input { font:inherit; }
    button { color:inherit; }
    a { color:var(--accent); }
    code,.mono { font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace; }
    .shell { min-height:100vh; display:grid; grid-template-columns:310px minmax(0,1fr); }
    aside { position:sticky; top:0; height:100vh; overflow:auto; border-right:1px solid var(--line); background:var(--surface); }
    .brand { position:sticky; top:0; z-index:2; padding:20px; border-bottom:1px solid var(--line); background:var(--surface); }
    .brand-row { display:flex; align-items:center; gap:10px; }
    .rose { width:28px; height:28px; color:var(--accent); flex:none; }
    .brand h1 { margin:0; font-size:16px; line-height:1.25; }
    .brand p { margin:3px 0 0; color:var(--muted); font-size:12px; }
    .tools { display:grid; grid-template-columns:1fr auto; gap:8px; margin-top:16px; }
    .search { width:100%; min-width:0; padding:8px 10px; color:var(--ink); background:var(--canvas); border:1px solid var(--line); border-radius:7px; outline:none; }
    .search:focus { border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
    .theme { width:38px; border:1px solid var(--line); border-radius:7px; background:var(--canvas); cursor:pointer; }
    .theme:hover { border-color:var(--accent); }
    nav { padding:12px; }
    .nav-group { margin-bottom:16px; }
    .nav-heading { display:flex; justify-content:space-between; margin:0 8px 5px; color:var(--muted); font:600 11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.06em; text-transform:uppercase; }
    .nav-link { display:grid; grid-template-columns:auto minmax(0,1fr); gap:8px; padding:7px 8px; border-radius:6px; color:var(--ink); text-decoration:none; }
    .nav-link:hover,.nav-link:focus { background:var(--surface-2); outline:none; }
    .nav-kind { color:var(--muted); font:11px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace; }
    .nav-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .no-results { padding:16px 8px; color:var(--muted); }
    main { min-width:0; padding:48px clamp(24px,5vw,72px) 96px; }
    .content { max-width:1120px; margin:0 auto; }
    .eyebrow { margin:0 0 8px; color:var(--muted); font:600 11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.08em; text-transform:uppercase; }
    .overview h2 { margin:0; max-width:850px; font-size:clamp(28px,4vw,44px); line-height:1.1; letter-spacing:-.025em; }
    .intro { max-width:800px; margin:16px 0 0; color:var(--muted); font-size:16px; }
    .counts { display:flex; flex-wrap:wrap; gap:10px; margin:28px 0 0; }
    .count { min-width:130px; padding:14px 16px; border:1px solid var(--line); border-radius:9px; background:var(--surface); box-shadow:var(--shadow); }
    .count strong { display:block; font-size:22px; font-variant-numeric:tabular-nums; }
    .count span { color:var(--muted); }
    .resource { scroll-margin-top:24px; margin-top:56px; padding-top:30px; border-top:1px solid var(--line); }
    .resource-head { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:20px; align-items:start; }
    .kind { display:inline-flex; margin-bottom:7px; color:var(--muted); font:600 11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.06em; text-transform:uppercase; }
    .resource[data-kind="event"] .kind { color:var(--event); }
    .resource h2 { margin:0; font-size:24px; line-height:1.2; }
    .id { margin-top:6px; color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
    .summary { max-width:850px; margin:14px 0 0; color:var(--muted); font-size:15px; white-space:pre-line; }
    .badges { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:6px; }
    .badge { padding:3px 7px; border:1px solid var(--line); border-radius:999px; background:var(--surface); color:var(--muted); font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }
    .relationships { margin-top:22px; }
    .relationships h3,.record h3 { margin:0 0 8px; font-size:13px; }
    .relation-list { display:flex; flex-wrap:wrap; gap:7px; }
    .relation { display:inline-flex; gap:6px; padding:6px 9px; border:1px solid var(--line); border-radius:7px; background:var(--surface); text-decoration:none; box-shadow:var(--shadow); }
    .relation span { color:var(--muted); }
    .relation code { color:var(--accent); }
    details.record { margin-top:22px; border:1px solid var(--line); border-radius:9px; background:var(--surface); box-shadow:var(--shadow); }
    details.record > summary { cursor:pointer; padding:11px 14px; font:600 12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }
    pre { margin:0; padding:16px; overflow:auto; border-top:1px solid var(--line); color:var(--ink); background:var(--surface-2); font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace; tab-size:2; }
    .catalog-record { margin-top:48px; }
    mark { color:inherit; background:#f5d88c; }
    :root[data-theme="dark"] mark { background:#6a5018; }
    .mobile-bar { display:none; }
    @media (max-width:820px) {
      .shell { display:block; }
      aside { position:fixed; inset:0 14% 0 0; z-index:10; height:auto; transform:translateX(-105%); transition:transform .25s ease; box-shadow:8px 0 30px rgba(0,0,0,.25); }
      body[data-nav="open"] aside { transform:translateX(0); }
      .mobile-bar { position:sticky; top:0; z-index:5; display:flex; align-items:center; justify-content:space-between; padding:10px 14px; border-bottom:1px solid var(--line); background:var(--surface); }
      .mobile-bar button { padding:6px 9px; border:1px solid var(--line); border-radius:7px; background:var(--canvas); }
      main { padding:34px 20px 72px; }
      .resource-head { display:block; }
      .badges { justify-content:flex-start; margin-top:12px; }
    }
    @media (prefers-reduced-motion:reduce) { html { scroll-behavior:auto; } aside { transition:none; } }
    @media print { aside,.mobile-bar,.theme { display:none!important; } .shell { display:block; } main { padding:0; } .resource { break-inside:avoid; } details.record { display:none; } }
  </style>
</head>
<body>
  <div class="mobile-bar"><strong>Architecture reference</strong><button type="button" id="nav-open">Contents</button></div>
  <div class="shell">
    <aside aria-label="Architecture reference contents">
      <div class="brand">
        <div class="brand-row">
          <svg class="rose" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M16 2l3.1 10.9L30 16l-10.9 3.1L16 30l-3.1-10.9L2 16l10.9-3.1L16 2z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="16" r="2" fill="currentColor"/></svg>
          <div><h1 id="side-title"></h1><p>Portable architecture reference</p></div>
        </div>
        <div class="tools">
          <input class="search" id="search" type="search" placeholder="Search name, ID or summary" aria-label="Search reference">
          <button class="theme" id="theme" type="button" aria-label="Toggle color theme" title="Toggle color theme">◐</button>
        </div>
      </div>
      <nav id="nav"></nav>
    </aside>
    <main><div class="content" id="content"></div></main>
  </div>
  <script id="portolan-reference" type="application/json">{{.Payload}}</script>
  <script>
    (() => {
      const model = JSON.parse(document.getElementById('portolan-reference').textContent);
      const byId = new Map(model.resources.map(resource => [resource.id, resource]));
      const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
      const slug = value => 'r-' + Array.from(new TextEncoder().encode(value)).map(byte => byte.toString(16).padStart(2, '0')).join('');
      const pretty = value => esc(JSON.stringify(value, null, 2));
      const labelFor = id => byId.get(id)?.name || id;

      document.getElementById('side-title').textContent = model.title;
      document.title = model.title + ' — Architecture reference';

      const overview = ` + "`" + `<section class="overview" id="overview"><p class="eyebrow">Architecture reference</p><h2>${esc(model.title)}</h2>${model.summary ? ` + "`" + `<p class="intro">${esc(model.summary)}</p>` + "`" + ` : '<p class="intro">A complete, portable reading of this catalog profile. Every section keeps its exact catalog record for audit.</p>'}<div class="counts">${model.counts.map(item => ` + "`" + `<div class="count"><strong>${item.value}</strong><span>${esc(item.label)}</span></div>` + "`" + `).join('')}</div></section>` + "`" + `;

      const section = resource => ` + "`" + `<section class="resource" data-kind="${esc(resource.kind)}" data-search="${esc([resource.kindLabel, resource.id, resource.name, resource.summary, ...(resource.badges || [])].join(' ').toLowerCase())}" id="${slug(resource.id)}"><div class="resource-head"><div><span class="kind">${esc(resource.kindLabel)}</span><h2>${esc(resource.name)}</h2><div class="id mono">${esc(resource.id)}</div></div>${resource.badges?.length ? ` + "`" + `<div class="badges">${resource.badges.map(badge => ` + "`" + `<span class="badge">${esc(badge)}</span>` + "`" + `).join('')}</div>` + "`" + ` : ''}</div>${resource.summary ? ` + "`" + `<p class="summary">${esc(resource.summary)}</p>` + "`" + ` : ''}${resource.relationships?.length ? ` + "`" + `<div class="relationships"><h3>Relationships</h3><div class="relation-list">${resource.relationships.map(link => byId.has(link.id) ? ` + "`" + `<a class="relation" href="#${slug(link.id)}"><span>${esc(link.label)}</span><code>${esc(labelFor(link.id))}</code></a>` + "`" + ` : ` + "`" + `<span class="relation"><span>${esc(link.label)}</span><code>${esc(link.id)}</code></span>` + "`" + `).join('')}</div></div>` + "`" + ` : ''}<details class="record"><summary>Exact catalog record</summary><pre>${pretty(resource.record)}</pre></details></section>` + "`" + `;

      document.getElementById('content').innerHTML = overview + model.resources.map(section).join('') + ` + "`" + `<details class="record catalog-record"><summary>Complete merged catalog JSON</summary><pre>${pretty(model.catalog)}</pre></details>` + "`" + `;

      const grouped = () => {
        const groups = new Map();
        for (const resource of model.resources) {
          if (!groups.has(resource.kindLabel)) groups.set(resource.kindLabel, []);
          groups.get(resource.kindLabel).push(resource);
        }
        return groups;
      };
      const renderNav = visible => {
        const allowed = new Set(visible.map(item => item.id));
        document.getElementById('nav').innerHTML = ` + "`" + `<div class="nav-group"><a class="nav-link" href="#overview"><span class="nav-kind">⌂</span><span class="nav-name">Overview</span></a></div>` + "`" + ` + Array.from(grouped()).map(([kind, resources]) => {
          const items = resources.filter(resource => allowed.has(resource.id));
          if (!items.length) return '';
          return ` + "`" + `<div class="nav-group"><div class="nav-heading"><span>${esc(kind)}</span><span>${items.length}</span></div>${items.map(resource => ` + "`" + `<a class="nav-link" href="#${slug(resource.id)}" title="${esc(resource.id)}"><span class="nav-kind">${esc(resource.kind.slice(0, 3))}</span><span class="nav-name">${esc(resource.name)}</span></a>` + "`" + `).join('')}</div>` + "`" + `;
        }).join('') || '<div class="no-results">No matching resources.</div>';
      };
      renderNav(model.resources);

      const search = document.getElementById('search');
      const filter = () => {
        const query = search.value.trim().toLowerCase();
        const visible = model.resources.filter(resource => !query || [resource.kindLabel, resource.id, resource.name, resource.summary, ...(resource.badges || [])].join(' ').toLowerCase().includes(query));
        const allowed = new Set(visible.map(item => item.id));
        document.querySelectorAll('.resource').forEach(node => { node.hidden = !allowed.has(model.resources.find(resource => slug(resource.id) === node.id)?.id); });
        renderNav(visible);
      };
      search.addEventListener('input', filter);
      document.addEventListener('keydown', event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search.focus(); search.select(); }
        if (event.key === 'Escape') { document.body.dataset.nav = ''; search.blur(); }
      });

      const root = document.documentElement;
      const setTheme = theme => { root.dataset.theme = theme; try { localStorage.setItem('portolan-reference-theme', theme); } catch {} };
      let saved = ''; try { saved = localStorage.getItem('portolan-reference-theme') || ''; } catch {}
      setTheme(saved || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light'));
      document.getElementById('theme').addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
      document.getElementById('nav-open').addEventListener('click', () => { document.body.dataset.nav = 'open'; });
      document.getElementById('nav').addEventListener('click', event => { if (event.target.closest('a')) document.body.dataset.nav = ''; });
    })();
  </script>
</body>
</html>`))
