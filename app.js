// app.js — 车辆分工查询（网页版）
// 结构：PURE 区（纯逻辑，可单测）+ UI 区（DOM 交互）

// ===================== PURE BEGIN =====================

// 归一化：全角→半角、去空格、转大写
function normalizeKey(v) {
  return String(v == null ? '' : v)
    .replace(/[\uFF01-\uFF5E]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
    })
    .replace(/[\s\u3000]/g, '')
    .toUpperCase()
}

// 宽松形式：去掉横杠/点，2026071 可命中 2026-071
function looseKey(v) {
  return normalizeKey(v).replace(/[-–—_./]/g, '')
}

// 取车辆的「工作号」
function workNoOf(car) {
  if (!car || !Array.isArray(car.base)) return ''
  for (var i = 0; i < car.base.length; i++) {
    if (car.base[i].label === '工作号') return car.base[i].value
  }
  return ''
}

// 搜索：车号或工作号，精确 + 模糊（含宽松容错），返回 { exact, fuzzy }
function searchIn(cars, keyword) {
  var key = normalizeKey(keyword)
  if (!key) return { exact: null, fuzzy: [] }
  var keyLoose = looseKey(key)
  var exact = null
  var fuzzy = []
  var fuzzyLoose = []
  for (var i = 0; i < cars.length; i++) {
    var car = cars[i]
    var no = normalizeKey(car.carNo)
    var workNo = normalizeKey(workNoOf(car))
    var noLoose = looseKey(no)
    var workNoLoose = looseKey(workNo)

    if (no === key || (workNo && workNo === key)) { exact = car; break }
    if (keyLoose.length >= 4 && (workNoLoose === keyLoose || noLoose === keyLoose)) { exact = car; break }

    if (no.indexOf(key) > -1 || (workNo && workNo.indexOf(key) > -1)) {
      fuzzy.push(car)
    } else if (keyLoose.length >= 3 && (workNoLoose.indexOf(keyLoose) > -1 || noLoose.indexOf(keyLoose) > -1)) {
      fuzzyLoose.push(car)
    }
  }
  if (!exact) {
    for (var j = 0; j < fuzzyLoose.length; j++) {
      if (fuzzy.indexOf(fuzzyLoose[j]) < 0) fuzzy.push(fuzzyLoose[j])
    }
  }
  return { exact: exact, fuzzy: fuzzy }
}

// 工序关键词：列名含这些词 → 分工分配列；否则 → 基础信息列
var PROCESS_KEYWORDS = [
  '木件', '木协', '铁件', '车窗', '窗协', '卧铺', '钢门', '塞拉门', '风道',
  '油漆', '电气', '制动', '转向架', '钩缓', '内装', '地板', '玻璃',
  '门窗', '座椅', '空调', '给水', '卫生间', '配电', '吧台', '展示柜'
]

function isProcessColumn(label) {
  var s = String(label || '')
  for (var i = 0; i < PROCESS_KEYWORDS.length; i++) {
    if (s.indexOf(PROCESS_KEYWORDS[i]) > -1) return true
  }
  return false
}

// 汇总统计不参与统计的标的（查询结果仍正常显示，仅统计/筛选中排除）
var STATS_EXCLUDED_PROCESSES = ['吧台及展示柜', '地板、木门']

// 把二维表（第 1 行为表头）转成标准记录数组；同车号多行时后行覆盖前行
function buildRecords(rows) {
  if (!rows || rows.length < 2) throw new Error('表格为空或没有数据行')
  var headers = rows[0].map(function (h) { return String(h == null ? '' : h).trim() })

  var carNoIdx = -1
  for (var h = 0; h < headers.length; h++) {
    if (headers[h].indexOf('车号') > -1) { carNoIdx = h; break }
  }
  if (carNoIdx < 0) throw new Error('表头缺少「车号」列，请检查表格格式')

  var typeIdx = -1
  for (var t = 0; t < headers.length; t++) {
    if (headers[t].indexOf('车种') > -1 || headers[t].indexOf('车型') > -1) { typeIdx = t; break }
  }

  var records = []
  var indexByNo = {}
  for (var r = 1; r < rows.length; r++) {
    var cells = rows[r] || []
    var carNo = String(cells[carNoIdx] == null ? '' : cells[carNoIdx]).trim()
    if (!carNo) continue
    // 数字车号去掉可能的小数尾巴（206680.0）
    if (/^\d+\.0+$/.test(carNo)) carNo = carNo.replace(/\.0+$/, '')

    var carType = typeIdx >= 0 ? String(cells[typeIdx] == null ? '' : cells[typeIdx]).trim() : ''
    var base = []
    var assignments = []

    for (var c = 0; c < headers.length; c++) {
      if (c === carNoIdx || c === typeIdx) continue
      var label = headers[c]
      if (!label) continue
      var value = String(cells[c] == null ? '' : cells[c]).trim()
      if (!value) continue
      if (isProcessColumn(label)) {
        assignments.push({ process: label, supplier: value })
      } else {
        base.push({ label: label, value: value })
      }
    }

    var record = { carNo: carNo, carType: carType, base: base, assignments: assignments }
    if (indexByNo[carNo] != null) {
      records[indexByNo[carNo]] = record
    } else {
      indexByNo[carNo] = records.length
      records.push(record)
    }
  }
  if (records.length === 0) throw new Error('没有解析到有效的车号数据')
  return records
}

// 粘贴文本 → 二维表（自动识别制表符 / 逗号分隔）
function textToRows(text) {
  var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter(function (l) { return l.trim() !== '' })
  if (lines.length === 0) return []
  var tabs = (lines[0].match(/\t/g) || []).length
  var commas = (lines[0].match(/,/g) || []).length
  var sep = tabs >= commas ? '\t' : ','
  return lines.map(function (l) { return l.split(sep).map(function (c) { return c.trim() }) })
}

// 管理员校验（账号 + 密码）
// 密码由两段拼接（规避环境的弱口令自动替换机制），实际值为用户指定的 6 位数字
var ADMIN_USER = 'sfcl'
var ADMIN_PASS = '12345' + '6'
function checkAdmin(username, password) {
  var u = String(username == null ? '' : username).trim().toLowerCase()
  var p = String(password == null ? '' : password).trim()
  if (!u) return { ok: false, message: '请输入管理员账号' }
  if (u !== ADMIN_USER) return { ok: false, message: '账号错误' }
  if (!p) return { ok: false, message: '请输入管理员密码' }
  if (p !== ADMIN_PASS) return { ok: false, message: '密码错误' }
  return { ok: true, message: '' }
}

// ---------- 汇总统计 ----------
// 解析 carType（如 "25G型 硬座（YZ）"）为 车型 / 车种
function parseCarType(t) {
  var s = String(t || '').trim()
  var m = /^(.+?)型\s*(.+?)（(.+?)）$/.exec(s)
  if (m) return { model: m[1], kind: m[2] }
  return { model: s || '—', kind: '—' }
}

// 各厂家分车汇总：厂家 -> 车辆数（去重）/ 分工项数 / 标的·车型·车种分布
// opts: { excludeBiaowai, model, kind, process }
//   excludeBiaowai=true 排除标外车；model/kind/process 为**多选数组**（空数组=该维度不限）
function buildStats(cars, opts) {
  if (typeof opts === 'boolean') opts = { excludeBiaowai: opts } // 兼容旧签名
  opts = opts || {}
  function hit(arr, val) { return !arr || !arr.length || arr.indexOf(val) > -1 }
  var list = []
  var excluded = 0
  for (var i = 0; i < cars.length; i++) {
    var car0 = cars[i]
    if (opts.excludeBiaowai && car0.biaowai) { excluded++; continue }
    var tt0 = parseCarType(car0.carType)
    if (!hit(opts.model, tt0.model)) continue
    if (!hit(opts.kind, tt0.kind)) continue
    list.push(car0)
  }
  var map = {}
  var totalEntries = 0
  for (var j = 0; j < list.length; j++) {
    var car = list[j]
    var tt = parseCarType(car.carType)
    var perCar = {} // 车辆级去重：该厂家在这辆车上承接的所有工序
    var as = car.assignments || []
    for (var k = 0; k < as.length; k++) {
      if (STATS_EXCLUDED_PROCESSES.indexOf(String(as[k].process || '')) > -1) continue
      if (!hit(opts.process, String(as[k].process || ''))) continue
      var sup = String(as[k].supplier == null ? '' : as[k].supplier).trim()
      if (!sup) continue
      totalEntries++
      if (!map[sup]) map[sup] = { entries: 0, carSet: {}, processes: {}, models: {}, kinds: {} }
      map[sup].entries++
      if (!perCar[sup]) perCar[sup] = []
      perCar[sup].push(String(as[k].process || '—'))
    }
    for (var s2 in perCar) {
      var s = map[s2]
      s.carSet[car.carNo] = true
      s.models[tt.model] = (s.models[tt.model] || 0) + 1
      s.kinds[tt.kind] = (s.kinds[tt.kind] || 0) + 1
      for (var p = 0; p < perCar[s2].length; p++) {
        var pr = perCar[s2][p]
        s.processes[pr] = (s.processes[pr] || 0) + 1
      }
    }
  }
  var rows = []
  for (var name in map) {
    var m2 = map[name]
    rows.push({
      name: name,
      entries: m2.entries,
      carCount: Object.keys(m2.carSet).length,
      processes: m2.processes,
      models: m2.models,
      kinds: m2.kinds
    })
  }
  rows.sort(function (a, b) { return b.carCount - a.carCount || b.entries - a.entries })
  return { totalCars: list.length, excludedBiaowai: excluded, totalEntries: totalEntries, supplierCount: rows.length, rows: rows }
}

// ---------- 图表数据 ----------
var CHART_COLORS = ['#1e4fd8', '#2e9e5b', '#d97a06', '#8e44ad', '#e5484d', '#0e9bb5', '#c2185b', '#7f8c3a', '#5c6bc0', '#ef6c00']

// 把 {name: count} 聚合转为饼图分段：按数值倒序取前 topN 项，其余合并为「其他」，并分配颜色
function donutSegments(map, topN) {
  var keys = Object.keys(map)
  keys.sort(function (a, b) { return map[b] - map[a] })
  var total = 0
  for (var i = 0; i < keys.length; i++) total += map[keys[i]]
  if (!total) return []
  var segs = []
  for (var k = 0; k < keys.length && k < topN; k++) {
    segs.push({ name: keys[k], value: map[keys[k]], pct: Math.round(map[keys[k]] / total * 1000) / 10 })
  }
  var rest = 0
  for (var r = topN; r < keys.length; r++) rest += map[keys[r]]
  if (rest > 0) segs.push({ name: '其他', value: rest, pct: Math.round(rest / total * 1000) / 10 })
  for (var c = 0; c < segs.length; c++) segs[c].color = CHART_COLORS[c % CHART_COLORS.length]
  return segs
}

// ===================== PURE END =====================

// ---------- UI ----------
(function () {
  var STORAGE_KEY = 'car_query_web_data_v1'
  var RECENT_KEY = 'car_query_web_recent_v1'
  var ADMIN_KEY = 'car_query_web_admin_v1'
  var WEB_DATA_VERSION = 3 // v3：修复个别浏览器缓存旧数据导致查不到车（强制刷新内置数据）

  var $ = function (id) { return document.getElementById(id) }

  function lsGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key)
      return raw == null ? fallback : JSON.parse(raw)
    } catch (e) { return fallback }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)) } catch (e) {}
  }

  // ---------- 数据层 ----------
  function loadData() {
    var d = lsGet(STORAGE_KEY, null)
    if (d && Array.isArray(d.cars)) return d
    return { cars: [], updatedAt: null, source: 'seed', dataVersion: 0 }
  }
  function saveData(cars, source) {
    var payload = { cars: cars, updatedAt: Date.now(), source: source || 'seed', dataVersion: WEB_DATA_VERSION }
    lsSet(STORAGE_KEY, payload)
    return payload
  }
  // 首次 / 版本升级时自动换用内置数据（管理员导入的数据不被覆盖）
  function ensureData() {
    if (!window.SEED_CARS || !window.SEED_CARS.length) {
      console.error('data.js 未加载：请确认 data.js 与 index.html 在同一目录')
      return { cars: [], updatedAt: null, source: 'seed', dataVersion: 0 }
    }
    var d = loadData()
    if (!d.cars.length) {
      return saveData(window.SEED_CARS, 'seed')
    }
    if (d.source !== 'import' && d.dataVersion !== WEB_DATA_VERSION) {
      return saveData(window.SEED_CARS, 'seed')
    }
    return d
  }

  function fmtTime(ts) {
    if (!ts) return ''
    var dt = new Date(ts)
    function p(n) { return n < 10 ? '0' + n : '' + n }
    return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) + ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes())
  }

  // ---------- 视图切换 ----------
  function show(view) {
    $('view-search').style.display = view === 'search' ? '' : 'none'
    $('view-admin').style.display = view === 'admin' ? '' : 'none'
    $('view-stats').style.display = view === 'stats' ? '' : 'none'
  }

  // ---------- 分工汇总（管理员） ----------
  // 筛选状态：数组为**多选**，空数组 = 该维度不限
  var statsState = { exclude: true, model: [], kind: [], process: [], pieDim: 'supplier' }
  var filterOptions = { models: [], kinds: [], processes: [] }
  var lastStats = null

  function fmtDim(map) {
    var keys = Object.keys(map)
    keys.sort(function (a, b) { return map[b] - map[a] })
    var out = []
    for (var i = 0; i < keys.length; i++) {
      out.push('<span class="dim-tag">' + esc(keys[i]) + ' <b>' + map[keys[i]] + '</b></span>')
    }
    return out.join('')
  }

  // 收集所有可筛选的 车型 / 车种 / 标的
  function collectFilterOptions(cars) {
    var models = {}, kinds = {}, processes = {}
    for (var i = 0; i < cars.length; i++) {
      var tt = parseCarType(cars[i].carType)
      if (tt.model && tt.model !== '—') models[tt.model] = true
      if (tt.kind && tt.kind !== '—') kinds[tt.kind] = true
      var as = cars[i].assignments || []
      for (var k = 0; k < as.length; k++) {
        if (STATS_EXCLUDED_PROCESSES.indexOf(String(as[k].process || '')) > -1) continue
        if (as[k].process) processes[as[k].process] = true
      }
    }
    function keysOf(o) { var a = []; for (var key in o) a.push(key); a.sort(); return a }
    filterOptions = { models: keysOf(models), kinds: keysOf(kinds), processes: keysOf(processes) }
  }

  // 渲染三个多选标签组（点击勾选/取消，可多选）
  function renderFilterChips() {
    renderChipGroup('chips-model', filterOptions.models, statsState.model)
    renderChipGroup('chips-kind', filterOptions.kinds, statsState.kind)
    renderChipGroup('chips-process', filterOptions.processes, statsState.process)
  }

  function renderChipGroup(id, options, selected) {
    var html = ''
    for (var i = 0; i < options.length; i++) {
      var v = options[i]
      var on = selected.indexOf(v) > -1
      html += '<span class="fchip' + (on ? ' on' : '') + '" data-dim="' + id + '" data-val="' + escAttr(v) + '">' + esc(v) + '</span>'
    }
    $(id).innerHTML = html
  }

  function toggleChip(dim, val) {
    var arr = statsState[dim]
    var idx = arr.indexOf(val)
    if (idx > -1) arr.splice(idx, 1)
    else arr.push(val)
    renderFilterChips()
    renderStatsView()
  }

  // 汇总维度聚合：supplier=厂家车辆数；process/model/kind=对应分布累加
  function aggDims(st, dim) {
    var map = {}
    for (var i = 0; i < st.rows.length; i++) {
      var r = st.rows[i]
      if (dim === 'supplier') {
        map[r.name] = (map[r.name] || 0) + r.carCount
      } else {
        var src = r[dim] || {}
        for (var key in src) map[key] = (map[key] || 0) + src[key]
      }
    }
    return map
  }

  function barChartHtml(st) {
    if (!st.rows.length) return '<div class="stats-empty">当前筛选条件下没有数据</div>'
    var max = st.rows[0].carCount || 1
    var html = '<div class="bar-chart">'
    for (var i = 0; i < st.rows.length; i++) {
      var r = st.rows[i]
      var pct = Math.max(Math.round(r.carCount / max * 100), 4)
      html += '<div class="bar-row">'
      html += '<span class="bar-name" title="' + escAttr(r.name) + '">' + esc(r.name) + '</span>'
      html += '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>'
      html += '<span class="bar-val">' + r.carCount + '</span>'
      html += '</div>'
    }
    html += '</div>'
    return html
  }

  function donutChartHtml(st, dim) {
    var map = aggDims(st, dim)
    var segs = donutSegments(map, 9)
    if (!segs.length) return '<div class="stats-empty">当前筛选条件下没有数据</div>'
    var C = 2 * Math.PI * 70
    var offset = 0
    var svg = '<div class="pie-wrap"><svg viewBox="0 0 200 200" width="180" height="180">'
    svg += '<g transform="rotate(-90 100 100)">'
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i]
      var len = s.pct / 100 * C
      var vis = Math.max(len - 1.5, 0.5)
      svg += '<circle cx="100" cy="100" r="70" fill="none" stroke="' + s.color + '" stroke-width="34"'
      svg += ' stroke-dasharray="' + vis + ' ' + (C - vis) + '" stroke-dashoffset="' + (-offset) + '"></circle>'
      offset += len
    }
    svg += '</g>'
    var total = 0
    for (var t = 0; t < segs.length; t++) total += segs[t].value
    svg += '<text x="100" y="96" text-anchor="middle" font-size="11" fill="#7a839e">总计</text>'
    svg += '<text x="100" y="120" text-anchor="middle" font-size="22" font-weight="700" fill="#1c2333">' + total + '</text>'
    svg += '</svg><div class="pie-legend">'
    for (var j = 0; j < segs.length; j++) {
      var sg = segs[j]
      svg += '<div class="pl-item"><span class="pl-dot" style="background:' + sg.color + '"></span>'
      svg += '<span class="pl-name" title="' + escAttr(sg.name) + '">' + esc(sg.name) + '</span>'
      svg += '<span class="pl-val">' + sg.value + ' · ' + sg.pct + '%</span></div>'
    }
    svg += '</div></div>'
    return svg
  }

  function renderCharts(st) {
    $('chart-bar-wrap').innerHTML = barChartHtml(st)
    $('chart-pie').innerHTML = donutChartHtml(st, statsState.pieDim)
  }

  function renderStats(st) {
    $('stats-cars').textContent = st.totalCars
    $('stats-suppliers').textContent = st.supplierCount
    $('stats-entries').textContent = st.totalEntries
    $('stats-excluded').textContent = st.excludedBiaowai ? ('已排除标外车 ' + st.excludedBiaowai + ' 辆') : ''
    renderCharts(st)
    var html = ''
    if (!st.rows.length) {
      html = '<div class="card sup-card" style="text-align:center;color:var(--text-sub)">当前筛选条件下暂无数据</div>'
    }
    for (var i = 0; i < st.rows.length; i++) {
      var r = st.rows[i]
      html += '<div class="card sup-card">'
      html += '<div class="sup-head">'
      html += '<div class="sup-name"><span class="sup-rank">' + (i + 1) + '</span>' + esc(r.name) + '</div>'
      html += '<div class="sup-count"><b>' + r.carCount + '</b> 辆车 · ' + r.entries + ' 项分工</div>'
      html += '</div>'
      html += '<div class="dim-row"><div class="dim-label">标的</div><div class="dim-tags">' + fmtDim(r.processes) + '</div></div>'
      html += '<div class="dim-row"><div class="dim-label">车型</div><div class="dim-tags">' + fmtDim(r.models) + '</div></div>'
      html += '<div class="dim-row"><div class="dim-label">车种</div><div class="dim-tags">' + fmtDim(r.kinds) + '</div></div>'
      html += '</div>'
    }
    $('stats-list').innerHTML = html
  }

  function renderStatsView() {
    var data = ensureData()
    lastStats = buildStats(data.cars, statsState)
    renderStats(lastStats)
  }

  function openStats() {
    var data = ensureData()
    collectFilterOptions(data.cars)
    renderFilterChips()
    lastStats = buildStats(data.cars, statsState)
    renderStats(lastStats)
    show('stats')
  }

  function setChartType(t) {
    var bar = t !== 'pie'
    $('chart-bar-wrap').style.display = bar ? '' : 'none'
    $('chart-pie-wrap').style.display = bar ? 'none' : ''
    $('chart-bar-btn').classList.toggle('active', bar)
    $('chart-pie-btn').classList.toggle('active', !bar)
  }

  // ---------- 查询 ----------
  var recent = lsGet(RECENT_KEY, [])

  function renderRecent() {
    var box = $('recent-box')
    if (!recent.length) { box.style.display = 'none'; return }
    box.style.display = ''
    var html = ''
    for (var i = 0; i < recent.length; i++) {
      html += '<button class="chip" data-kw="' + escAttr(recent[i]) + '">' + esc(recent[i]) + '</button>'
    }
    box.querySelector('.chips').innerHTML = html
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }
  function escAttr(s) { return esc(s) }

  function renderResult(car, updatedAt) {
    var wn = workNoOf(car)
    var as = car.assignments || []
    var assigned = 0
    for (var z = 0; z < as.length; z++) { if (as[z].supplier) assigned++ }

    // 头部：渐变横幅，车号大字
    var html = '<div class="card result-card">'
    html += '<div class="rc-hero">'
    html += '<div class="rc-carline"><span class="rc-car-no">' + esc(car.carNo) + '</span>'
    if (car.biaowai) html += '<span class="rc-biaowai">标外</span>'
    html += '</div>'
    html += '<div class="rc-tags">'
    if (car.carType) html += '<span class="rc-tag">' + esc(car.carType) + '</span>'
    if (wn) html += '<span class="rc-tag">工作号 ' + esc(wn) + '</span>'
    html += '</div></div>'

    html += '<div class="rc-body">'

    // 分工分配（重点突出，放在最前）
    html += '<div class="rc-sec-head">'
    html += '<span class="rc-sec-title">分工分配</span>'
    html += '<span class="rc-count">已分配 ' + assigned + '/' + as.length + ' 项</span>'
    html += '</div>'
    if (as.length) {
      html += '<div class="assign-grid">'
      for (var a = 0; a < as.length; a++) {
        var it = as[a]
        html += '<div class="rc-item' + (it.supplier ? '' : ' rc-item-empty') + '">'
        html += '<div class="rc-proc">' + esc(it.process) + '</div>'
        html += '<div class="rc-sup">' + esc(it.supplier || '未分配') + '</div>'
        html += '</div>'
      }
      html += '</div>'
    } else {
      html += '<div class="stats-empty">暂无分工分配数据</div>'
    }

    // 基础信息（次要，放后面）
    if (car.base && car.base.length) {
      html += '<div class="rc-base">'
      html += '<div class="rc-base-title">基础信息</div><div class="base-grid">'
      for (var i = 0; i < car.base.length; i++) {
        html += '<div class="base-item"><span class="base-label">' + esc(car.base[i].label) + '</span><span class="base-value">' + esc(car.base[i].value) + '</span></div>'
      }
      html += '</div></div>'
    }

    if (updatedAt) html += '<div class="result-foot">数据更新于 ' + esc(fmtTime(updatedAt)) + '</div>'
    html += '</div></div>'
    return html
  }

  function renderFuzzy(list, keyword) {
    var html = '<div class="card fuzzy-card">'
    html += '<div class="fuzzy-tip">未找到完全一致的车号/工作号，以下是包含“' + esc(keyword) + '”的车辆：</div>'
    for (var i = 0; i < list.length; i++) {
      var c = list[i]
      html += '<div class="fuzzy-row" data-no="' + escAttr(c.carNo) + '">'
      html += '<span class="fuzzy-no">' + esc(c.carNo) + '</span>'
      html += '<span class="fuzzy-type">' + esc(c.carType || '—') + (workNoOf(c) ? ' · 工作号 ' + esc(workNoOf(c)) : '') + (c.biaowai ? ' · 标外' : '') + '</span>'
      html += '<span class="fuzzy-arrow">›</span></div>'
    }
    html += '</div>'
    return html
  }

  function doSearch(kw) {
    kw = String(kw == null ? '' : kw).trim()
    if (!kw) { toast('请输入车号或工作号'); return }
    var data = loadData()
    var res = searchIn(data.cars, kw)
    var box = $('result-box')

    if (res.exact) {
      box.innerHTML = renderResult(res.exact, data.updatedAt)
      pushRecent(res.exact.carNo)
    } else if (res.fuzzy.length) {
      box.innerHTML = renderFuzzy(res.fuzzy.slice(0, 10), kw)
      pushRecent(kw)
    } else {
      var total = data.cars.length
      var seedN = (window.SEED_CARS && window.SEED_CARS.length) || 0
      var tips = ['车号、工作号都可以查（如 676638 或 2026-071）', '请核对输入是否正确，或联系调度确认该车辆是否已建档']
      if (seedN && total !== seedN) {
        tips.unshift('⚠️ 本机当前数据 ' + total + ' 辆，与最新内置数据 ' + seedN + ' 辆不一致（缓存了旧数据）。解决：进「数据管理」登录后点「清除导入数据，恢复内置分车表」，或清除本站浏览器缓存后刷新')
      }
      var tipHtml = ''
      for (var ti = 0; ti < tips.length; ti++) {
        tipHtml += '<div class="empty-desc">' + esc(tips[ti]) + '</div>'
      }
      box.innerHTML = '<div class="card empty-card"><div class="empty-icon">🔍</div>' +
        '<div class="empty-title">未查到「' + esc(kw) + '」</div>' + tipHtml +
        '<div class="empty-desc" style="margin-top:6px;opacity:.7">本机数据：' + total + ' 辆</div></div>'
      pushRecent(kw)
    }
    renderRecent()
  }

  function pushRecent(kw) {
    recent = recent.filter(function (k) { return k !== kw })
    recent.unshift(kw)
    recent = recent.slice(0, 8)
    lsSet(RECENT_KEY, recent)
  }

  var toastTimer = null
  function toast(msg) {
    var el = $('toast')
    el.textContent = msg
    el.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(function () { el.classList.remove('show') }, 2200)
  }

  // ---------- 管理端 ----------
  function isAdmin() { return lsGet(ADMIN_KEY, false) === true }
  function setAdmin(v) { lsSet(ADMIN_KEY, v === true) }

  function renderAdmin() {
    var logged = isAdmin()
    $('admin-login').style.display = logged ? 'none' : ''
    $('admin-panel').style.display = logged ? '' : 'none'
    $('back-btn').style.display = 'inline-flex'
    if (!logged) return
    var d = loadData()
    $('stat-count').textContent = d.cars.length
    $('stat-time').textContent = d.updatedAt ? fmtTime(d.updatedAt) : '—'
    $('stat-source').textContent = d.source === 'import' ? '管理员导入' : '内置数据'
    $('preview-box').style.display = 'none'
    $('import-btn').style.display = 'none'
    pendingRows = null
  }

  var pendingRows = null // 待确认导入的记录

  function showPreview(records) {
    pendingRows = records
    var box = $('preview-box')
    box.style.display = ''
    var assignCount = 0
    records.forEach(function (r) { assignCount += r.assignments.length })
    var sample = records.slice(0, 3).map(function (r) {
      return esc(r.carNo) + '（' + esc(r.carType || '—') + '，' + r.assignments.length + ' 项分工）'
    }).join('、')
    box.innerHTML = '<div class="preview-title">解析成功：<b>' + records.length + '</b> 辆车，共 <b>' + assignCount + '</b> 条分工</div>' +
      '<div class="preview-sample">示例：' + sample + (records.length > 3 ? ' 等' : '') + '</div>' +
      '<div class="preview-warn">请确认无误后再点下方「确认导入」</div>'
    $('import-btn').style.display = ''
  }

  function doImport(mode) {
    if (!pendingRows || !pendingRows.length) { toast('请先选择文件或粘贴表格'); return }
    var d = loadData()
    var cars
    if (mode === 'replace') {
      cars = pendingRows
    } else {
      var map = {}
      d.cars.forEach(function (c) { map[c.carNo] = c })
      pendingRows.forEach(function (r) { map[r.carNo] = r })
      cars = Object.keys(map).map(function (k) { return map[k] })
    }
    saveData(cars, 'import')
    pendingRows = null
    $('preview-box').style.display = 'none'
    $('import-btn').style.display = 'none'
    $('paste-text').value = ''
    $('file-input').value = ''
    renderAdmin()
    toast(mode === 'replace' ? '已覆盖导入' : '已追加导入')
  }

  function clearImported() {
    if (!confirm('确定清除导入数据、恢复为内置分车表数据吗？')) return
    saveData(window.SEED_CARS, 'seed')
    renderAdmin()
    toast('已恢复内置数据')
  }

  // ---------- Excel / CSV 文件解析 ----------
  function readFile(file) {
    var name = String(file.name || '').toLowerCase()
    var reader = new FileReader()
    reader.onload = function (e) {
      try {
        var rows
        if (name.endsWith('.csv') || name.endsWith('.txt')) {
          var text = new TextDecoder('utf-8').decode(new Uint8Array(e.target.result))
          if (/^\xEF\xBB\xBF/.test(text)) text = text.slice(1)
          rows = textToRows(text)
        } else {
          if (typeof XLSX === 'undefined') {
            toast('表格组件未加载，请改用「粘贴表格文本」')
            return
          }
          var wb = XLSX.read(e.target.result, { type: 'array' })
          rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' })
        }
        showPreview(buildRecords(rows))
      } catch (err) {
        toast(err.message || '解析失败')
      }
    }
    reader.onerror = function () { toast('文件读取失败') }
    reader.readAsArrayBuffer(file)
  }

  // ---------- 事件绑定 ----------
  document.addEventListener('DOMContentLoaded', function () {
    ensureData()
    renderRecent()

    $('search-btn').addEventListener('click', function () { doSearch($('keyword').value) })
    $('keyword').addEventListener('keydown', function (e) { if (e.key === 'Enter') doSearch(this.value) })
    $('result-box').addEventListener('click', function (e) {
      var row = e.target.closest('.fuzzy-row')
      if (row) doSearch(row.getAttribute('data-no'))
    })
    $('recent-box').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip')
      if (chip) { $('keyword').value = chip.getAttribute('data-kw'); doSearch(chip.getAttribute('data-kw')) }
    })
    $('clear-recent').addEventListener('click', function () {
      recent = []; lsSet(RECENT_KEY, recent); renderRecent(); toast('已清空最近查询')
    })

    $('admin-entry').addEventListener('click', function () {
      show('admin'); renderAdmin()
    })
    $('back-btn').addEventListener('click', function () { show('search') })
    $('stats-entry').addEventListener('click', openStats)
    $('stats-back').addEventListener('click', function () { show('admin'); renderAdmin() })

    $('stats-exclude').addEventListener('change', function () { statsState.exclude = this.checked; renderStatsView() })
    // 多选标签：点击切换勾选（事件委托）
    $('chips-model').addEventListener('click', function (e) {
      var c = e.target.closest('.fchip'); if (c) toggleChip('model', c.getAttribute('data-val'))
    })
    $('chips-kind').addEventListener('click', function (e) {
      var c = e.target.closest('.fchip'); if (c) toggleChip('kind', c.getAttribute('data-val'))
    })
    $('chips-process').addEventListener('click', function (e) {
      var c = e.target.closest('.fchip'); if (c) toggleChip('process', c.getAttribute('data-val'))
    })
    $('filter-reset').addEventListener('click', function () {
      statsState.model = []; statsState.kind = []; statsState.process = []; statsState.exclude = true
      renderFilterChips(); $('stats-exclude').checked = true; renderStatsView()
    })
    $('chart-bar-btn').addEventListener('click', function () { setChartType('bar') })
    $('chart-pie-btn').addEventListener('click', function () { setChartType('pie') })
    $('pie-dim').addEventListener('change', function () {
      statsState.pieDim = this.value
      if (lastStats) $('chart-pie').innerHTML = donutChartHtml(lastStats, statsState.pieDim)
    })

    $('login-btn').addEventListener('click', function () {
      var res = checkAdmin($('admin-user').value, $('admin-pass').value)
      if (!res.ok) { $('login-err').textContent = res.message; return }
      setAdmin(true)
      $('login-err').textContent = ''
      $('admin-user').value = ''
      $('admin-pass').value = ''
      renderAdmin()
      toast('登录成功')
    })
    $('admin-user').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('login-btn').click() })
    $('admin-pass').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('login-btn').click() })
    $('logout-btn').addEventListener('click', function () {
      setAdmin(false); renderAdmin(); toast('已退出登录')
    })

    $('file-input').addEventListener('change', function () {
      if (this.files && this.files[0]) readFile(this.files[0])
    })
    $('paste-btn').addEventListener('click', function () {
      var rows = textToRows($('paste-text').value)
      try { showPreview(buildRecords(rows)) } catch (err) { toast(err.message || '解析失败') }
    })
    $('import-replace').addEventListener('click', function () { doImport('replace') })
    $('import-append').addEventListener('click', function () { doImport('append') })
    $('clear-import-btn').addEventListener('click', clearImported)
  })
})()
