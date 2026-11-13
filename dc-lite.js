/* dc-lite: a small standalone renderer for the selector pages.
   Renders <x-dc> markup with {{holes}}, <sc-for> and <sc-if>, and a `class Component extends DCLogic` logic class. */
(function () {
  'use strict';
  var comp = null, rootEl = null, tpl = null, queued = false;

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (p, cb) {
    var next = typeof p === 'function' ? p(this.state, this.props) : p;
    this.state = Object.assign({}, this.state, next || {});
    schedule(cb);
  };
  DCLogic.prototype.forceUpdate = function (cb) { schedule(cb); };
  window.DCLogic = DCLogic;

  var HOLE = /\{\{\s*([^}]*?)\s*\}\}/g;
  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (path === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(path)) return +path;
    var parts = path.split('.'), v = scope;
    for (var i = 0; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function whole(str) { var m = /^\s*\{\{\s*([^}]*?)\s*\}\}\s*$/.exec(str || ''); return m ? m[1] : null; }
  function interp(str, scope) {
    return str.replace(HOLE, function (_, p) { var v = lookup(p, scope); return v == null || v === false ? '' : String(v); });
  }
  function child(scope, extra) { var s = Object.create(scope); for (var k in extra) s[k] = extra[k]; return s; }

  var EVENTS = {onclick: 'click', onchange: 'change', oninput: 'input', onsubmit: 'submit', onkeydown: 'keydown'};

  function build(node, scope, out) {
    if (node.nodeType === 3) { out.push(document.createTextNode(interp(node.data, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.tagName.toLowerCase();
    if (tag === 'template' && node.getAttribute('data-sc')) {
      var kind = node.getAttribute('data-sc'), kids = node.content.childNodes, i, j;
      if (kind === 'if') {
        var p = whole(node.getAttribute('value'));
        if (p != null ? lookup(p, scope) : node.getAttribute('value')) for (i = 0; i < kids.length; i++) build(kids[i], scope, out);
      } else {
        var list = lookup(whole(node.getAttribute('list')) || '', scope) || [], as = node.getAttribute('as') || 'item';
        for (j = 0; j < list.length; j++) {
          var extra = {$index: j}; extra[as] = list[j];
          var s = child(scope, extra);
          for (i = 0; i < kids.length; i++) build(kids[i], s, out);
        }
      }
      return;
    }
    var el = node.namespaceURI && node.namespaceURI !== 'http://www.w3.org/1999/xhtml'
      ? document.createElementNS(node.namespaceURI, node.tagName) : document.createElement(tag);
    el.__h = {};
    var attrs = node.attributes;
    for (var a = 0; a < attrs.length; a++) {
      var name = attrs[a].name, val = attrs[a].value, lname = name.toLowerCase();
      if (lname.indexOf('hint-') === 0) continue;
      if (EVENTS[lname]) { var fn = lookup(whole(val) || '', scope); if (typeof fn === 'function') el.__h[EVENTS[lname]] = fn; continue; }
      var w = whole(val);
      if (lname === 'value' && (tag === 'select' || tag === 'input' || tag === 'textarea')) {
        el.__val = w != null ? lookup(w, scope) : val; if (el.__val == null) el.__val = '';
        el.setAttribute('value', String(el.__val));
        continue;
      }
      if (w != null) {
        var v = lookup(w, scope);
        if (v == null || v === false && !/^aria-/.test(lname)) continue;
        el.setAttribute(name, String(v));
      } else el.setAttribute(name, interp(val, scope));
    }
    var kidsOut = [], src = tag === 'template' ? node.content.childNodes : node.childNodes;
    for (var c = 0; c < src.length; c++) build(src[c], scope, kidsOut);
    for (c = 0; c < kidsOut.length; c++) el.appendChild(kidsOut[c]);
    if (tag === 'img') el.addEventListener('error', function () { this.style.visibility = 'hidden'; });
    out.push(el);
  }

  function morph(oldN, newN) {
    if (oldN.nodeType !== newN.nodeType || oldN.nodeName !== newN.nodeName) { oldN.parentNode.replaceChild(newN, oldN); return; }
    if (oldN.nodeType === 3) { if (oldN.data !== newN.data) oldN.data = newN.data; return; }
    var i, na = newN.attributes, oa = oldN.attributes;
    for (i = oa.length - 1; i >= 0; i--) if (!newN.hasAttribute(oa[i].name)) oldN.removeAttribute(oa[i].name);
    for (i = 0; i < na.length; i++) if (oldN.getAttribute(na[i].name) !== na[i].value) oldN.setAttribute(na[i].name, na[i].value);
    oldN.__h = newN.__h;
    var ok = oldN.childNodes, nk = Array.prototype.slice.call(newN.childNodes);
    for (i = 0; i < nk.length; i++) { if (i < ok.length) morph(ok[i], nk[i]); else oldN.appendChild(nk[i]); }
    while (oldN.childNodes.length > nk.length) oldN.removeChild(oldN.lastChild);
    if ('__val' in newN) { oldN.__val = newN.__val; if (String(oldN.value) !== String(newN.__val)) oldN.value = newN.__val; }
  }

  function render() {
    var vals = comp.renderVals() || {}, out = [];
    var scope = child(vals, {});
    for (var i = 0; i < tpl.childNodes.length; i++) build(tpl.childNodes[i], scope, out);
    var fresh = document.createElement('div');
    out.forEach(function (n) { fresh.appendChild(n); });
    if (!rootEl.firstChild) {
      while (fresh.firstChild) rootEl.appendChild(fresh.firstChild);
    } else morph(rootEl, fresh);
    applyVals(rootEl);
  }
  function applyVals(el) {
    if ('__val' in el && String(el.value) !== String(el.__val)) el.value = el.__val;
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) applyVals(c);
  }
  function schedule(cb) {
    if (queued) { if (cb) Promise.resolve().then(cb); return; }
    queued = true;
    Promise.resolve().then(function () { queued = false; render(); if (cb) cb(); if (comp.componentDidUpdate) comp.componentDidUpdate(); });
  }

  function boot() {
    var xdc = document.querySelector('x-dc'), script = document.querySelector('script[data-dc-script]');
    var raw = xdc.innerHTML
      .replace(/<sc-for\b/g, '<template data-sc="for"').replace(/<\/sc-for>/g, '</template>')
      .replace(/<sc-if\b/g, '<template data-sc="if"').replace(/<\/sc-if>/g, '</template>');
    var doc = new DOMParser().parseFromString('<!doctype html><html><body>' + raw + '</body></html>', 'text/html');
    var helmet = doc.querySelector('helmet');
    if (helmet) {
      Array.prototype.slice.call(helmet.childNodes).forEach(function (n) {
        if (n.nodeType !== 1) return;
        var copy;
        if (n.tagName === 'SCRIPT') { copy = document.createElement('script'); copy.textContent = n.textContent; }
        else copy = document.importNode(n, true);
        document.head.appendChild(copy);
      });
      helmet.parentNode.removeChild(helmet);
    }
    tpl = doc.body;
    rootEl = document.createElement('div'); rootEl.id = 'dc-root';
    xdc.parentNode.replaceChild(rootEl, xdc);
    var props = {}, decl = {};
    try { decl = JSON.parse(script.getAttribute('data-props') || '{}'); } catch (e) {}
    Object.keys(decl).forEach(function (k) { if (k.charAt(0) !== '$' && decl[k] && 'default' in decl[k]) props[k] = decl[k].default; });
    var Component = new Function('DCLogic', script.textContent + '\n;return Component;')(DCLogic);
    comp = new Component(props);
    if (!comp.state) comp.state = {};
    ['click', 'change', 'input', 'submit', 'keydown'].forEach(function (type) {
      rootEl.addEventListener(type, function (e) {
        for (var n = e.target; n && n !== rootEl; n = n.parentNode) {
          if (n.__h && n.__h[type]) { n.__h[type](e); return; }
        }
      });
    });
    render();
    if (comp.componentDidMount) comp.componentDidMount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
