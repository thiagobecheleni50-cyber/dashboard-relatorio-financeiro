(() => {
  "use strict";

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.js";
  }

  const STORAGE_KEY = "rf_exec_dashboard_v2";
  const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const MONTH_MAP = {
    jan:1, janeiro:1, january:1, "01":1, "1":1,
    fev:2, fevereiro:2, feb:2, february:2, "02":2, "2":2,
    mar:3, marco:3, march:3, "03":3, "3":3,
    abr:4, abril:4, apr:4, april:4, "04":4, "4":4,
    mai:5, maio:5, may:5, "05":5, "5":5,
    jun:6, junho:6, june:6, "06":6, "6":6,
    jul:7, julho:7, july:7, "07":7, "7":7,
    ago:8, agosto:8, aug:8, august:8, "08":8, "8":8,
    set:9, setembro:9, sep:9, september:9, "09":9, "9":9,
    out:10, outubro:10, oct:10, october:10, "10":10,
    nov:11, novembro:11, november:11, "11":11,
    dez:12, dezembro:12, dec:12, december:12, "12":12
  };

  const VIEW_META = {
    overview: ["Visão Geral Financeira", "Acompanhamento fiel de arrecadação, metas e despesas (2024–2026)"],
    "import-drive": ["Importar XLSX / CSV / PDF & Google Drive", "Envie arquivos .xlsx, .csv ou .pdf e sincronize planilhas do Google Drive automaticamente"],
    strategy: ["Soluções de Arrecadação & Metas", "Metas anuais, simulador What-If e plano de correção fiel aos dados"],
    records: ["Inserir & Excluir Lançamentos", "Controle operacional completo com edição e exclusão individual ou em lote"],
    reports: ["Exportar Relatório Executivo em PDF", "Gere o relatório completo ou filtrado por intervalo de datas em formato PDF"]
  };

  const $ = (id) => document.getElementById(id);

  const store = loadStore();
  const ui = {
    view: "overview",
    filters: { year: "", start: "", end: "", cat: "Todas", type: "", search: "" },
    selected: new Set(),
    confirmFn: null,
    lastAnalytics: null,
    chartHit: { monthly: [], annual: [], dev: [] },
    pdfPending: null,
    driveTimer: null
  };

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem("rf_exec_dashboard_v1");
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          nextId: parsed.nextId || 1,
          records: Array.isArray(parsed.records) ? parsed.records : [],
          targets: parsed.targets || { 2024: 0, 2025: 0, 2026: 0 },
          files: Array.isArray(parsed.files) ? parsed.files : [],
          driveLinks: parsed.driveLinks || "",
          driveAuto: parsed.driveAuto !== undefined ? parsed.driveAuto : true,
          driveInterval: parsed.driveInterval || 60,
          lastDriveSync: parsed.lastDriveSync || ""
        };
      }
    } catch {}
    return {
      nextId: 1,
      records: [],
      targets: { 2024: 0, 2025: 0, 2026: 0 },
      files: [],
      driveLinks: "",
      driveAuto: true,
      driveInterval: 60,
      lastDriveSync: ""
    };
  }

  function saveStore() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch {}
  }

  function fmtBRL(v) {
    return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  function fmtPct(v, signed = false) {
    const n = Number(v || 0);
    return `${signed && n > 0 ? "+" : ""}${n.toFixed(1).replace(".", ",")}%`;
  }
  function fmtDateBR(iso) {
    if (!iso || iso.length < 10) return "—";
    return `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}`;
  }
  function esc(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function toast(msg, err = false) {
    const el = document.createElement("div");
    el.className = `toast ${err ? "err" : ""}`;
    el.textContent = msg;
    $("toasts").appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity 220ms"; setTimeout(() => el.remove(), 230); }, 4200);
  }

  function normText(s) {
    return String(s ?? "").trim().toLowerCase()
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function parseNum(v) {
    if (typeof v === "number" && !isNaN(v)) return v;
    if (v === null || v === undefined) return null;
    let s = String(v).trim();
    if (!s || /^(-|—|n\/a|null)$/i.test(s)) return null;
    let neg = false;
    if (s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1).trim(); }
    s = s.replace(/[rR]\$|\$|€|£|%|\s/g, "");
    if (s.startsWith("-") || s.startsWith("−")) { neg = true; s = s.slice(1); }
    else if (s.startsWith("+")) s = s.slice(1);
    if (s.includes(",") && s.includes(".")) {
      s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    } else if (s.includes(",")) {
      const p = s.split(",");
      s = (p.length === 2 && p[1].length <= 2) ? s.replace(",", ".") : s.replace(/,/g, "");
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, "");
    }
    const n = Number(s);
    return isNaN(n) ? null : (neg ? -n : n);
  }

  function parseDateVal(v, fbYear, fbMonth) {
    if (typeof v === "number" && v >= 35000 && v <= 60000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
      return d.toISOString().slice(0, 10);
    }
    const s = String(v ?? "").trim();
    if (!s) return fbYear && fbMonth ? `${fbYear}-${String(fbMonth).padStart(2,"0")}-15` : null;
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (m) {
      let yr = Number(m[3]); if (yr < 100) yr += 2000;
      const mo = Number(m[2]), dy = Number(m[1]);
      if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31) return `${yr}-${String(mo).padStart(2,"0")}-${String(dy).padStart(2,"0")}`;
    }
    m = s.match(/^(\d{1,2})[-/](\d{4})$/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1].padStart(2,"0")}-15`;
    m = s.match(/^(\d{4})[-/](\d{1,2})$/);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return `${m[1]}-${m[2].padStart(2,"0")}-15`;
    const toks = normText(s).split("_");
    let mo = null, yr = fbYear;
    for (const t of toks) {
      if (MONTH_MAP[t] && !mo) mo = MONTH_MAP[t];
      else if (/^202\d$/.test(t)) yr = Number(t);
    }
    if (mo && yr) return `${yr}-${String(mo).padStart(2,"0")}-15`;
    return null;
  }

  function classifyType(raw, amt) {
    const n = normText(raw);
    if (/(despesa|custo|gasto|saida|debito|pagamento|folha|encargo|fornecedor|expense|cost)/.test(n)) return "despesa";
    if (/(receita|arrecadacao|entrada|credito|faturamento|tributo|imposto|venda|convenio|repasse|taxa|servico|revenue|income)/.test(n)) return "receita";
    return amt < 0 ? "despesa" : "receita";
  }

  function findCol(norms, cands) {
    for (const c of cands) { const i = norms.indexOf(c); if (i !== -1) return i; }
    for (const c of cands) { const i = norms.findIndex(h => h.includes(c)); if (i !== -1) return i; }
    return -1;
  }

  function parseTabularMatrix(rows, filename, sourceLabel, sourceFileId, defYear) {
    const nonEmpty = rows.filter(r => r && r.some(c => c !== null && c !== undefined && String(c).trim() !== ""));
    if (nonEmpty.length < 2) return [];
    let hIdx = 0;
    for (let i = 0; i < Math.min(10, nonEmpty.length); i++) {
      if (nonEmpty[i].filter(c => typeof c === "string" && c.trim()).length >= 2) { hIdx = i; break; }
    }
    const headers = nonEmpty[hIdx].map(c => String(c ?? "").trim());
    const norms = headers.map(normText);
    const dataRows = nonEmpty.slice(hIdx + 1);
    const yrMatch = (filename || "").match(/(202\d)/);
    const fileYear = defYear || (yrMatch ? Number(yrMatch[1]) : new Date().getFullYear());

    const monthCols = [];
    norms.forEach((h, idx) => {
      const first = h.split("_")[0];
      if (MONTH_MAP[h] && !/^\d+$/.test(h)) monthCols.push([idx, MONTH_MAP[h]]);
      else if (MONTH_MAP[first] && !/^\d+$/.test(first)) monthCols.push([idx, MONTH_MAP[first]]);
    });

    const out = [];
    if (monthCols.length >= 3) {
      const catCol = Math.max(0, findCol(norms, ["categoria","rubrica","conta","descricao","item","tributo","receita","nome"]));
      const typeCol = findCol(norms, ["tipo","natureza","classificacao"]);
      const yrCol = findCol(norms, ["ano","exercicio","year"]);
      for (const r of dataRows) {
        const cat = String(r[catCol] ?? "").trim();
        if (!cat || normText(cat).startsWith("total")) continue;
        let rYr = fileYear;
        if (yrCol >= 0) { const y = parseNum(r[yrCol]); if (y && y >= 2000 && y <= 2100) rYr = Math.floor(y); }
        const rawT = typeCol >= 0 ? r[typeCol] : cat;
        for (const [ci, mo] of monthCols) {
          const amt = parseNum(r[ci]);
          if (!amt) continue;
          const ym = norms[ci].match(/(202\d)/);
          const cy = ym ? Number(ym[1]) : rYr;
          out.push({
            date: `${cy}-${String(mo).padStart(2,"0")}-15`,
            type: classifyType(rawT, amt),
            category: cat,
            description: `${cat} (${String(mo).padStart(2,"0")}/${cy})`,
            amount: Math.abs(amt),
            target_amount: 0,
            status: "Realizado",
            source: sourceLabel,
            source_file_id: sourceFileId,
            is_demo: false
          });
        }
      }
      return out;
    }

    const cDate = findCol(norms, ["data","date","dt","competencia","periodo","vencimento"]);
    const cYear = findCol(norms, ["ano","exercicio","year"]);
    const cMon  = findCol(norms, ["mes","month","referencia"]);
    const cType = findCol(norms, ["tipo","natureza","movimento","classificacao","type"]);
    const cCat  = findCol(norms, ["categoria","rubrica","centro_de_custo","tributo","grupo","conta","category"]);
    const cDesc = findCol(norms, ["descricao","historico","detalhe","item","lancamento","nome","description"]);
    const cStat = findCol(norms, ["status","situacao","estado"]);
    const cAmt  = findCol(norms, ["valor_realizado","arrecadado","valor_arrecadado","realizado","valor","amount","total"]);
    const cRev  = findCol(norms, ["receita","receitas","arrecadacao","entrada","faturamento"]);
    const cExp  = findCol(norms, ["despesa","despesas","custo","gasto","saida"]);
    const cTgt  = findCol(norms, ["meta","meta_arrecadacao","valor_previsto","previsto","orcado","target","budget"]);
    const dual  = cRev >= 0 && cExp >= 0 && cRev !== cExp && cType < 0;

    for (const r of dataRows) {
      const f0 = normText(r[0]);
      if (["total","total_geral","subtotal","soma"].includes(f0)) continue;
      let rYr = fileYear;
      if (cYear >= 0) { const y = parseNum(r[cYear]); if (y && y >= 2000 && y <= 2100) rYr = Math.floor(y); }
      let rMo = null;
      if (cMon >= 0) {
        const mv = r[cMon]; const mn = normText(mv);
        if (MONTH_MAP[mn]) rMo = MONTH_MAP[mn];
        else { const n = parseNum(mv); if (n >= 1 && n <= 12) rMo = Math.floor(n); }
      }
      let dStr = parseDateVal(cDate >= 0 ? r[cDate] : null, rYr, rMo);
      if (!dStr && rMo) dStr = `${rYr}-${String(rMo).padStart(2,"0")}-15`;
      if (!dStr) continue;

      const cat = (cCat >= 0 && String(r[cCat] ?? "").trim()) || "Arrecadação Geral";
      const desc = (cDesc >= 0 && String(r[cDesc] ?? "").trim()) || "";
      const status = (cStat >= 0 && String(r[cStat] ?? "").trim()) || "Realizado";
      const tgt = Math.abs(parseNum(cTgt >= 0 ? r[cTgt] : 0) || 0);

      if (dual) {
        const rv = parseNum(r[cRev]);
        const ev = parseNum(r[cExp]);
        if (rv) out.push({ date:dStr, type:"receita", category:cat, description:desc||`Arrecadação — ${cat}`, amount:Math.abs(rv), target_amount:tgt, status, source:sourceLabel, source_file_id:sourceFileId, is_demo:false });
        if (ev) out.push({ date:dStr, type:"despesa", category:cat==="Arrecadação Geral"?"Despesas Operacionais":cat, description:desc||`Despesa — ${cat}`, amount:Math.abs(ev), target_amount:0, status, source:sourceLabel, source_file_id:sourceFileId, is_demo:false });
      } else {
        const idx = cAmt >= 0 ? cAmt : (cRev >= 0 ? cRev : cExp);
        const amt = parseNum(idx >= 0 ? r[idx] : null);
        if (amt === null) continue;
        let rt = cType >= 0 ? r[cType] : (idx === cExp ? "despesa" : "receita");
        const tp = classifyType(rt, amt);
        out.push({
          date: dStr, type: tp, category: cat,
          description: desc || `${tp === "receita" ? "Receita" : "Despesa"} — ${cat}`,
          amount: Math.abs(amt), target_amount: tp === "receita" ? tgt : 0,
          status, source: sourceLabel, source_file_id: sourceFileId, is_demo: false
        });
      }
    }
    return out;
  }

  // CSV Parser
  function parseCsvText(text) {
    const sample = text.slice(0, 4096);
    let delim = (sample.match(/;/g)||[]).length >= (sample.match(/,/g)||[]).length ? ";" : ",";
    if ((sample.match(/\t/g)||[]).length > Math.max((sample.match(/;/g)||[]).length, (sample.match(/,/g)||[]).length)) delim = "\t";
    const rows = [];
    let row = [], cell = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"' && text[i+1] === '"') { cell += '"'; i++; }
        else if (ch === '"') inQ = false;
        else cell += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === delim) { row.push(cell); cell = ""; }
        else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
        else cell += ch;
      }
    }
    if (cell.length || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
    return rows;
  }

  // XLSX Native ZIP + XML Parser
  async function inflateRaw(u8) {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    writer.write(u8);
    writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function unzipEntries(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const u8 = new Uint8Array(arrayBuffer);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65558); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Arquivo .xlsx inválido.");
    const cdCount = dv.getUint16(eocd + 10, true);
    let offset = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder("utf-8");
    const map = {};
    for (let i = 0; i < cdCount; i++) {
      if (dv.getUint32(offset, true) !== 0x02014b50) break;
      const compMethod = dv.getUint16(offset + 10, true);
      const compSize = dv.getUint32(offset + 20, true);
      const nameLen = dv.getUint16(offset + 28, true);
      const extraLen = dv.getUint16(offset + 30, true);
      const commentLen = dv.getUint16(offset + 32, true);
      const lfhOffset = dv.getUint32(offset + 42, true);
      const name = dec.decode(u8.subarray(offset + 46, offset + 46 + nameLen));
      offset += 46 + nameLen + extraLen + commentLen;

      if (!name.endsWith(".xml")) continue;
      const lNameLen = dv.getUint16(lfhOffset + 26, true);
      const lExtraLen = dv.getUint16(lfhOffset + 28, true);
      const dataStart = lfhOffset + 30 + lNameLen + lExtraLen;
      const rawSlice = u8.subarray(dataStart, dataStart + compSize);
      let contentBytes;
      if (compMethod === 0) contentBytes = rawSlice;
      else if (compMethod === 8) contentBytes = await inflateRaw(rawSlice);
      else continue;
      map[name] = dec.decode(contentBytes);
    }
    return map;
  }

  function colLettersToIdx(letters) {
    let n = 0;
    for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  async function parseXlsxFile(file, defYear, sourceLabel, sourceFileId) {
    const buf = await file.arrayBuffer();
    const xmlMap = await unzipEntries(buf);
    const dp = new DOMParser();

    const sharedStrings = [];
    if (xmlMap["xl/sharedStrings.xml"]) {
      const ssDoc = dp.parseFromString(xmlMap["xl/sharedStrings.xml"], "application/xml");
      ssDoc.querySelectorAll("si").forEach(si => {
        sharedStrings.push(Array.from(si.querySelectorAll("t")).map(t => t.textContent || "").join(""));
      });
    }

    const sheetKeys = Object.keys(xmlMap).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/i.test(k)).sort();
    const all = [];
    for (const sk of sheetKeys) {
      const doc = dp.parseFromString(xmlMap[sk], "application/xml");
      const matrix = [];
      doc.querySelectorAll("sheetData > row").forEach(rowEl => {
        const rowArr = [];
        rowEl.querySelectorAll("c").forEach(cEl => {
          const ref = cEl.getAttribute("r") || "";
          const m = ref.match(/^([A-Z]+)/);
          const ci = m ? colLettersToIdx(m[1]) : rowArr.length;
          const t = cEl.getAttribute("t") || "";
          let val = null;
          if (t === "s") {
            const vEl = cEl.querySelector("v");
            val = vEl ? sharedStrings[Number(vEl.textContent)] ?? "" : "";
          } else if (t === "inlineStr") {
            val = Array.from(cEl.querySelectorAll("t")).map(x => x.textContent || "").join("");
          } else {
            const vEl = cEl.querySelector("v");
            if (vEl) {
              const raw = vEl.textContent || "";
              val = (t === "str" || t === "b") ? raw : (isNaN(Number(raw)) ? raw : Number(raw));
            }
          }
          rowArr[ci] = val;
        });
        matrix.push(rowArr);
      });
      all.push(...parseTabularMatrix(matrix, file.name, sourceLabel, sourceFileId, defYear));
    }
    return all;
  }

  // PDF Financial Data Extractor (using bundled Mozilla PDF.js)
  async function extractLinesFromPdf(arrayBuffer) {
    if (!window.pdfjsLib) throw new Error("Biblioteca PDF.js não carregada.");
    const doc = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const allLines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const rows = [];
      for (const item of tc.items) {
        const str = (item.str || "").trim();
        if (!str) continue;
        const x = item.transform[4];
        const y = item.transform[5];
        let bucket = rows.find(r => Math.abs(r.y - y) <= 4.5);
        if (!bucket) { bucket = { y, cells: [] }; rows.push(bucket); }
        bucket.cells.push({ x, str });
      }
      rows.sort((a, b) => b.y - a.y);
      for (const r of rows) {
        r.cells.sort((a, b) => a.x - b.x);
        // Join cells preserving multi-space gaps as column delimiters
        let line = "";
        const cols = [];
        let curCol = "";
        let prevX = null;
        for (const c of r.cells) {
          if (prevX !== null && (c.x - prevX) > 22) {
            if (curCol.trim()) cols.push(curCol.trim());
            curCol = c.str;
            line += "  |  " + c.str;
          } else {
            curCol = curCol ? `${curCol} ${c.str}` : c.str;
            line = line ? `${line} ${c.str}` : c.str;
          }
          prevX = c.x + (c.str.length * 4.5);
        }
        if (curCol.trim()) cols.push(curCol.trim());
        allLines.push({ page: p, text: line.trim(), cols });
      }
    }
    return allLines;
  }

  function parsePdfFinancialLines(lines, filename, defYear) {
    const fullText = lines.map(l => l.text).join("\n");
    const yearMatch = (filename || "").match(/(202\d)/) || fullText.match(/\b(202[4-6])\b/);
    const fallbackYear = defYear || (yearMatch ? Number(yearMatch[1]) : new Date().getFullYear());

    // Match Brazilian monetary values: R$ 1.234,56 | -R$ 450,00 | (1.200,50) | 12.345,67 | 450,00
    const moneyRe = /(?:\(\s*)?(?:[-−+]\s*)?(?:R\$\s*)?(?:\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(?:\s*\))?/g;
    const dateFullRe = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})\b/;
    const monthYearRe = /\b(jan(?:eiro)?|fev(?:ereiro)?|mar(?:[cç]o)?|abr(?:il)?|mai(?:o)?|jun(?:ho)?|jul(?:ho)?|ago(?:sto)?|set(?:embro)?|out(?:ubro)?|nov(?:embro)?|dez(?:embro)?)\s*[/-]?\s*(202\d)?\b/i;

    const extracted = [];
    let currentSectionType = null;
    let inSummarySkip = false;

    for (const lineObj of lines) {
      const raw = lineObj.text;
      const norm = normText(raw);
      if (!raw || raw.length < 6) continue;

      // Ignore headers, footers, page numbers, KPI summary totals
      if (/^(pagina|page|gerado_em|periodo|total_geral|subtotal|resumo_executivo)/.test(norm)) continue;
      if (/\b(total\s+geral|subtotal|arrecadacao\s+total|despesas\s+totais|saldo\s+liquido|meta\s+de\s+arrecadacao|comparativo\s+consolidado)\b/i.test(raw.normalize("NFKD").replace(/[\u0300-\u036f]/g,""))) {
        inSummarySkip = true;
        continue;
      }
      if (/lancamentos\s+financeiros|extrato|movimentac|data.*tipo.*categoria|data.*descricao.*valor/i.test(raw.normalize("NFKD").replace(/[\u0300-\u036f]/g,""))) {
        inSummarySkip = false;
        continue;
      }
      if (/^receitas?\b/i.test(raw) && !raw.match(moneyRe)) { currentSectionType = "receita"; continue; }
      if (/^despesas?\b/i.test(raw) && !raw.match(moneyRe)) { currentSectionType = "despesa"; continue; }

      const moneyMatches = raw.match(moneyRe) || [];
      if (!moneyMatches.length) continue;

      // Extract date from row
      let dateStr = null;
      const dm = raw.match(dateFullRe);
      if (dm) {
        dateStr = parseDateVal(dm[1], fallbackYear, null);
      } else if (!inSummarySkip) {
        const mm = raw.match(monthYearRe);
        if (mm) {
          const moKey = normText(mm[1]);
          const mo = MONTH_MAP[moKey];
          const yr = mm[2] ? Number(mm[2]) : fallbackYear;
          if (mo) dateStr = `${yr}-${String(mo).padStart(2,"0")}-15`;
        }
      }
      if (!dateStr) continue;

      // Parse monetary values
      const parsedVals = moneyMatches.map(parseNum).filter(v => v !== null && Math.abs(v) > 0);
      if (!parsedVals.length) continue;

      const primaryAmt = parsedVals[0];
      const secondaryAmt = parsedVals.length >= 2 ? Math.abs(parsedVals[1]) : 0;

      // Clean text to isolate type, category, description
      const cleanCols = lineObj.cols
        .map(c => c.replace(dateFullRe, "").replace(moneyRe, "").replace(/^[-–—|]+|[-–—|]+$/g, "").trim())
        .filter(Boolean);

      let recType = currentSectionType || classifyType(raw, primaryAmt);
      let category = "Importado via PDF";
      let description = "";

      // If structured columns exist (e.g. [Tipo, Categoria, Descrição])
      const filteredCols = cleanCols.filter(c => !/^(receita|despesa|realizado|previsto|pendente)$/i.test(c));
      if (cleanCols.some(c => /^despesa$/i.test(c))) recType = "despesa";
      else if (cleanCols.some(c => /^receita$/i.test(c))) recType = "receita";

      if (filteredCols.length >= 2) {
        category = filteredCols[0].slice(0, 48);
        description = filteredCols.slice(1).join(" — ").slice(0, 120);
      } else if (filteredCols.length === 1) {
        description = filteredCols[0].slice(0, 120);
        // Infer clean category from keywords
        const nDesc = normText(description);
        if (/tributo|imposto|iptu|iss|icms/.test(nDesc)) category = "Tributos";
        else if (/servico|taxa/.test(nDesc)) category = "Serviços e Taxas";
        else if (/convenio|repasse/.test(nDesc)) category = "Convênios e Repasses";
        else if (/folha|salario|encargo/.test(nDesc)) category = "Folha e Encargos";
        else if (/custo|operacional|aluguel|energia|manutencao/.test(nDesc)) category = "Custos Operacionais";
        else category = recType === "receita" ? "Arrecadação (PDF)" : "Despesas (PDF)";
      } else {
        description = `${recType === "receita" ? "Receita" : "Despesa"} extraída de ${filename}`;
      }

      extracted.push({
        checked: true,
        date: dateStr,
        type: recType,
        category,
        description,
        amount: Math.abs(primaryAmt),
        target_amount: recType === "receita" ? secondaryAmt : 0,
        status: "Realizado"
      });
    }

    return { extracted, rawText: fullText };
  }

  function openPdfReviewModal(filename, fid, extracted, rawText) {
    ui.pdfPending = { filename, fid, rows: extracted };
    $("pdf-prev-title").textContent = `Revisar Dados Extraídos do PDF — ${filename}`;
    $("pdf-prev-sub").textContent = extracted.length
      ? `${extracted.length} lançamento(s) identificado(s) automaticamente. Ajuste qualquer campo se necessário e confirme.`
      : "Nenhuma linha com data + valor R$ foi detectada automaticamente (o PDF pode ser imagem escaneada). Confira o texto bruto abaixo.";
    $("pdf-raw-text").textContent = rawText || "(Nenhum texto selecionável encontrado no PDF.)";
    renderPdfPreviewRows();
    $("m-pdf-preview").classList.add("open");
  }

  function renderPdfPreviewRows() {
    const tb = $("pdf-prev-tbody");
    const rows = ui.pdfPending?.rows || [];
    if (!rows.length) {
      tb.innerHTML = `<tr><td colspan="7" class="empty">Nenhum registro estruturado encontrado neste PDF. Verifique se o PDF possui texto selecionável (não escaneado como imagem).</td></tr>`;
      $("pdf-prev-count").textContent = "0 selecionado(s)";
      $("m-pdf-confirm").disabled = true;
      return;
    }

    const selCount = rows.filter(r => r.checked).length;
    $("pdf-prev-count").textContent = `${selCount} de ${rows.length} selecionado(s)`;
    $("m-pdf-confirm").disabled = selCount === 0;

    tb.innerHTML = rows.map((r, i) => `
      <tr>
        <td><input type="checkbox" class="cb p-chk" data-i="${i}" ${r.checked ? "checked" : ""} /></td>
        <td><input type="date" class="inline-input num p-date" data-i="${i}" value="${esc(r.date)}" /></td>
        <td>
          <select class="inline-input p-type" data-i="${i}">
            <option value="receita" ${r.type==="receita"?"selected":""}>Receita</option>
            <option value="despesa" ${r.type==="despesa"?"selected":""}>Despesa</option>
          </select>
        </td>
        <td><input type="text" class="inline-input p-cat" data-i="${i}" value="${esc(r.category)}" /></td>
        <td><input type="text" class="inline-input p-desc" data-i="${i}" value="${esc(r.description)}" /></td>
        <td><input type="number" step="0.01" min="0" class="inline-input num p-amt" data-i="${i}" value="${r.amount}" /></td>
        <td><input type="number" step="0.01" min="0" class="inline-input num p-tgt" data-i="${i}" value="${r.target_amount}" /></td>
      </tr>
    `).join("");

    tb.querySelectorAll(".p-chk").forEach(el => el.onchange = e => {
      rows[Number(e.target.dataset.i)].checked = e.target.checked;
      const sc = rows.filter(r => r.checked).length;
      $("pdf-prev-count").textContent = `${sc} de ${rows.length} selecionado(s)`;
      $("m-pdf-confirm").disabled = sc === 0;
    });
    tb.querySelectorAll(".p-date").forEach(el => el.onchange = e => { rows[Number(e.target.dataset.i)].date = e.target.value; });
    tb.querySelectorAll(".p-type").forEach(el => el.onchange = e => { rows[Number(e.target.dataset.i)].type = e.target.value; });
    tb.querySelectorAll(".p-cat").forEach(el => el.oninput = e => { rows[Number(e.target.dataset.i)].category = e.target.value; });
    tb.querySelectorAll(".p-desc").forEach(el => el.oninput = e => { rows[Number(e.target.dataset.i)].description = e.target.value; });
    tb.querySelectorAll(".p-amt").forEach(el => el.oninput = e => { rows[Number(e.target.dataset.i)].amount = parseFloat(e.target.value || "0") || 0; });
    tb.querySelectorAll(".p-tgt").forEach(el => el.oninput = e => { rows[Number(e.target.dataset.i)].target_amount = parseFloat(e.target.value || "0") || 0; });
  }

  function confirmPdfImport() {
    if (!ui.pdfPending) return;
    const { filename, fid, rows } = ui.pdfPending;
    const chosen = rows.filter(r => r.checked && r.date && r.amount > 0);
    if (!chosen.length) { toast("Nenhum registro válido selecionado.", true); return; }

    store.records = store.records.filter(r => r.source_file_id !== fid);
    for (const r of chosen) {
      store.records.push({
        id: store.nextId++,
        date: r.date,
        year: Number(r.date.slice(0,4)),
        month: Number(r.date.slice(5,7)),
        type: r.type,
        category: r.category.trim() || "Importado via PDF",
        description: r.description.trim() || `Lançamento (${filename})`,
        amount: Number(r.amount),
        target_amount: r.type === "receita" ? Number(r.target_amount || 0) : 0,
        status: "Realizado",
        source: `PDF: ${filename}`,
        source_file_id: fid,
        is_demo: false
      });
    }
    store.files = store.files.filter(f => f.file_id !== fid);
    store.files.unshift({
      file_id: fid,
      file_name: filename,
      source_type: "pdf",
      row_count: chosen.length,
      synced_at: new Date().toISOString()
    });
    saveStore();
    $("m-pdf-preview").classList.remove("open");
    ui.pdfPending = null;
    toast(`${chosen.length} lançamento(s) importado(s) do PDF "${filename}"!`);
    refreshAll();
  }

  // Unified Upload Handler (.xlsx, .csv, .pdf)
  async function handleFilesUpload(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const defYearVal = $("up-year").value ? Number($("up-year").value) : null;
    let totalImported = 0;

    for (const f of files) {
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      const fid = `upload:${ext}:${f.name}:${f.size}`;
      const label = `Upload: ${f.name}`;
      try {
        if (ext === "pdf") {
          toast(`Lendo PDF "${f.name}"...`);
          const ab = await f.arrayBuffer();
          const lines = await extractLinesFromPdf(ab);
          const { extracted, rawText } = parsePdfFinancialLines(lines, f.name, defYearVal);
          openPdfReviewModal(f.name, fid, extracted, rawText);
          continue;
        }

        let parsed = [];
        if (ext === "xlsx" || ext === "xlsm") {
          parsed = await parseXlsxFile(f, defYearVal, label, fid);
        } else if (ext === "csv" || ext === "tsv" || ext === "txt") {
          let txt = await f.text();
          if (txt.includes("\uFFFD")) {
            const ab = await f.arrayBuffer();
            txt = new TextDecoder("windows-1252").decode(ab);
          }
          parsed = parseTabularMatrix(parseCsvText(txt), f.name, label, fid, defYearVal);
        } else {
          toast(`Formato não suportado: ${f.name}. Use .xlsx, .csv ou .pdf.`, true);
          continue;
        }

        if (parsed.length) {
          store.records = store.records.filter(r => r.source_file_id !== fid);
          for (const item of parsed) {
            item.id = store.nextId++;
            item.year = Number(item.date.slice(0,4));
            item.month = Number(item.date.slice(5,7));
            store.records.push(item);
          }
          store.files = store.files.filter(x => x.file_id !== fid);
          store.files.unshift({
            file_id: fid,
            file_name: f.name,
            source_type: ext === "xlsx" || ext === "xlsm" ? "xlsx" : "csv",
            row_count: parsed.length,
            synced_at: new Date().toISOString()
          });
          totalImported += parsed.length;
        } else {
          toast(`Nenhum registro financeiro reconhecido em "${f.name}".`, true);
        }
      } catch (err) {
        toast(`Erro ao processar "${f.name}": ${err.message}`, true);
      }
    }

    if (totalImported > 0) {
      saveStore();
      toast(`${totalImported} lançamento(s) importado(s) com sucesso!`);
      refreshAll();
    }
    $("file-picker").value = "";
  }

  // Google Sheets / Drive Live Sync (direct CSV endpoint fetch)
  function toGoogleCsvUrl(rawUrl) {
    const u = rawUrl.trim();
    if (!u) return null;
    if (u.includes("output=csv") || u.includes("tqx=out:csv") || u.includes("format=csv")) return { url: u, id: u.slice(-24) };
    const m = u.match(/spreadsheets\/d\/([a-zA-Z0-9_-]{15,})/);
    if (m) {
      const gidM = u.match(/gid=(\d+)/);
      const gidPart = gidM ? `&gid=${gidM[1]}` : "";
      return { url: `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv${gidPart}`, id: m[1] };
    }
    return null;
  }

  async function syncGoogleDriveLinks(silent = false) {
    const raw = (store.driveLinks || "").trim();
    if (!raw) {
      if (!silent) toast("Cole ao menos um link de Planilha Google do Drive para sincronizar.", true);
      return;
    }
    const lines = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    let syncedCount = 0, totalRows = 0, errors = [];

    for (const line of lines) {
      const target = toGoogleCsvUrl(line);
      if (!target) {
        errors.push(`Link não é uma Planilha Google direta (dica: abra a planilha no Drive ou compartilhe com 'Qualquer pessoa com o link pode ver').`);
        continue;
      }
      try {
        const res = await fetch(target.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const csvText = await res.text();
        if (csvText.trim().startsWith("<!DOCTYPE") || csvText.trim().startsWith("<html")) {
          throw new Error("Planilha privada — ative 'Qualquer pessoa com o link: Leitor' ou 'Publicar na Web (CSV)'.");
        }
        const fid = `drive:${target.id}`;
        const label = `Google Drive (${target.id.slice(0,8)})`;
        const parsed = parseTabularMatrix(parseCsvText(csvText), line, label, fid, null);
        if (parsed.length) {
          store.records = store.records.filter(r => r.source_file_id !== fid);
          for (const item of parsed) {
            item.id = store.nextId++;
            item.year = Number(item.date.slice(0,4));
            item.month = Number(item.date.slice(5,7));
            store.records.push(item);
          }
          store.files = store.files.filter(f => f.file_id !== fid);
          store.files.unshift({
            file_id: fid,
            file_name: `Google Drive — ${target.id.slice(0,12)}`,
            source_type: "drive",
            row_count: parsed.length,
            synced_at: new Date().toISOString()
          });
          syncedCount++;
          totalRows += parsed.length;
        }
      } catch (err) {
        errors.push(err.message);
      }
    }

    store.lastDriveSync = new Date().toISOString();
    saveStore();
    if (syncedCount > 0) {
      $("drv-status-title").textContent = `Google Drive sincronizado (${syncedCount} planilha(s))`;
      $("drv-status-txt").textContent = `${totalRows} lançamento(s) atualizado(s) em ${new Date().toLocaleTimeString("pt-BR")}.`;
      if (!silent) toast(`Google Drive sincronizado: ${totalRows} registro(s) atualizado(s)!`);
      refreshAll();
    } else if (!silent && errors.length) {
      $("drv-status-title").textContent = "Atenção na sincronização do Drive";
      $("drv-status-txt").textContent = errors[0];
      toast(errors[0], true);
    }
  }

  function restartDriveAutoSync() {
    if (ui.driveTimer) clearInterval(ui.driveTimer);
    if (store.driveAuto && store.driveLinks.trim()) {
      const ms = Math.max(30, Number(store.driveInterval || 60)) * 1000;
      ui.driveTimer = setInterval(() => syncGoogleDriveLinks(true), ms);
    }
  }

  // Analytics Engine
  function filterRecords(f) {
    return store.records
      .filter(r => {
        if (f.year && Number(r.year) !== Number(f.year)) return false;
        if (f.start && r.date < f.start) return false;
        if (f.end && r.date > f.end) return false;
        if (f.cat && f.cat !== "Todas" && r.category !== f.cat) return false;
        if (f.type && r.type !== f.type) return false;
        if (f.search) {
          const q = f.search.toLowerCase();
          if (!`${r.description} ${r.category} ${r.source} ${r.status}`.toLowerCase().includes(q)) return false;
        }
        return true;
      })
      .sort((a,b) => b.date.localeCompare(a.date) || b.id - a.id);
  }

  function computeAnalytics(recs, selYear) {
    const totalRev = recs.filter(r => r.type === "receita").reduce((s,r) => s + r.amount, 0);
    const totalExp = recs.filter(r => r.type === "despesa").reduce((s,r) => s + r.amount, 0);
    const saldo = totalRev - totalExp;
    const margin = totalRev > 0 ? (saldo / totalRev) * 100 : 0;

    const yrsPresent = Array.from(new Set(recs.map(r => r.year))).sort();
    const dispYears = selYear ? [Number(selYear)] : (yrsPresent.length ? yrsPresent : [2024, 2025, 2026]);

    const recTargetSum = recs.filter(r => r.type === "receita").reduce((s,r) => s + (r.target_amount || 0), 0);
    const cfgTargetSum = dispYears.reduce((s,y) => s + Number(store.targets[y] || 0), 0);

    let totalMeta = 0, metaSrc = "Não definida";
    if (recTargetSum > 0) { totalMeta = recTargetSum; metaSrc = "Planilhas / Lançamentos"; }
    else if (cfgTargetSum > 0) { totalMeta = cfgTargetSum; metaSrc = "Metas Anuais Configuradas"; }

    const attPct = totalMeta > 0 ? (totalRev / totalMeta) * 100 : 0;
    const gap = totalMeta > 0 ? totalRev - totalMeta : 0;

    const buckets = new Map();
    for (const r of recs) {
      const k = `${r.year}-${String(r.month).padStart(2,"0")}`;
      if (!buckets.has(k)) buckets.set(k, { year:r.year, month:r.month, rev:0, exp:0, recTgt:0 });
      const b = buckets.get(k);
      if (r.type === "receita") { b.rev += r.amount; b.recTgt += (r.target_amount || 0); }
      else b.exp += r.amount;
    }

    const monthly = [];
    const addMonthItem = (yr, mo, b) => {
      const mMeta = b.recTgt > 0 ? b.recTgt : (Number(store.targets[yr] || 0) / 12);
      monthly.push({
        year: yr, month: mo,
        label: `${MONTHS_PT[mo-1]}/${String(yr).slice(2)}`,
        rev: b.rev, exp: b.exp, meta: mMeta,
        desvio: mMeta > 0 ? b.rev - mMeta : 0,
        att: mMeta > 0 ? (b.rev / mMeta) * 100 : 0
      });
    };

    if (selYear) {
      const y = Number(selYear);
      for (let mo = 1; mo <= 12; mo++) {
        const k = `${y}-${String(mo).padStart(2,"0")}`;
        addMonthItem(y, mo, buckets.get(k) || { year:y, month:mo, rev:0, exp:0, recTgt:0 });
      }
    } else {
      Array.from(buckets.keys()).sort().forEach(k => {
        const b = buckets.get(k);
        addMonthItem(b.year, b.month, b);
      });
    }

    const annual = [2024, 2025, 2026].map(yr => {
      const yrRecs = store.records.filter(r => r.year === yr);
      const rev = yrRecs.filter(r => r.type === "receita").reduce((s,r) => s + r.amount, 0);
      const exp = yrRecs.filter(r => r.type === "despesa").reduce((s,r) => s + r.amount, 0);
      const rt = yrRecs.filter(r => r.type === "receita").reduce((s,r) => s + (r.target_amount || 0), 0);
      const meta = rt > 0 ? rt : Number(store.targets[yr] || 0);
      const mArr = new Array(12).fill(0);
      yrRecs.filter(r => r.type === "receita").forEach(r => mArr[r.month - 1] += r.amount);
      const mCnt = mArr.filter(v => v > 0).length;
      return { year:yr, rev, exp, saldo:rev-exp, meta, att: meta>0?(rev/meta)*100:0, mCnt, mArr };
    });

    let yoy = null;
    const refY = selYear ? Number(selYear) : (yrsPresent.length ? Math.max(...yrsPresent) : null);
    const currA = annual.find(a => a.year === refY);
    const prevA = annual.find(a => a.year === (refY - 1));
    if (currA && prevA && currA.rev > 0 && prevA.rev > 0) {
      const prevBase = (currA.mCnt < prevA.mCnt && currA.mCnt > 0)
        ? prevA.mArr.slice(0, currA.mCnt).reduce((s,v)=>s+v, 0)
        : prevA.rev;
      if (prevBase > 0) yoy = ((currA.rev - prevBase) / prevBase) * 100;
    }

    const cMap = new Map(), eMap = new Map();
    for (const r of recs) {
      if (r.type === "receita") {
        const cur = cMap.get(r.category) || { cat:r.category, rev:0, meta:0, cnt:0 };
        cur.rev += r.amount; cur.meta += (r.target_amount||0); cur.cnt++;
        cMap.set(r.category, cur);
      } else {
        const cur = eMap.get(r.category) || { cat:r.category, exp:0, cnt:0 };
        cur.exp += r.amount; cur.cnt++;
        eMap.set(r.category, cur);
      }
    }
    const revCats = Array.from(cMap.values()).sort((a,b) => b.rev - a.rev).map(c => ({
      ...c, gap: c.meta > 0 ? c.rev - c.meta : 0,
      att: c.meta > 0 ? (c.rev / c.meta) * 100 : 0,
      share: totalRev > 0 ? (c.rev / totalRev) * 100 : 0
    }));
    const expCats = Array.from(eMap.values()).sort((a,b) => b.exp - a.exp);

    const activeM = monthly.filter(m => m.rev > 0);
    const avgMonthly = activeM.length ? totalRev / activeM.length : 0;
    const projected = selYear ? avgMonthly * 12 : totalRev;

    const solutions = buildSolutions({ recs, monthly, activeM, revCats, expCats, totalRev, totalExp, totalMeta, gap, attPct, avgMonthly, selYear, annual });

    return {
      kpis: { totalRev, totalExp, saldo, margin, totalMeta, metaSrc, attPct, gap, avgMonthly, projected, yoy, activeMCount: activeM.length, count: recs.length },
      monthly, annual, revCats, expCats, solutions
    };
  }

  function buildSolutions({ recs, activeM, revCats, expCats, totalRev, totalExp, totalMeta, gap, attPct, avgMonthly, selYear, annual }) {
    if (!recs.length) {
      return {
        headline: "Aguardando dados financeiros reais para diagnóstico",
        summary: "Importe arquivos .xlsx, .csv ou .pdf, insira lançamentos manuais ou teste com a Base de Demonstração para visualizar o plano quantificado de aumento de arrecadação.",
        recs: []
      };
    }
    let headline, summary;
    if (totalMeta <= 0) {
      headline = "Configure a Meta de Arrecadação para ativar a correção automática";
      summary = `Arrecadação apurada de ${fmtBRL(totalRev)} (média de ${fmtBRL(avgMonthly)}/mês). Defina a meta anual na aba Soluções & Metas ou inclua a coluna Meta na planilha.`;
    } else if (gap < 0) {
      headline = `Déficit de ${fmtBRL(Math.abs(gap))} frente à meta (${fmtPct(attPct)} atingido)`;
      summary = `A arrecadação realizada (${fmtBRL(totalRev)}) está abaixo da meta (${fmtBRL(totalMeta)}). As soluções abaixo quantificam como recompor o resultado.`;
    } else {
      headline = `Meta superada em ${fmtBRL(gap)} (${fmtPct(attPct)} de atingimento)`;
      summary = `Arrecadação (${fmtBRL(totalRev)}) acima da meta (${fmtBRL(totalMeta)}). Priorize blindagem dos meses sazonais e ganho de margem líquida.`;
    }

    const list = [];
    if (totalMeta > 0 && gap < 0) {
      const remM = selYear ? Math.max(1, 12 - activeM.length) : 3;
      const reqM = selYear && activeM.length < 12 ? Math.max(0, totalMeta - totalRev) / remM : avgMonthly + Math.abs(gap) / 3;
      const lift = avgMonthly > 0 ? ((reqM - avgMonthly) / avgMonthly) * 100 : 0;
      list.push({
        priority: "Alta", horizon: "Imediato (30 dias)", tag: "Correção de Meta",
        title: `Elevar ritmo mensal de arrecadação em ${Math.max(0, lift).toFixed(1).replace(".",",")}%`,
        impact: Math.abs(gap),
        desc: `Para fechar o déficit de ${fmtBRL(Math.abs(gap))}, a média mensal precisa subir de ${fmtBRL(avgMonthly)} para ${fmtBRL(reqM)} nos próximos ${remM} mês(es). Intensifique cobrança ativa, regularização de inadimplentes e antecipação de recebíveis.`
      });
    }

    const defCats = revCats.filter(c => c.meta > 0 && c.gap < 0).sort((a,b) => a.gap - b.gap);
    if (defCats.length) {
      const w = defCats[0];
      const sumDef = defCats.slice(0,3).reduce((s,c) => s + Math.abs(c.gap), 0);
      const names = defCats.slice(0,3).map(c => `${c.cat} (${fmtBRL(c.gap)})`).join(", ");
      list.push({
        priority: "Alta", horizon: "Curto Prazo (30–60d)", tag: "Recuperação por Rubrica",
        title: `Atacar déficit em '${w.cat}' (${fmtPct(w.att)} da meta)`,
        impact: sumDef,
        desc: `Rubricas com maior desvio negativo: ${names}. Recompor apenas estas fontes ao valor orçado recupera ${fmtBRL(sumDef)} diretamente na arrecadação.`
      });
    }

    if (revCats.length) {
      const top = revCats[0];
      const gain = top.rev * 0.08;
      list.push({
        priority: gap < 0 ? "Alta" : "Média", horizon: "Curto Prazo (60d)", tag: "Alavanca Pareto",
        title: `Expandir principal fonte '${top.cat}' (${fmtPct(top.share)} da receita)`,
        impact: gain,
        desc: `'${top.cat}' responde por ${fmtPct(top.share)} da arrecadação total (${fmtBRL(top.rev)}). Um incremento de +8% via revisão de base, redução de evasão ou campanhas de adimplência adiciona ${fmtBRL(gain)}.`
      });
    }

    if (activeM.length >= 3 && avgMonthly > 0) {
      const weak = activeM.filter(m => m.rev < avgMonthly * 0.90).sort((a,b) => a.rev - b.rev);
      if (weak.length) {
        const w = weak[0];
        const drop = (1 - w.rev / avgMonthly) * 100;
        const recEst = weak.slice(0,3).reduce((s,m) => s + (avgMonthly - m.rev) * 0.6, 0);
        list.push({
          priority: "Média", horizon: "Trimestral", tag: "Correção Sazonal",
          title: `Mitigar vale sazonal em ${w.label} (-${drop.toFixed(1).replace(".",",")}% da média)`,
          impact: recEst,
          desc: `Meses abaixo de 90% da média (${weak.slice(0,3).map(m=>m.label).join(", ")}). Ações preventivas de parcelamento regular e incentivos de pagamento antecipado podem recuperar ~${fmtBRL(recEst)}.`
        });
      }
    }

    if (totalRev > 0 && totalExp > 0) {
      const ratio = (totalExp / totalRev) * 100;
      if (ratio > 65 && expCats.length) {
        const topE = expCats[0];
        const save = topE.exp * 0.10;
        list.push({
          priority: ratio > 80 ? "Alta" : "Média", horizon: "Curto Prazo (45d)", tag: "Eficiência Operacional",
          title: `Otimizar despesas (${fmtPct(ratio)} da arrecadação comprometida)`,
          impact: save,
          desc: `Maior rubrica de despesa: '${topE.cat}' (${fmtBRL(topE.exp)}). Renegociar contratos e otimizar 10% preserva ${fmtBRL(save)} diretamente no saldo líquido.`
        });
      }
    }

    const activeYears = annual.filter(a => a.rev > 0);
    if (activeYears.length >= 2) {
      const p = activeYears[activeYears.length - 2], c = activeYears[activeYears.length - 1];
      const a1 = p.rev / Math.max(1, p.mCnt), a2 = c.rev / Math.max(1, c.mCnt);
      const delta = a1 > 0 ? ((a2 - a1) / a1) * 100 : 0;
      list.push({
        priority: delta < 0 ? "Alta" : "Média", horizon: "Estrutural", tag: `Tendência ${p.year} → ${c.year}`,
        title: delta < 0 ? `Reverter queda média mensal de ${Math.abs(delta).toFixed(1).replace(".",",")}%` : `Sustentar expansão média de +${delta.toFixed(1).replace(".",",")}%`,
        impact: Math.abs(a2 - a1) * 12,
        desc: `A média mensal passou de ${fmtBRL(a1)} (${p.year}) para ${fmtBRL(a2)} (${c.year}). ${delta < 0 ? "Auditar evasão de base e revisar régua de cobrança estanca a perda anualizada." : "Replicar boas práticas das categorias líderes consolida o avanço da meta."}`
      });
    }

    return { headline, summary, recs: list };
  }

  // Canvas Charts
  function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(300, rect.width || 600);
    const h = Math.max(220, rect.height || 280);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    return { ctx, w, h };
  }

  function fmtAxisK(v) {
    const a = Math.abs(v), s = v < 0 ? "-" : "";
    if (a >= 1e6) return `${s}R$ ${(a/1e6).toFixed(1)}M`;
    if (a >= 1e3) return `${s}R$ ${(a/1e3).toFixed(0)}k`;
    return `${s}R$ ${a.toFixed(0)}`;
  }

  function drawMonthlyChart(ms) {
    const canvas = $("c-monthly");
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    ui.chartHit.monthly = [];

    if (!ms.length) {
      ctx.fillStyle = "#867c77"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Sem dados mensais no período selecionado", w/2, h/2);
      return;
    }

    const pad = { t: 18, r: 18, b: 42, l: 74 };
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const maxVal = Math.max(100, ...ms.map(m => Math.max(m.rev, m.exp, m.meta))) * 1.12;

    ctx.strokeStyle = "rgba(255,240,232,0.08)"; ctx.lineWidth = 1;
    ctx.fillStyle = "#9d928c"; ctx.font = "11px monospace"; ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ch - (ch * i / 4);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(fmtAxisK(maxVal * i / 4), pad.l - 8, y + 4);
    }

    const slot = cw / ms.length;
    const bw = Math.max(5, Math.min(24, slot * 0.34));
    const stepLbl = Math.max(1, Math.ceil(ms.length / 12));

    ms.forEach((m, i) => {
      const cx = pad.l + slot * i + slot / 2;
      const rH = (m.rev / maxVal) * ch;
      const eH = (m.exp / maxVal) * ch;

      ctx.fillStyle = "rgba(245, 171, 110, 0.88)";
      ctx.beginPath(); ctx.roundRect(cx - bw - 1.5, pad.t + ch - rH, bw, rH, [4, 4, 0, 0]); ctx.fill();

      ctx.fillStyle = "rgba(240, 123, 113, 0.36)"; ctx.strokeStyle = "#f07b71"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(cx + 1.5, pad.t + ch - eH, bw, eH, [4, 4, 0, 0]); ctx.fill();
      if (eH > 1) ctx.stroke();

      if (i % stepLbl === 0) {
        ctx.fillStyle = "#a89d97"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(m.label, cx, h - 14);
      }
      ui.chartHit.monthly.push({ x1: pad.l + slot * i, x2: pad.l + slot * (i + 1), item: m });
    });

    if (ms.some(m => m.meta > 0)) {
      ctx.strokeStyle = "#f07b71"; ctx.lineWidth = 2.4; ctx.beginPath();
      ms.forEach((m, i) => {
        const cx = pad.l + slot * i + slot / 2;
        const my = pad.t + ch - (m.meta / maxVal) * ch;
        if (i === 0) ctx.moveTo(cx, my); else ctx.lineTo(cx, my);
      });
      ctx.stroke();

      ms.forEach((m, i) => {
        const cx = pad.l + slot * i + slot / 2;
        const my = pad.t + ch - (m.meta / maxVal) * ch;
        ctx.fillStyle = "#f07b71"; ctx.beginPath(); ctx.arc(cx, my, 3.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#141216"; ctx.beginPath(); ctx.arc(cx, my, 1.5, 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  function drawAnnualChart(ac) {
    const canvas = $("c-annual");
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    ui.chartHit.annual = [];

    const pad = { t: 18, r: 16, b: 36, l: 74 };
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const maxVal = Math.max(100, ...ac.map(a => Math.max(a.rev, a.meta, a.exp))) * 1.15;

    ctx.strokeStyle = "rgba(255,240,232,0.08)"; ctx.lineWidth = 1;
    ctx.fillStyle = "#9d928c"; ctx.font = "11px monospace"; ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ch - (ch * i / 4);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(fmtAxisK(maxVal * i / 4), pad.l - 8, y + 4);
    }

    const slot = cw / ac.length;
    const bw = Math.min(34, slot * 0.22);
    ac.forEach((a, i) => {
      const cx = pad.l + slot * i + slot / 2;
      const bars = [
        { val: a.rev, fill: "#f5ab6e", stroke: null, dx: -bw - 4 },
        { val: a.meta, fill: "rgba(248,198,148,0.25)", stroke: "#f8c694", dx: 0 },
        { val: a.exp, fill: "rgba(240,123,113,0.72)", stroke: null, dx: bw + 4 }
      ];
      bars.forEach(b => {
        const bh = (b.val / maxVal) * ch;
        ctx.fillStyle = b.fill;
        ctx.beginPath(); ctx.roundRect(cx + b.dx - bw/2, pad.t + ch - bh, bw, bh, [5, 5, 0, 0]); ctx.fill();
        if (b.stroke && bh > 1) { ctx.strokeStyle = b.stroke; ctx.lineWidth = 1.4; ctx.stroke(); }
      });
      ctx.fillStyle = "#e6dcd6"; ctx.font = "600 12px sans-serif"; ctx.textAlign = "center";
      ctx.fillText(String(a.year), cx, h - 12);
      ui.chartHit.annual.push({ x1: pad.l + slot * i, x2: pad.l + slot * (i + 1), item: a });
    });
  }

  function drawDeviationChart(ms) {
    const canvas = $("c-dev");
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);
    ui.chartHit.dev = [];

    if (!ms.length) {
      ctx.fillStyle = "#867c77"; ctx.font = "13px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Defina metas ou importe dados para ver os desvios mensais", w/2, h/2);
      return;
    }

    const pad = { t: 18, r: 16, b: 36, l: 74 };
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const maxAbs = Math.max(100, ...ms.map(m => Math.abs(m.desvio))) * 1.18;
    const zeroY = pad.t + ch / 2;

    ctx.fillStyle = "#9d928c"; ctx.font = "11px monospace"; ctx.textAlign = "right";
    [-1, -0.5, 0, 0.5, 1].forEach(f => {
      const y = zeroY - (ch / 2) * f;
      ctx.strokeStyle = f === 0 ? "rgba(248,198,148,0.35)" : "rgba(255,240,232,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(fmtAxisK(maxAbs * f), pad.l - 8, y + 4);
    });

    const slot = cw / ms.length;
    const bw = Math.max(6, Math.min(30, slot * 0.52));
    const stepLbl = Math.max(1, Math.ceil(ms.length / 12));
    ms.forEach((m, i) => {
      const cx = pad.l + slot * i + slot / 2;
      const bh = (Math.abs(m.desvio) / maxAbs) * (ch / 2);
      ctx.fillStyle = m.desvio < 0 ? "rgba(240, 123, 113, 0.85)" : "rgba(245, 171, 110, 0.88)";
      const y = m.desvio >= 0 ? zeroY - bh : zeroY;
      ctx.beginPath(); ctx.roundRect(cx - bw/2, y, bw, bh, m.desvio >= 0 ? [4,4,0,0] : [0,0,4,4]); ctx.fill();
      if (i % stepLbl === 0) {
        ctx.fillStyle = "#a89d97"; ctx.font = "11px sans-serif"; ctx.textAlign = "center";
        ctx.fillText(m.label, cx, h - 12);
      }
      ui.chartHit.dev.push({ x1: pad.l + slot * i, x2: pad.l + slot * (i + 1), item: m });
    });
  }

  function bindChartHover(canvasId, ttId, hitKey, htmlFn) {
    const canvas = $(canvasId), tt = $(ttId);
    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const hit = ui.chartHit[hitKey].find(h => x >= h.x1 && x <= h.x2);
      if (!hit) { tt.style.display = "none"; return; }
      tt.innerHTML = htmlFn(hit.item);
      tt.style.display = "block";
      const left = Math.min(rect.width - tt.offsetWidth - 10, Math.max(10, x + 12));
      tt.style.left = `${left}px`;
      tt.style.top = `14px`;
    });
    canvas.addEventListener("mouseleave", () => { tt.style.display = "none"; });
  }

  // Binary PDF 1.4 Report Exporter
  function toWinAnsi(str) {
    const s = String(str ?? "");
    let out = "";
    for (let i = 0; i < s.length; i++) {
      let code = s.charCodeAt(i);
      if (code === 0x2014 || code === 0x2013 || code === 0x2212) code = 0x2D;
      else if (code === 0x2022) code = 0xB7;
      else if (code === 0x2192) { out += "->"; continue; }
      else if (code > 255) code = 0x3F;
      const ch = String.fromCharCode(code);
      if (ch === "\\" || ch === "(" || ch === ")") out += "\\" + ch;
      else out += ch;
    }
    return out;
  }

  function wrapPdfText(text, maxChars) {
    const words = String(text ?? "").split(/\s+/);
    const lines = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length <= maxChars) cur = (cur + " " + w).trim();
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  function buildExecutivePdf({ title, periodLabel, analytics, recs, opts }) {
    const W = 595.28, H = 841.89, M = 40;
    const pages = [];
    let cmds = [];
    let y = H - M;

    const newPage = () => { if (cmds.length) pages.push(cmds.join("\n")); cmds = []; y = H - M; };
    const ensureSpace = (needed) => { if (y - needed < 56) newPage(); };
    const rgb = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return `${((n>>16)&255)/255} ${((n>>8)&255)/255} ${(n&255)/255}`;
    };
    const rect = (x, yBottom, w, h, fillHex, strokeHex = null) => {
      if (fillHex) cmds.push(`${rgb(fillHex)} rg ${x.toFixed(1)} ${yBottom.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f`);
      if (strokeHex) cmds.push(`${rgb(strokeHex)} RG 0.7 w ${x.toFixed(1)} ${yBottom.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re S`);
    };
    const txt = (x, yPos, str, size = 9, bold = false, colorHex = "#1B191E") => {
      cmds.push(`BT /${bold?"F2":"F1"} ${size} Tf ${rgb(colorHex)} rg ${x.toFixed(1)} ${yPos.toFixed(1)} Td (${toWinAnsi(str)}) Tj ET`);
    };

    rect(M, y - 54, W - 2*M, 54, "#141216");
    rect(M, y - 57, W - 2*M, 3, "#F5AB6E");
    txt(M + 14, y - 24, title, 15, true, "#FFFFFF");
    txt(M + 14, y - 41, `Periodo: ${periodLabel}   |   Gerado em: ${new Date().toLocaleString("pt-BR")}`, 8.5, false, "#F8C694");
    y -= 74;

    const k = analytics.kpis;
    txt(M, y, "1. RESUMO EXECUTIVO & INDICADORES FINANCEIROS", 10.5, true, "#141216");
    y -= 12;
    const boxW = (W - 2*M - 12) / 3, boxH = 44;
    const kpiCards = [
      ["ARRECADACAO TOTAL", fmtBRL(k.totalRev), `Media mensal: ${fmtBRL(k.avgMonthly)}`],
      ["META DE ARRECADACAO", fmtBRL(k.totalMeta), `Atingimento: ${k.totalMeta>0?fmtPct(k.attPct):"-"}`],
      ["DESVIO DA META (GAP)", k.totalMeta>0?fmtBRL(k.gap):"-", k.gap<0?"Deficit frente a meta":"Superavit / Sem deficit"],
      ["DESPESAS TOTAIS", fmtBRL(k.totalExp), `${k.count} lancamento(s)`],
      ["SALDO LIQUIDO", fmtBRL(k.saldo), `Margem: ${fmtPct(k.margin)}`],
      ["PROJECAO ANUAL", fmtBRL(k.projected), `Meses com dados: ${k.activeMCount}`]
    ];
    kpiCards.forEach((c, idx) => {
      const col = idx % 3, row = Math.floor(idx / 3);
      const bx = M + col * (boxW + 6), by = y - (row + 1) * boxH - row * 6;
      rect(bx, by, boxW, boxH, "#FAF6F3", "#E5D9D1");
      rect(bx, by + boxH - 2.5, boxW, 2.5, idx === 2 && k.gap < 0 ? "#F07B71" : "#F5AB6E");
      txt(bx + 8, by + 30, c[0], 7, true, "#7A6F6A");
      txt(bx + 8, by + 16, c[1], 11, true, "#141216");
      txt(bx + 8, by + 6, c[2], 7.2, false, "#D9655A");
    });
    y -= (boxH * 2 + 22);

    if (opts.annual && analytics.annual.some(a => a.rev > 0 || a.exp > 0)) {
      ensureSpace(95);
      txt(M, y, "2. COMPARATIVO CONSOLIDADO (2024 • 2025 • 2026)", 10.5, true, "#141216");
      y -= 16;
      rect(M, y - 16, W - 2*M, 16, "#141216");
      const cols = [M+8, M+58, M+162, M+262, M+336, M+430];
      ["ANO","ARRECADACAO","META","ATING.","DESPESAS","SALDO"].forEach((h,i) => txt(cols[i], y - 11, h, 7.5, true, "#F8C694"));
      y -= 16;
      analytics.annual.forEach((a, idx) => {
        rect(M, y - 16, W - 2*M, 16, idx % 2 ? "#FAF6F3" : "#FFFFFF", "#E8DDD6");
        [String(a.year), fmtBRL(a.rev), a.meta>0?fmtBRL(a.meta):"-", a.meta>0?fmtPct(a.att):"-", fmtBRL(a.exp), fmtBRL(a.saldo)]
          .forEach((v,i) => txt(cols[i], y - 11, v, 8, i===0, "#1B191E"));
        y -= 16;
      });
      y -= 16;
    }

    if (opts.solutions) {
      ensureSpace(80);
      txt(M, y, "3. DIAGNOSTICO & SOLUCOES PARA AUMENTO DE ARRECADACAO E META", 10.5, true, "#141216");
      y -= 14;
      const sol = analytics.solutions;
      const sumLines = wrapPdfText(sol.summary, 94);
      const callH = 22 + sumLines.length * 11;
      ensureSpace(callH + 10);
      rect(M, y - callH, W - 2*M, callH, "#FDF1E8", "#E8C8B4");
      rect(M, y - callH, 3.5, callH, "#F07B71");
      txt(M + 10, y - 13, sol.headline, 9.2, true, "#141216");
      sumLines.forEach((ln, i) => txt(M + 10, y - 25 - i * 11, ln, 8.2, false, "#3A3330"));
      y -= (callH + 10);

      for (const r of sol.recs) {
        const dLines = wrapPdfText(r.desc, 92);
        const ch = 26 + dLines.length * 10.5;
        ensureSpace(ch + 8);
        rect(M, y - ch, W - 2*M, ch, "#FAF6F3", "#E5D9D1");
        txt(M + 9, y - 12, `[${r.priority.toUpperCase()} | ${r.horizon}] ${r.title}`, 8.6, true, "#141216");
        txt(W - M - 108, y - 12, `Imp: ${fmtBRL(r.impact)}`, 8.2, true, "#D9655A");
        dLines.forEach((ln, i) => txt(M + 9, y - 24 - i * 10.5, ln, 7.8, false, "#3E3734"));
        y -= (ch + 6);
      }
      y -= 10;
    }

    if (opts.categories && analytics.revCats.length) {
      ensureSpace(70);
      txt(M, y, "4. DETALHAMENTO DA ARRECADACAO POR CATEGORIA", 10.5, true, "#141216");
      y -= 16;
      rect(M, y - 16, W - 2*M, 16, "#141216");
      const cols = [M+8, M+210, M+308, M+402, M+462];
      ["CATEGORIA / RUBRICA","REALIZADO","META","ATING.","PART."].forEach((h,i) => txt(cols[i], y - 11, h, 7.5, true, "#F8C694"));
      y -= 16;
      analytics.revCats.forEach((c, idx) => {
        ensureSpace(18);
        rect(M, y - 15, W - 2*M, 15, idx % 2 ? "#FAF6F3" : "#FFFFFF", "#E8DDD6");
        [c.cat.slice(0,36), fmtBRL(c.rev), c.meta>0?fmtBRL(c.meta):"-", c.meta>0?fmtPct(c.att):"-", fmtPct(c.share)]
          .forEach((v,i) => txt(cols[i], y - 10.5, v, 7.8, false, "#1B191E"));
        y -= 15;
      });
      y -= 16;
    }

    if (opts.table && recs.length) {
      ensureSpace(64);
      txt(M, y, `5. LANCAMENTOS FINANCEIROS DO PERIODO (${recs.length} registros)`, 10.5, true, "#141216");
      y -= 16;
      const drawTblHead = () => {
        rect(M, y - 15, W - 2*M, 15, "#141216");
        const cols = [M+6, M+58, M+106, M+200, M+356, M+436];
        ["DATA","TIPO","CATEGORIA","DESCRICAO","REALIZADO","META"].forEach((h,i) => txt(cols[i], y - 10.5, h, 7.2, true, "#F8C694"));
        y -= 15;
      };
      drawTblHead();
      const cols = [M+6, M+58, M+106, M+200, M+356, M+436];
      recs.slice(0, 260).forEach((r, idx) => {
        if (y - 16 < 54) { newPage(); drawTblHead(); }
        rect(M, y - 14, W - 2*M, 14, idx % 2 ? "#FAF6F3" : "#FFFFFF", "#EAE0DA");
        [
          fmtDateBR(r.date),
          r.type === "receita" ? "Receita" : "Despesa",
          r.category.slice(0,18),
          r.description.slice(0,30),
          fmtBRL(r.amount),
          r.target_amount > 0 ? fmtBRL(r.target_amount) : "-"
        ].forEach((v,i) => txt(cols[i], y - 10, v, 7.2, false, "#1B191E"));
        y -= 14;
      });
    }

    if (cmds.length) pages.push(cmds.join("\n"));

    const totalP = pages.length;
    const finalStreams = pages.map((s, idx) => {
      const footer =
        `\n${rgb("#D8CCC4")} RG 0.6 w ${M} 36 m ${W-M} 36 l S\n` +
        `BT /F1 7.5 Tf ${rgb("#7D736E")} rg ${M} 24 Td (${toWinAnsi("Painel Executivo de Relatorio Financeiro | " + periodLabel)}) Tj ET\n` +
        `BT /F1 7.5 Tf ${rgb("#7D736E")} rg ${W-M-58} 24 Td (${toWinAnsi(`Pagina ${idx+1} de ${totalP}`)}) Tj ET`;
      return s + footer;
    });

    const objects = [];
    const addObj = (body) => { objects.push(body); return objects.length; };
    const catalogId = addObj("");
    const pagesId = addObj("");
    const f1Id = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2Id = addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

    const pageIds = [];
    for (const stream of finalStreams) {
      const contentId = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const pid = addObj(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1Id} 0 R /F2 ${f2Id} 0 R >> >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pid);
    }
    objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((body, idx) => {
      offsets.push(pdf.length);
      pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefPos = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return new Blob([bytes], { type: "application/pdf" });
  }

  // Optional Opt-In Demo Data
  function loadDemo() {
    clearDemo(true);
    const weights = [0.92,0.86,0.98,1.02,1.04,0.95,0.89,1.01,1.06,1.08,1.12,1.18];
    const rCats = [["Arrecadação Principal",0.50,1.03],["Serviços e Taxas",0.24,0.91],["Convênios e Repasses",0.16,0.96],["Receitas Financeiras",0.10,1.05]];
    const eCats = [["Folha e Encargos",0.48],["Custos Operacionais",0.32],["Tecnologia e Infraestrutura",0.20]];
    const cfgs = [
      { yr:2024, base:180000, perf:[0.98,0.94,1.01,1.03,0.99,0.96,0.91,1.00,1.04,1.02,1.05,1.08], er:0.68, mos:12 },
      { yr:2025, base:205000, perf:[0.96,0.89,0.99,1.02,1.04,0.92,0.88,0.97,1.03,1.01,1.06,1.09], er:0.70, mos:12 },
      { yr:2026, base:230000, perf:[0.94,0.85,0.97,0.95,0.98,0.90,0.87,0.93,0.96,0.99,0.92], er:0.72, mos:11 }
    ];
    let added = 0;
    for (const c of cfgs) {
      for (let m = 0; m < c.mos; m++) {
        const mo = m + 1;
        const mTgt = Math.round(c.base * weights[m] * 100) / 100;
        const mRev = Math.round(mTgt * c.perf[m] * 100) / 100;
        const mExp = Math.round(mRev * c.er * 100) / 100;
        rCats.forEach(([cn, sh, fac], idx) => {
          store.records.push({
            id: store.nextId++, date:`${c.yr}-${String(mo).padStart(2,"0")}-${10+idx*3}`, year:c.yr, month:mo,
            type:"receita", category:cn, description:`[Simulação] ${cn} — ${MONTHS_PT[m]}/${c.yr}`,
            amount: Math.round(mRev * sh * fac * 100)/100, target_amount: Math.round(mTgt * sh * 100)/100,
            status:"Realizado", source:"Demonstração (Simulação)", source_file_id:"demo:2024_2026", is_demo:true
          });
          added++;
        });
        eCats.forEach(([en, sh], idx) => {
          store.records.push({
            id: store.nextId++, date:`${c.yr}-${String(mo).padStart(2,"0")}-${22+idx}`, year:c.yr, month:mo,
            type:"despesa", category:en, description:`[Simulação] ${en} — ${MONTHS_PT[m]}/${c.yr}`,
            amount: Math.round(mExp * sh * 100)/100, target_amount: 0,
            status:"Realizado", source:"Demonstração (Simulação)", source_file_id:"demo:2024_2026", is_demo:true
          });
          added++;
        });
      }
    }
    store.files.unshift({ file_id:"demo:2024_2026", file_name:"Base_Demonstracao_2024_2026 (Simulação)", source_type:"demo", row_count:added, synced_at:new Date().toISOString() });
    saveStore();
    toast(`Base de demonstração carregada (${added} lançamentos simulados).`);
    refreshAll();
  }

  function clearDemo(silent = false) {
    store.records = store.records.filter(r => !r.is_demo);
    store.files = store.files.filter(f => f.source_type !== "demo");
    saveStore();
    if (!silent) { toast("Base de demonstração removida."); refreshAll(); }
  }

  // Render All
  function refreshAll() {
    const recs = filterRecords(ui.filters);
    const an = computeAnalytics(recs, ui.filters.year);
    ui.lastAnalytics = an;

    $("sb-count").textContent = `${store.records.length} reg.`;
    $("sb-dot").className = `dot ${store.records.length ? "" : "coral"}`;
    $("sb-status").textContent = store.records.length
      ? `${store.records.length} lançamentos ativos • ${store.files.length} fonte(s) carregada(s).`
      : "Base limpa e fiel. Importe .xlsx, .csv, .pdf ou conecte o Google Drive.";

    const banner = $("top-banner");
    const hasDemo = store.records.some(r => r.is_demo);
    if (hasDemo) {
      banner.style.display = "flex";
      banner.className = "banner demo";
      banner.innerHTML = `
        <div><h3>Modo Demonstração Ativo (Simulação 2024–2026)</h3>
        <p>Estes dados são simulados para teste de gráficos, simulador e PDF. Remova a demonstração com 1 clique ao importar seus relatórios reais (.xlsx, .csv ou .pdf).</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-secondary btn-sm" id="b-imp">Importar XLSX / CSV / PDF</button>
          <button class="btn btn-coral btn-sm" id="b-clr">Remover Demonstração</button>
        </div>`;
      $("b-imp").onclick = () => switchView("import-drive");
      $("b-clr").onclick = () => clearDemo(false);
    } else if (store.records.length === 0) {
      banner.style.display = "flex";
      banner.className = "banner";
      banner.innerHTML = `
        <div><h3>Base 100% Fiel — Aguardando seus Relatórios Financeiros (2024–2026)</h3>
        <p>Importe arquivos .xlsx, .csv ou .pdf, conecte suas Planilhas do Google Drive, insira lançamentos manuais ou teste agora com a base de demonstração.</p></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm" id="b-go-imp">Importar XLSX / CSV / PDF</button>
          <button class="btn btn-secondary btn-sm" id="b-demo">Carregar Demonstração (Simulação)</button>
        </div>`;
      $("b-go-imp").onclick = () => switchView("import-drive");
      $("b-demo").onclick = loadDemo;
    } else {
      banner.style.display = "none";
    }

    const k = an.kpis;
    $("k-rev").textContent = fmtBRL(k.totalRev);
    $("k-rev-sub").textContent = `Média mensal: ${fmtBRL(k.avgMonthly)}`;
    $("k-yoy").textContent = k.yoy === null ? "Sem base YoY" : `${fmtPct(k.yoy, true)} YoY`;
    $("k-yoy").className = `kpi-badge num ${k.yoy !== null && k.yoy < 0 ? "neg" : ""}`;

    $("k-meta").textContent = fmtBRL(k.totalMeta);
    $("k-att").textContent = k.totalMeta > 0 ? fmtPct(k.attPct) : "—";
    $("k-att").className = `kpi-badge num ${k.totalMeta > 0 && k.attPct < 100 ? "neg" : ""}`;
    $("k-bar").style.width = `${Math.min(100, Math.max(0, k.attPct))}%`;
    $("k-meta-src").textContent = `Origem: ${k.metaSrc}`;

    if (k.totalMeta > 0) {
      $("k-gap").textContent = fmtBRL(k.gap);
      $("k-gap").className = `kpi-val num ${k.gap < 0 ? "coral" : "orange"}`;
      $("k-gap-tag").textContent = k.gap < 0 ? "Déficit" : "Superávit";
      $("k-gap-tag").className = `kpi-badge ${k.gap < 0 ? "neg" : ""}`;
      $("k-gap-sub").textContent = k.gap < 0 ? `Faltam ${fmtBRL(Math.abs(k.gap))} para a meta` : `Superávit de ${fmtBRL(k.gap)}`;
    } else {
      $("k-gap").textContent = "—"; $("k-gap").className = "kpi-val num";
      $("k-gap-tag").textContent = "Sem meta"; $("k-gap-tag").className = "kpi-badge";
      $("k-gap-sub").textContent = "Configure metas na aba Soluções & Metas";
    }

    const er = k.totalRev > 0 ? (k.totalExp / k.totalRev) * 100 : 0;
    $("k-exp").textContent = fmtBRL(k.totalExp);
    $("k-exp-ratio").textContent = `${er.toFixed(1).replace(".",",")}% rec.`;
    $("k-rec-cnt").textContent = `${k.count} lançamento(s) no período`;

    $("k-saldo").textContent = fmtBRL(k.saldo);
    $("k-saldo").className = `kpi-val num ${k.saldo < 0 ? "coral" : "orange"}`;
    $("k-margin").textContent = `${fmtPct(k.margin)} margem`;
    $("k-margin").className = `kpi-badge num ${k.margin < 0 ? "neg" : ""}`;

    $("k-proj").textContent = fmtBRL(k.projected);
    $("k-months").textContent = `${k.activeMCount} mês(es)`;

    const catsEl = $("ov-cats");
    catsEl.innerHTML = an.revCats.length
      ? an.revCats.slice(0, 7).map(c => `
        <div>
          <div class="cat-row">
            <span style="font-weight:600">${esc(c.cat)}</span>
            <span class="num" style="color:var(--peach);font-weight:600">${fmtBRL(c.rev)} <small style="color:var(--text-muted)">(${fmtPct(c.share)})</small></span>
          </div>
          <div class="prog-track"><div class="prog-fill" style="width:${Math.min(100,c.share)}%"></div></div>
          <div class="hint" style="margin-top:3px;">${c.meta>0 ? `Meta: ${fmtBRL(c.meta)} (${fmtPct(c.att)})` : `${c.cnt} lançamento(s)`}</div>
        </div>`).join("")
      : `<div class="empty">Nenhuma categoria de arrecadação no período.</div>`;

    const diagHtml = `<div class="diag-box"><h4>${esc(an.solutions.headline)}</h4><p>${esc(an.solutions.summary)}</p></div>`;
    $("ov-diag").innerHTML = diagHtml;
    $("st-diag").innerHTML = diagHtml;
    const renderRecCards = (arr) => arr.length
      ? arr.map(r => `
        <article class="rec-card">
          <div class="rec-tags">
            <span class="tag ${r.priority==="Alta"?"high":"med"}">Prioridade ${esc(r.priority)}</span>
            <span class="tag">${esc(r.tag)}</span>
            <span class="tag">${esc(r.horizon)}</span>
          </div>
          <strong style="font-size:13.8px;">${esc(r.title)}</strong>
          <p style="margin:0;font-size:12.5px;color:var(--text-secondary)">${esc(r.desc)}</p>
          <div style="margin-top:auto;padding-top:8px;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;font-size:12px;">
            <span style="color:var(--text-muted)">Impacto Estimado</span>
            <strong class="num" style="color:var(--orange)">${fmtBRL(r.impact)}</strong>
          </div>
        </article>`).join("")
      : `<div class="empty" style="grid-column:1/-1">Importe dados reais para gerar ações personalizadas.</div>`;
    $("ov-recs").innerHTML = renderRecCards(an.solutions.recs.slice(0, 4));
    $("st-recs").innerHTML = renderRecCards(an.solutions.recs);

    $("t-2024").value = store.targets[2024] || "";
    $("t-2025").value = store.targets[2025] || "";
    $("t-2026").value = store.targets[2026] || "";
    $("drv-links").value = store.driveLinks || "";
    $("drv-auto").value = store.driveAuto ? "true" : "false";
    $("drv-interval").value = String(store.driveInterval || 60);

    const allCats = Array.from(new Set(store.records.map(r => r.category))).sort();
    const optsHtml = `<option value="Todas">Todas as categorias</option>` + allCats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    const prevF = ui.filters.cat, prevP = $("pdf-cat").value || "Todas";
    $("f-cat").innerHTML = optsHtml; $("f-cat").value = allCats.includes(prevF) ? prevF : "Todas";
    $("pdf-cat").innerHTML = optsHtml; $("pdf-cat").value = allCats.includes(prevP) ? prevP : "Todas";
    const sug = Array.from(new Set([...allCats, "Arrecadação Principal", "Tributos", "Serviços e Taxas", "Convênios", "Custos Operacionais"]));
    $("cat-dl").innerHTML = sug.map(c => `<option value="${esc(c)}"></option>`).join("");

    renderRecords(recs);
    renderFiles();
    updateSim();

    requestAnimationFrame(() => {
      drawMonthlyChart(an.monthly);
      drawAnnualChart(an.annual);
      drawDeviationChart(an.monthly);
    });
  }

  function renderRecords(recs) {
    $("r-total-lbl").textContent = `${recs.length} registro(s)`;
    const valid = new Set(recs.map(r => r.id));
    ui.selected.forEach(id => { if (!valid.has(id)) ui.selected.delete(id); });
    updateSelBtn();

    const tb = $("rec-tbody");
    if (!recs.length) {
      tb.innerHTML = `<tr><td colspan="9" class="empty">Nenhum lançamento encontrado. Clique em <strong>+ Inserir Novo Dado</strong> ou importe .xlsx, .csv ou .pdf.</td></tr>`;
      $("cb-all").checked = false;
      return;
    }
    tb.innerHTML = recs.map(r => `
      <tr>
        <td><input type="checkbox" class="cb row-cb" data-id="${r.id}" ${ui.selected.has(r.id)?"checked":""} /></td>
        <td class="num">${fmtDateBR(r.date)}</td>
        <td><span class="pill ${r.type}">${r.type==="receita"?"Receita":"Despesa"}</span></td>
        <td>${esc(r.category)}</td>
        <td>${esc(r.description)}</td>
        <td class="tr num" style="font-weight:600;color:${r.type==="receita"?"var(--peach)":"var(--coral)"}">${fmtBRL(r.amount)}</td>
        <td class="tr num" style="color:var(--text-secondary)">${r.target_amount>0?fmtBRL(r.target_amount):"—"}</td>
        <td style="color:var(--text-muted);font-size:11.5px;">${esc(r.source)}</td>
        <td class="tr" style="white-space:nowrap;">
          <button class="btn btn-ghost btn-sm b-edit" data-id="${r.id}">Editar</button>
          <button class="btn btn-coral btn-sm b-del" data-id="${r.id}">Excluir</button>
        </td>
      </tr>`).join("");

    tb.querySelectorAll(".row-cb").forEach(cb => cb.onchange = e => {
      const id = Number(e.target.dataset.id);
      if (e.target.checked) ui.selected.add(id); else ui.selected.delete(id);
      updateSelBtn();
    });
    tb.querySelectorAll(".b-edit").forEach(b => b.onclick = () => {
      const rec = store.records.find(x => x.id === Number(b.dataset.id));
      if (rec) openRecModal(rec);
    });
    tb.querySelectorAll(".b-del").forEach(b => b.onclick = () => {
      const id = Number(b.dataset.id);
      const rec = store.records.find(x => x.id === id);
      openConfirm(`Excluir o lançamento "${rec?.description || id}" (${fmtBRL(rec?.amount || 0)})?`, () => {
        store.records = store.records.filter(x => x.id !== id);
        ui.selected.delete(id);
        saveStore();
        toast("Lançamento excluído.");
        refreshAll();
      });
    });
  }

  function updateSelBtn() {
    const btn = $("btn-del-sel");
    btn.textContent = `Excluir Selecionados (${ui.selected.size})`;
    btn.disabled = ui.selected.size === 0;
  }

  function renderFiles() {
    const tb = $("files-tbody");
    if (!store.files.length) {
      tb.innerHTML = `<tr><td colspan="5" class="empty">Nenhum arquivo (.xlsx, .csv, .pdf) importado ainda.</td></tr>`;
      return;
    }
    const badgeMap = {
      demo: ["Simulação", "high"],
      pdf: ["PDF Importado", "high"],
      drive: ["Google Drive", "med"],
      xlsx: ["Planilha XLSX", "med"],
      csv: ["Planilha CSV", "med"],
      upload: ["Upload Local", "med"]
    };
    tb.innerHTML = store.files.map(f => {
      const [lbl, cls] = badgeMap[f.source_type] || ["Arquivo", "med"];
      return `
        <tr>
          <td style="font-weight:600">${esc(f.file_name)}</td>
          <td><span class="tag ${cls}">${lbl}</span></td>
          <td class="tr num">${f.row_count}</td>
          <td class="num" style="font-size:12px;color:var(--text-secondary)">${new Date(f.synced_at).toLocaleString("pt-BR")}</td>
          <td class="tr"><button class="btn btn-coral btn-sm b-delfile" data-fid="${esc(f.file_id)}" data-fn="${esc(f.file_name)}">Excluir Arquivo e Dados</button></td>
        </tr>`;
    }).join("");

    tb.querySelectorAll(".b-delfile").forEach(b => b.onclick = () => {
      const fid = b.dataset.fid, fn = b.dataset.fn;
      openConfirm(`Remover "${fn}" e todos os seus lançamentos?`, () => {
        store.records = store.records.filter(r => r.source_file_id !== fid);
        store.files = store.files.filter(f => f.file_id !== fid);
        saveStore();
        toast(`Dados de "${fn}" removidos.`);
        refreshAll();
      });
    });
  }

  function updateSim() {
    const rp = Number($("s-rev").value), recp = Number($("s-rec").value), ep = Number($("s-exp").value);
    $("s-rev-lbl").textContent = `+${rp}%`;
    $("s-rec-lbl").textContent = `+${recp}%`;
    $("s-exp-lbl").textContent = `-${ep}%`;
    const k = ui.lastAnalytics?.kpis;
    if (!k) return;
    const sr = k.totalRev * (1 + (rp + recp) / 100);
    const se = k.totalExp * (1 - ep / 100);
    const att = k.totalMeta > 0 ? (sr / k.totalMeta) * 100 : 0;
    $("s-out-rev").textContent = fmtBRL(sr);
    $("s-out-att").textContent = k.totalMeta > 0 ? fmtPct(att) : "—";
    $("s-out-att").style.color = k.totalMeta > 0 && att >= 100 ? "var(--orange)" : "var(--coral)";
    $("s-out-sal").textContent = fmtBRL(sr - se);
  }

  function switchView(v) {
    ui.view = v;
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === v));
    document.querySelectorAll(".view-panel").forEach(p => p.classList.toggle("active", p.id === `view-${v}`));
    const [t, s] = VIEW_META[v] || VIEW_META.overview;
    $("view-title").textContent = t;
    $("view-subtitle").textContent = s;
    if (ui.lastAnalytics) {
      requestAnimationFrame(() => {
        drawMonthlyChart(ui.lastAnalytics.monthly);
        drawAnnualChart(ui.lastAnalytics.annual);
        drawDeviationChart(ui.lastAnalytics.monthly);
      });
    }
  }

  function openRecModal(rec = null) {
    if (rec) {
      $("m-rec-title").textContent = "Editar Lançamento Financeiro";
      $("rf-id").value = rec.id; $("rf-date").value = rec.date; $("rf-type").value = rec.type;
      $("rf-cat").value = rec.category; $("rf-status").value = rec.status || "Realizado";
      $("rf-amt").value = rec.amount; $("rf-tgt").value = rec.target_amount || 0; $("rf-desc").value = rec.description;
    } else {
      $("m-rec-title").textContent = "Inserir Novo Lançamento Financeiro";
      $("rf-id").value = ""; $("rf-date").value = new Date().toISOString().slice(0,10); $("rf-type").value = "receita";
      $("rf-cat").value = ""; $("rf-status").value = "Realizado"; $("rf-amt").value = ""; $("rf-tgt").value = "0"; $("rf-desc").value = "";
    }
    $("m-record").classList.add("open");
  }

  function openConfirm(msg, fn) {
    $("m-cnf-msg").textContent = msg;
    ui.confirmFn = fn;
    $("m-confirm").classList.add("open");
  }

  function triggerPdfDownload(mode) {
    let recs, periodLabel, title;
    if (mode === "completo") {
      recs = filterRecords({ year:"", start:"", end:"", cat:"Todas", type:"", search:"" });
      periodLabel = "Relatorio Completo (Todos os Periodos - 2024 a 2026)";
      title = "Relatorio Financeiro Completo";
    } else {
      const s = $("pdf-s").value, e = $("pdf-e").value, c = $("pdf-cat").value;
      recs = filterRecords({ year:"", start:s, end:e, cat:c, type:"", search:"" });
      periodLabel = (s && e) ? `De ${fmtDateBR(s)} ate ${fmtDateBR(e)}` : (s ? `A partir de ${fmtDateBR(s)}` : "Periodo Filtrado");
      if (c && c !== "Todas") periodLabel += ` | Categoria: ${c}`;
      title = "Relatorio Financeiro por Periodo";
    }
    const an = computeAnalytics(recs, null);
    const opts = mode === "completo"
      ? { annual: true, solutions: true, categories: true, table: true }
      : { annual: $("opt-ann").checked, solutions: $("opt-sol").checked, categories: $("opt-cat").checked, table: $("opt-tbl").checked };

    const blob = buildExecutivePdf({ title, periodLabel, analytics: an, recs, opts });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = mode === "completo" ? "relatorio_financeiro_completo.pdf" : `relatorio_financeiro_${$("pdf-s").value || "inicio"}_a_${$("pdf-e").value || "fim"}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast("Relatório PDF gerado e baixado com sucesso!");
  }

  // Event Wiring
  document.querySelectorAll(".nav-btn").forEach(b => b.onclick = () => switchView(b.dataset.view));
  $("btn-top-insert").onclick = () => openRecModal(null);
  $("btn-rec-add").onclick = () => openRecModal(null);
  $("btn-top-import").onclick = () => switchView("import-drive");
  $("btn-top-pdf").onclick = () => switchView("reports");
  $("btn-go-strat").onclick = () => switchView("strategy");

  document.querySelectorAll("#year-seg .year-btn").forEach(b => b.onclick = () => {
    document.querySelectorAll("#year-seg .year-btn").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    ui.filters.year = b.dataset.year;
    refreshAll();
  });
  $("f-start").onchange = e => { ui.filters.start = e.target.value; refreshAll(); };
  $("f-end").onchange = e => { ui.filters.end = e.target.value; refreshAll(); };
  $("f-cat").onchange = e => { ui.filters.cat = e.target.value; refreshAll(); };
  $("btn-clear-filters").onclick = () => {
    ui.filters = { year:"", start:"", end:"", cat:"Todas", type:"", search:"" };
    document.querySelectorAll("#year-seg .year-btn").forEach(x => x.classList.toggle("active", x.dataset.year===""));
    $("f-start").value = ""; $("f-end").value = ""; $("f-cat").value = "Todas"; $("r-search").value = ""; $("r-type").value = "";
    refreshAll();
  };
  $("r-search").oninput = e => { ui.filters.search = e.target.value; refreshAll(); };
  $("r-type").onchange = e => { ui.filters.type = e.target.value; refreshAll(); };

  const dz = $("dropzone"), fp = $("file-picker");
  dz.onclick = () => fp.click();
  $("btn-pick-files").onclick = () => fp.click();
  dz.ondragover = e => { e.preventDefault(); dz.classList.add("dragover"); };
  dz.ondragleave = () => dz.classList.remove("dragover");
  dz.ondrop = e => { e.preventDefault(); dz.classList.remove("dragover"); handleFilesUpload(e.dataTransfer.files); };
  fp.onchange = e => handleFilesUpload(e.target.files);

  $("btn-dl-csv-tpl").onclick = () => {
    const csv = "\uFEFFData;Tipo;Categoria;Descricao;Valor_Realizado;Meta;Status\n15/01/2026;Receita;Arrecadacao Principal;Arrecadacao Jan/2026;145000,00;150000,00;Realizado\n20/01/2026;Receita;Servicos e Taxas;Taxas Jan/2026;42500,00;40000,00;Realizado\n25/01/2026;Despesa;Custos Operacionais;Custeio mensal;68200,00;0,00;Realizado\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = u; a.download = "modelo_relatorio_financeiro.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  };

  $("btn-save-drv").onclick = () => {
    store.driveLinks = $("drv-links").value.trim();
    store.driveAuto = $("drv-auto").value === "true";
    store.driveInterval = parseInt($("drv-interval").value, 10) || 60;
    saveStore();
    restartDriveAutoSync();
    toast("Configuração do Google Drive salva!");
  };
  $("btn-sync-drv").onclick = () => {
    store.driveLinks = $("drv-links").value.trim();
    store.driveAuto = $("drv-auto").value === "true";
    store.driveInterval = parseInt($("drv-interval").value, 10) || 60;
    saveStore();
    restartDriveAutoSync();
    syncGoogleDriveLinks(false);
  };

  // PDF preview modal wiring
  $("m-pdf-x").onclick = $("m-pdf-cancel").onclick = () => { $("m-pdf-preview").classList.remove("open"); ui.pdfPending = null; };
  $("pdf-cb-all").onchange = e => {
    if (!ui.pdfPending) return;
    ui.pdfPending.rows.forEach(r => r.checked = e.target.checked);
    renderPdfPreviewRows();
  };
  $("m-pdf-confirm").onclick = confirmPdfImport;

  // Targets & Simulator
  $("btn-save-targets").onclick = () => {
    store.targets[2024] = parseFloat($("t-2024").value || "0") || 0;
    store.targets[2025] = parseFloat($("t-2025").value || "0") || 0;
    store.targets[2026] = parseFloat($("t-2026").value || "0") || 0;
    saveStore();
    toast("Metas de arrecadação atualizadas!");
    refreshAll();
  };
  ["s-rev","s-rec","s-exp"].forEach(id => $(id).oninput = updateSim);

  // Records CRUD
  $("cb-all").onchange = e => {
    const recs = filterRecords(ui.filters);
    if (e.target.checked) recs.forEach(r => ui.selected.add(r.id)); else ui.selected.clear();
    document.querySelectorAll(".row-cb").forEach(c => c.checked = e.target.checked);
    updateSelBtn();
  };
  $("btn-del-sel").onclick = () => {
    openConfirm(`Excluir permanentemente os ${ui.selected.size} lançamento(s) selecionado(s)?`, () => {
      store.records = store.records.filter(r => !ui.selected.has(r.id));
      ui.selected.clear();
      saveStore();
      toast("Registros selecionados excluídos.");
      refreshAll();
    });
  };
  $("btn-del-all").onclick = () => {
    openConfirm("Excluir TODOS os lançamentos e arquivos carregados no painel?", () => {
      store.records = []; store.files = []; ui.selected.clear();
      saveStore();
      toast("Base limpa com sucesso.");
      refreshAll();
    });
  };

  $("m-rec-x").onclick = $("m-rec-cancel").onclick = () => $("m-record").classList.remove("open");
  $("rec-form").onsubmit = e => {
    e.preventDefault();
    const id = $("rf-id").value ? Number($("rf-id").value) : null;
    const d = $("rf-date").value;
    const obj = {
      date: d, year: Number(d.slice(0,4)), month: Number(d.slice(5,7)),
      type: $("rf-type").value, category: $("rf-cat").value.trim(), status: $("rf-status").value,
      amount: parseFloat($("rf-amt").value || "0"), target_amount: parseFloat($("rf-tgt").value || "0"),
      description: $("rf-desc").value.trim()
    };
    if (id) {
      const idx = store.records.findIndex(r => r.id === id);
      if (idx >= 0) store.records[idx] = { ...store.records[idx], ...obj };
      toast("Lançamento atualizado.");
    } else {
      store.records.push({ id: store.nextId++, ...obj, source: "Inserção Manual", source_file_id: "manual", is_demo: false });
      toast("Novo lançamento inserido!");
    }
    saveStore();
    $("m-record").classList.remove("open");
    refreshAll();
  };

  $("m-cnf-x").onclick = $("m-cnf-cancel").onclick = () => $("m-confirm").classList.remove("open");
  $("m-cnf-ok").onclick = () => { if (ui.confirmFn) ui.confirmFn(); $("m-confirm").classList.remove("open"); };

  document.querySelectorAll(".pdf-pre").forEach(b => b.onclick = () => {
    if (b.dataset.s) { $("pdf-s").value = b.dataset.s; $("pdf-e").value = b.dataset.e; }
    else if (b.dataset.days) {
      const e = new Date(), s = new Date(); s.setDate(e.getDate() - Number(b.dataset.days));
      $("pdf-s").value = s.toISOString().slice(0,10); $("pdf-e").value = e.toISOString().slice(0,10);
    }
  });
  $("btn-pdf-full").onclick = () => triggerPdfDownload("completo");
  $("btn-pdf-period").onclick = () => triggerPdfDownload("periodo");

  bindChartHover("c-monthly", "tt-monthly", "monthly", m =>
    `<strong style="color:var(--peach)">${m.label}</strong><br/>Arrecadação: <span class="num">${fmtBRL(m.rev)}</span><br/>Meta: <span class="num">${fmtBRL(m.meta)}</span> (${fmtPct(m.att)})<br/>Despesas: <span class="num" style="color:var(--coral)">${fmtBRL(m.exp)}</span>`
  );
  bindChartHover("c-annual", "tt-annual", "annual", a =>
    `<strong style="color:var(--peach)">Exercício ${a.year}</strong><br/>Arrecadação: <span class="num">${fmtBRL(a.rev)}</span><br/>Meta: <span class="num">${fmtBRL(a.meta)}</span><br/>Despesas: <span class="num" style="color:var(--coral)">${fmtBRL(a.exp)}</span><br/>Saldo: <span class="num">${fmtBRL(a.saldo)}</span>`
  );
  bindChartHover("c-dev", "tt-dev", "dev", m =>
    `<strong style="color:var(--peach)">${m.label}</strong><br/>${m.desvio<0?"Déficit":"Superávit"}: <span class="num" style="color:${m.desvio<0?"var(--coral)":"var(--orange)"}">${fmtBRL(m.desvio)}</span>`
  );

  window.addEventListener("resize", () => {
    if (!ui.lastAnalytics) return;
    drawMonthlyChart(ui.lastAnalytics.monthly);
    drawAnnualChart(ui.lastAnalytics.annual);
    drawDeviationChart(ui.lastAnalytics.monthly);
  });

  refreshAll();
  restartDriveAutoSync();
})();
