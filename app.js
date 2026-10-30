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

// 管理员校验
var ADMIN_USER = 'sfcl'
var ADMIN_PASS = '1234567890'
function checkAdmin(username, password) {
  var u = String(username == null ? '' : username).trim()
  var p = String(password == null ? '' : password).trim()
  if (!u || !p) return { ok: false, message: '请输入账号和密码' }
  if (u !== ADMIN_USER || p !== ADMIN_PASS) return { ok: false, message: '账号或密码错误' }
  return { ok: true, message: '' }
}

// ===================== PURE END =====================

// ---------- UI ----------
(function () {
  var STORAGE_KEY = 'car_query_web_data_v1'
  var RECENT_KEY = 'car_query_web_recent_v1'
  var ADMIN_KEY = 'car_query_web_admin_v1'
  var WEB_DATA_VERSION = 1

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
    var html = '<div class="card result-card">'
    html += '<div class="result-head">'
    html += '<div class="car-no">' + esc(car.carNo) + '</div>'
    html += '<div class="tags">'
    if (car.carType) html += '<span class="tag tag-primary">' + esc(car.carType) + '</span>'
    var wn = workNoOf(car)
    if (wn) html += '<span class="tag tag-gray">工作号 ' + esc(wn) + '</span>'
    html += '</div></div>'

    if (car.base && car.base.length) {
      html += '<div class="section"><div class="section-title">基础信息</div><div class="base-grid">'
      for (var i = 0; i < car.base.length; i++) {
        html += '<div class="base-item"><span class="base-label">' + esc(car.base[i].label) + '</span><span class="base-value">' + esc(car.base[i].value) + '</span></div>'
      }
      html += '</div></div>'
    }

    html += '<div class="section"><div class="section-title">分工分配</div>'
    if (car.assignments && car.assignments.length) {
      html += '<div class="assign-list">'
      for (var a = 0; a < car.assignments.length; a++) {
        var it = car.assignments[a]
        html += '<div class="assign-row"><span class="assign-process">' + esc(it.process) + '</span><span class="assign-supplier' + (it.supplier ? '' : ' unassigned') + '">' + esc(it.supplier || '未分配') + '</span></div>'
      }
      html += '</div>'
    } else {
      html += '<div class="assign-empty">暂无分工分配数据</div>'
    }
    html += '</div>'

    if (updatedAt) html += '<div class="result-foot">数据更新于 ' + esc(fmtTime(updatedAt)) + '</div>'
    html += '</div>'
    return html
  }

  function renderFuzzy(list, keyword) {
    var html = '<div class="card fuzzy-card">'
    html += '<div class="fuzzy-tip">未找到完全一致的车号/工作号，以下是包含“' + esc(keyword) + '”的车辆：</div>'
    for (var i = 0; i < list.length; i++) {
      var c = list[i]
      html += '<div class="fuzzy-row" data-no="' + escAttr(c.carNo) + '">'
      html += '<span class="fuzzy-no">' + esc(c.carNo) + '</span>'
      html += '<span class="fuzzy-type">' + esc(c.carType || '—') + (workNoOf(c) ? ' · 工作号 ' + esc(workNoOf(c)) : '') + '</span>'
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
      box.innerHTML = '<div class="card empty-card"><div class="empty-icon">🔍</div>' +
        '<div class="empty-title">未查到「' + esc(kw) + '」</div>' +
        '<div class="empty-desc">车号、工作号都可以查（如 676638 或 2026-071）</div>' +
        '<div class="empty-desc">请核对输入是否正确，或联系调度确认该车辆是否已建档</div></div>'
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

    $('login-btn').addEventListener('click', function () {
      var res = checkAdmin($('admin-user').value, $('admin-pass').value)
      if (!res.ok) { $('login-err').textContent = res.message; return }
      setAdmin(true)
      $('login-err').textContent = ''
      $('admin-pass').value = ''
      renderAdmin()
      toast('登录成功')
    })
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
