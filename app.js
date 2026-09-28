(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var els = {
    input: $('input'),
    output: $('output'),
    sortKeys: $('sortKeys'),
    autoFormat: $('autoFormat'),
    formatBtn: $('formatBtn'),
    clearBtn: $('clearBtn'),
    uploadBtn: $('uploadBtn'),
    fileInput: $('fileInput'),
    copyBtn: $('copyBtn'),
    downloadBtn: $('downloadBtn'),
    expandBtn: $('expandBtn'),
    collapseBtn: $('collapseBtn'),
    splitter: $('splitter'),
    workspace: $('workspace'),
    editorWrap: document.querySelector('.editor-wrap'),
    inputStatus: $('inputStatus'),
    inputStats: $('inputStats'),
    outputStatus: $('outputStatus'),
    outputStats: $('outputStats'),
    toast: $('toast')
  };

  var collapsedPaths = new Set();
  var expandedPaths = new Set();
  var lastText = '';
  var lastData = null;
  var lastRaw = '';

  /* ---------------- 工具 ---------------- */

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { els.toast.classList.remove('show'); }, 1800);
  }

  function byteSize(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    return str.length;
  }

  function fmtSize(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function setStatus(el, text, type) {
    el.textContent = text;
    el.className = 'status' + (type ? ' ' + type : '');
  }

  function sortKeysDeep(value) {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).sort().forEach(function (k) { out[k] = sortKeysDeep(value[k]); });
      return out;
    }
    return value;
  }

  /* ---------------- 树形视图 ---------------- */

  function valueType(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v;
  }

  function scalarHtml(v, type) {
    if (type === 'string') return '<span class="tree-str">"' + escapeHtml(v) + '"</span>';
    if (type === 'number') return '<span class="tree-num">' + escapeHtml(String(v)) + '</span>';
    if (type === 'boolean') return '<span class="tree-bool">' + v + '</span>';
    if (type === 'null') return '<span class="tree-null">null</span>';
    return '<span class="tree-unk">' + escapeHtml(String(v)) + '</span>';
  }

  function collectContainerPaths(value, path, list) {
    var type = valueType(value);
    if (type === 'object') {
      if (path) list.push(path);
      Object.keys(value).forEach(function (k) {
        collectContainerPaths(value[k], path ? path + '.' + k : k, list);
      });
    } else if (type === 'array') {
      if (path) list.push(path);
      value.forEach(function (v, i) {
        collectContainerPaths(v, path + '[' + i + ']', list);
      });
    }
  }

  // 节点在格式化文本中占用的行数（用于真实行号）
  function subtreeLines(value) {
    var type = valueType(value);
    if (type !== 'object' && type !== 'array') return 1;
    var items = type === 'object' ? Object.keys(value) : value;
    if (!items.length) return 1; // {} 或 [] 占一行
    var total = 2;
    for (var i = 0; i < items.length; i++) {
      total += subtreeLines(type === 'object' ? value[items[i]] : value[i]);
    }
    return total;
  }

  // line：该节点在格式化文本中的真实行号，与是否折叠无关
  function buildNode(path, key, value, depth, isArrayIndex, line) {
    var type = valueType(value);
    var isContainer = type === 'object' || type === 'array';

    // 默认：根节点与一层属性展开，更深层折叠；用户操作过的节点以记录为准
    var collapsed = isContainer &&
      (collapsedPaths.has(path) || (depth > 1 && !expandedPaths.has(path)));

    var html = '<div class="tree-node' + (collapsed ? ' collapsed' : '') +
               '" data-path="' + escapeHtml(path) + '">';
    html += '<div class="tree-header">';
    html += '<span class="tree-ln">' + line + '</span>';
    html += '<span class="tree-pad" style="width:' + (depth * 16) + 'px"></span>';

    if (isContainer) {
      html += '<button class="tree-toggle">' + (collapsed ? '+' : '−') + '</button>';
      html += '<span class="tree-icon tree-icon-' + type + '"></span>';
    } else {
      // 标量不显示类型图标，避免与键名混淆
      html += '<span class="tree-toggle-empty"></span>';
      html += '<span class="tree-icon"></span>';
    }

    if (key !== null) {
      html += '<span class="tree-key' + (isArrayIndex ? ' tree-index' : '') + '">' +
              escapeHtml(String(key)) + '</span>';
      // 数组元素若是容器，只显示下标，不显示冒号
      if (!(isArrayIndex && isContainer)) html += '<span class="tree-sep">:</span>';
    }

    // 数组显示 [...元素数量]
    if (type === 'array') {
      html += '<span class="tree-count">[...' + value.length + ']</span>';
    }

    if (!isContainer) html += scalarHtml(value, type);
    html += '</div>';

    if (isContainer && !collapsed) {
      html += '<div class="tree-body">';
      var childLine = line + 1;
      if (type === 'object') {
        Object.keys(value).forEach(function (k) {
          html += buildNode(path ? path + '.' + k : k, k, value[k], depth + 1, false, childLine);
          childLine += subtreeLines(value[k]);
        });
      } else {
        value.forEach(function (v, i) {
          html += buildNode(path + '[' + i + ']', i, v, depth + 1, true, childLine);
          childLine += subtreeLines(v);
        });
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function renderTree(value) {
    lastData = value;
    els.output.innerHTML = '<div class="tree">' + buildNode('', null, value, 0, false, 1) + '</div>';
  }

  function showPlaceholder() {
    lastText = '';
    lastData = null;
    collapsedPaths.clear();
    expandedPaths.clear();
    els.output.innerHTML =
      '<div class="placeholder">左侧输入 JSON 后，这里会以树形视图展示<br>' +
      '支持拖动中缝调整宽度 · 可直接拖入 .json 文件</div>';
    setStatus(els.outputStatus, '—');
    els.outputStats.textContent = '';
  }

  /* ---------------- 错误定位 ---------------- */

  function posInfo(err, text) {
    var msg = String(err && err.message || err);
    var pos = /position\s+(\d+)/.exec(msg);
    var lc = /line\s+(\d+)\s+column\s+(\d+)/.exec(msg);
    var index = pos ? parseInt(pos[1], 10) : null;

    if (!lc && index !== null) {
      var before = text.slice(0, index);
      var line = before.split('\n').length;
      var column = index - (before.lastIndexOf('\n') + 1) + 1;
      return { msg: msg, index: index, line: line, column: column };
    }
    if (lc) {
      var l = parseInt(lc[1], 10);
      var c = parseInt(lc[2], 10);
      var idx = 0;
      var arr = text.split('\n');
      for (var i = 0; i < l - 1 && i < arr.length; i++) idx += arr[i].length + 1;
      idx += Math.max(0, c - 1);
      return { msg: msg, index: idx, line: l, column: c };
    }
    return { msg: msg, index: null, line: null, column: null };
  }

  function showError(err, text) {
    var p = posInfo(err, text);
    var where = p.line ? '第 ' + p.line + ' 行第 ' + p.column + ' 列' : '未知位置';
    setStatus(els.inputStatus, '解析失败 · ' + where, 'err');
    setStatus(els.outputStatus, '无法解析', 'err');
    els.outputStats.textContent = '';

    var lines = text.split('\n');
    var snippet = '';
    if (p.line) {
      var from = Math.max(0, p.line - 3);
      var to = Math.min(lines.length, p.line + 2);
      for (var i = from; i < to; i++) {
        var mark = (i + 1 === p.line) ? '>' : ' ';
        snippet += mark + ' ' + (i + 1) + ' | ' + lines[i] + '\n';
      }
    }

    var jump = p.index !== null
      ? '<button class="btn" id="jumpBtn">定位到错误位置</button>'
      : '';

    els.output.innerHTML =
      '<div class="error-box">' +
      '<h3>JSON 解析失败</h3>' +
      '<p>' + escapeHtml(p.msg) + '</p>' +
      (snippet ? '<pre>' + escapeHtml(snippet) + '</pre>' : '') +
      jump +
      '</div>';

    if (jump) {
      document.getElementById('jumpBtn').addEventListener('click', function () {
        els.input.focus();
        els.input.setSelectionRange(p.index, Math.min(p.index + 1, text.length));
      });
    }
  }

  /* ---------------- 主流程 ---------------- */

  function updateInputStats(text) {
    if (!text) {
      els.inputStats.textContent = '';
      return;
    }
    els.inputStats.textContent = text.length + ' 字符 · ' + text.split('\n').length + ' 行 · ' + fmtSize(byteSize(text));
  }

  function format() {
    var raw = els.input.value;
    updateInputStats(raw);

    if (raw !== lastRaw) {
      lastRaw = raw;
      collapsedPaths.clear();
      expandedPaths.clear();
    }

    if (!raw.trim()) {
      setStatus(els.inputStatus, '等待输入');
      showPlaceholder();
      return;
    }

    var data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      showError(err, raw);
      return;
    }

    setStatus(els.inputStatus, 'JSON 合法', 'ok');
    var processed = els.sortKeys.checked ? sortKeysDeep(data) : data;
    var out;
    try {
      out = JSON.stringify(processed, null, 2);
    } catch (e) {
      out = String(processed);
    }

    lastText = out;
    renderTree(processed);
    setStatus(els.outputStatus, '已格式化', 'ok');
    els.outputStats.textContent =
      out.split('\n').length + ' 行 · ' + out.length + ' 字符 · ' + fmtSize(byteSize(out));
  }

  /* ---------------- 事件 ---------------- */

  var timer = null;
  els.input.addEventListener('input', function () {
    if (!els.autoFormat.checked) {
      updateInputStats(els.input.value);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(format, 200);
  });

  els.sortKeys.addEventListener('change', format);
  els.formatBtn.addEventListener('click', function () { format(); toast('已美化'); });

  els.clearBtn.addEventListener('click', function () {
    els.input.value = '';
    els.input.focus();
    setStatus(els.inputStatus, '等待输入');
    updateInputStats('');
    showPlaceholder();
  });

  els.uploadBtn.addEventListener('click', function () { els.fileInput.click(); });
  els.fileInput.addEventListener('change', function () {
    var file = els.fileInput.files && els.fileInput.files[0];
    if (file) readFile(file);
    els.fileInput.value = '';
  });

  function readFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      els.input.value = String(reader.result || '');
      collapsedPaths.clear();
      expandedPaths.clear();
      format();
      toast('已载入 ' + file.name);
    };
    reader.readAsText(file);
  }

  ['dragenter', 'dragover'].forEach(function (evt) {
    els.editorWrap.addEventListener(evt, function (e) {
      e.preventDefault();
      els.editorWrap.classList.add('dragging');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    els.editorWrap.addEventListener(evt, function (e) {
      e.preventDefault();
      els.editorWrap.classList.remove('dragging');
    });
  });
  els.editorWrap.addEventListener('drop', function (e) {
    var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readFile(file);
  });

  els.output.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.tree-toggle') : null;
    if (!btn) return;
    var node = btn.closest('.tree-node');
    if (!node) return;
    var path = node.getAttribute('data-path') || '';
    var isCollapsed = node.classList.contains('collapsed');
    if (isCollapsed) {
      expandedPaths.add(path);
      collapsedPaths.delete(path);
    } else {
      collapsedPaths.add(path);
      expandedPaths.delete(path);
    }
    var top = els.output.scrollTop;
    renderTree(lastData);
    els.output.scrollTop = top;
  });

  els.expandBtn.addEventListener('click', function () {
    if (!lastData) return;
    var paths = [];
    collectContainerPaths(lastData, '', paths);
    expandedPaths = new Set(paths);
    collapsedPaths.clear();
    renderTree(lastData);
  });

  els.collapseBtn.addEventListener('click', function () {
    if (!lastData) return;
    var paths = [];
    collectContainerPaths(lastData, '', paths);
    collapsedPaths = new Set(paths);
    expandedPaths.clear();
    renderTree(lastData);
  });

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('已复制到剪贴板'); }, fallback);
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('已复制到剪贴板'); }
      catch (e) { toast('复制失败，请手动选择'); }
      document.body.removeChild(ta);
    }
  }

  els.copyBtn.addEventListener('click', function () {
    if (!lastText) { toast('没有可复制的内容'); return; }
    copyText(lastText);
  });

  els.downloadBtn.addEventListener('click', function () {
    if (!lastText) { toast('没有可下载的内容'); return; }
    var blob = new Blob([lastText], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'formatted.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已下载 formatted.json');
  });

  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); format(); toast('已美化'); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) {
      e.preventDefault();
      els.copyBtn.click();
    }
  });

  /* ---------------- 分隔条拖动 ---------------- */

  (function () {
    var dragging = false;
    els.splitter.addEventListener('mousedown', function () {
      if (window.innerWidth <= 860) return;
      dragging = true;
      els.splitter.classList.add('active');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var rect = els.workspace.getBoundingClientRect();
      var left = e.clientX - rect.left;
      var pct = Math.min(80, Math.max(20, (left / rect.width) * 100));
      els.workspace.style.setProperty('--left', pct + '%');
    });
    window.addEventListener('mouseup', function () {
      if (!dragging) return;
      dragging = false;
      els.splitter.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  })();

  /* ---------------- 初始化 ---------------- */

  showPlaceholder();
})();
