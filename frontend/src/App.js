import { useState, useEffect, useCallback, useRef } from "react";
import "./index.css";

/* ── Constants ───────────────────────────────────────────────────── */
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";
const TICKERS = ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","BRK-B","LLY","AVGO","JPM"];
const ROUTE_LABELS = {
  metric_lookup:"Metric Lookup", timeseries:"Timeseries",
  full_statement:"Full Statement", narrative:"Narrative Search",
  hybrid:"Hybrid", comparison:"Comparison", multi_company:"Multi-Company",
};
const ROUTE_CLASS = {
  metric_lookup:"tag-blue", timeseries:"tag-green", full_statement:"tag-purple",
  narrative:"tag-amber", hybrid:"tag-red", comparison:"tag-blue", multi_company:"tag-green",
};
const EXAMPLE_QUERIES = [
  "What was Apple's revenue in 2023?",
  "How has NVIDIA revenue changed from 2020 to 2024?",
  "Compare net income AAPL vs MSFT 2023",
  "What are the key risk factors in Meta's latest 10-K?",
  "Show JPMorgan balance sheet for 2023",
];
const XBRL_LABELS = {
  "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax":"Revenue",
  "us-gaap:Revenues":"Revenue","us-gaap:SalesRevenueNet":"Net Sales",
  "us-gaap:GrossProfit":"Gross Profit","us-gaap:OperatingExpenses":"Operating Expenses",
  "us-gaap:ResearchAndDevelopmentExpense":"R&D Expense",
  "us-gaap:SellingGeneralAndAdministrativeExpense":"SG&A Expense",
  "us-gaap:OperatingIncomeLoss":"Operating Income","us-gaap:NetIncomeLoss":"Net Income",
  "us-gaap:EarningsPerShareDiluted":"EPS (Diluted)","us-gaap:Assets":"Total Assets",
  "us-gaap:AssetsCurrent":"Current Assets",
  "us-gaap:CashAndCashEquivalentsAtCarryingValue":"Cash & Equivalents",
  "us-gaap:Liabilities":"Total Liabilities","us-gaap:LongTermDebt":"Long-Term Debt",
  "us-gaap:StockholdersEquity":"Stockholders' Equity",
  "us-gaap:NetCashProvidedByUsedInOperatingActivities":"Operating Cash Flow",
  "us-gaap:PaymentsToAcquirePropertyPlantAndEquipment":"Capital Expenditures",
};
function xbrlLabel(c) {
  if (!c) return c;
  if (XBRL_LABELS[c]) return XBRL_LABELS[c];
  const l = c.includes(":") ? c.split(":")[1] : c;
  return l.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g,"$1 $2");
}

/* ── Typewriter ──────────────────────────────────────────────────── */
function useTypewriter(text, speed = 52) {
  const [displayed, setDisplayed] = useState("");
  const [done, setDone] = useState(false);
  useEffect(() => {
    setDisplayed(""); setDone(false); let i = 0;
    const t = setInterval(() => { i++; setDisplayed(text.slice(0,i)); if(i>=text.length){clearInterval(t);setDone(true);} }, speed);
    return () => clearInterval(t);
  }, [text, speed]);
  return { displayed, done };
}

/* ── Scroll reveal ───────────────────────────────────────────────── */
function useScrollReveal(threshold=0.12) {
  const ref = useRef(null); const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current; if(!el) return;
    const obs = new IntersectionObserver(([e]) => { if(e.isIntersecting){setVisible(true);obs.unobserve(el);} },{threshold});
    obs.observe(el); return () => obs.disconnect();
  },[threshold]);
  return [ref, visible];
}
function Reveal({children, delay=0, className=""}) {
  const [ref, visible] = useScrollReveal();
  return <div ref={ref} className={`reveal-wrap ${visible?"revealed":""} ${className}`} style={{transitionDelay:`${delay}ms`}}>{children}</div>;
}

/* ── Animated number ─────────────────────────────────────────────── */
function AnimatedNumber({value, duration=1600}) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const s = performance.now();
    const tick = (now) => { const p=Math.min((now-s)/duration,1); setDisplay(Math.round((1-Math.pow(1-p,3))*value)); if(p<1)requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  },[value,duration]);
  return <>{display.toLocaleString()}</>;
}

/* ── Inline markdown ─────────────────────────────────────────────── */
const INCREASE_RE = /\bgrew\b|\bincreas(?:e|ed|ing)\b|\brose\b/i;
const DECREASE_RE = /\bdeclin(?:e|ed|ing)\b|\bdecreas(?:e|ed|ing)\b|\bfell\b/i;
const SIGNED_RE = /([\u2191\u2193])\s*([+-]?\$?[\d,.]+(?:\s*(?:billion|million|thousand))?\s*%?)|([+-])(\$?[\d,.]+(?:\s*(?:billion|million|thousand))?\s*%?)/;

function findSourceUrl(text, sources) {
  if (!sources?.length) return null;
  const xm = text.match(/^(.+?)\s*\|\s*(\w+),\s*FY\s*(\d{4})/);
  if (xm) {
    const concept=xm[1].trim().toLowerCase(), ticker=xm[2].toLowerCase(), year=xm[3];
    for (const s of sources) { const f=(s.filing||"").toLowerCase(); if(f.includes(ticker)&&f.includes(`fy ${year}`)&&s.filing_url)return s.filing_url; }
  }
  const lower=text.toLowerCase();
  for (const s of sources) {
    const f=(s.filing||"").toLowerCase(); if(!f) continue;
    const words=lower.split(/\s+/).filter(w=>w.length>2);
    if (words.filter(w=>f.includes(w)).length>=Math.max(1,words.length*0.5)&&s.filing_url) return s.filing_url;
  }
  return null;
}

function renderInline(text, sources) {
  if (!text) return null;
  const parts=[]; let rest=text; let k=0;
  while(rest.length>0){
    const bold=rest.match(/\*\*(.+?)\*\*/);
    const src=rest.match(/\[(?:Source|XBRL):\s*([^\]]+)\]/);
    const chg=rest.match(SIGNED_RE);
    const ms=[bold&&{t:"bold",m:bold},src&&{t:"src",m:src},chg&&{t:"chg",m:chg}].filter(Boolean).sort((a,b)=>a.m.index-b.m.index);
    if(!ms.length){parts.push(<span key={k++}>{rest}</span>);break;}
    const {t,m}=ms[0];
    if(m.index>0)parts.push(<span key={k++}>{rest.slice(0,m.index)}</span>);
    if(t==="bold"){
      const ia=m[1].match(/^([\u2191\u2193])\s*(.+)$/);
      const ic=m[1].match(/^([+-])(.+)$/);
      if(ia){const up=ia[1]==="\u2191";parts.push(<strong key={k++} className={up?"chg-up":"chg-down"}>{up?"▲":"▼"} {ia[2]}</strong>);}
      else if(ic){const up=ic[1]==="+";parts.push(<strong key={k++} className={up?"chg-up":"chg-down"}>{up?"▲":"▼"} {ic[2]}</strong>);}
      else parts.push(<strong key={k++} className="ans-bold">{m[1]}</strong>);
    } else if(t==="chg"){
      const up=m[1]==="\u2191"||m[3]==="+";
      parts.push(<span key={k++} className={up?"chg-up":"chg-down"}>{up?"▲":"▼"} {m[1]?m[2]:m[0]}</span>);
    } else if(t==="src"){
      const raw=m[1];
      const short=(()=>{
        const xm2=raw.match(/^(.+?)\s*\|\s*(\w+),\s*FY\s*(\d{4})/);
        if(xm2)return `${xbrlLabel(xm2[1].trim())} · ${xm2[2]} FY${xm2[3]}`;
        return raw.replace(/^(?:10-[KQ]|XBRL)\s*/i,"").slice(0,40);
      })();
      const url=findSourceUrl(raw,sources);
      parts.push(url
        ? <a key={k++} href={url} target="_blank" rel="noopener noreferrer" className="src-link">[{short} ↗]</a>
        : <span key={k++} className="src-ref">[{short}]</span>);
    }
    rest=rest.slice(m.index+m[0].length);
  }
  return parts;
}

/* ── Answer block ────────────────────────────────────────────────── */
function AnswerBlock({answer, sources}) {
  if (!answer) return null;
  const lines=answer.split("\n");
  const isSep=(l)=>/^\|[\s-:|]+\|$/.test(l.trim());
  const blocks=[]; let i=0;
  while(i<lines.length){
    const line=lines[i];
    if(/^-{3,}$/.test(line.trim())){blocks.push({type:"hr",key:i});i++;continue;}
    if(line.trimStart().startsWith("|")){
      const tl=[];
      while(i<lines.length&&lines[i].trimStart().startsWith("|")){if(!isSep(lines[i]))tl.push(lines[i]);i++;}
      if(tl.length){const cells=(l)=>l.split("|").slice(1,-1).map(c=>c.trim());blocks.push({type:"table",key:blocks.length,header:cells(tl[0]),rows:tl.slice(1).map(cells)});}
      continue;
    }
    if(line.startsWith("### ")){blocks.push({type:"h3",key:i,text:line.slice(4)});i++;continue;}
    if(line.startsWith("## ")){blocks.push({type:"h2",key:i,text:line.slice(3)});i++;continue;}
    if(line.startsWith("# ")){blocks.push({type:"h1",key:i,text:line.slice(2)});i++;continue;}
    if(line.trimStart().startsWith("- ")){
      blocks.push({type:"bullet",key:i,text:line.replace(/^\s*-\s/,""),depth:Math.floor((line.length-line.trimStart().length)/2),
        isUp:INCREASE_RE.test(line)&&!DECREASE_RE.test(line),isDown:DECREASE_RE.test(line)&&!INCREASE_RE.test(line)});
      i++;continue;
    }
    if(/^\d+\.\s/.test(line.trimStart())){blocks.push({type:"bullet",key:i,text:line.replace(/^\s*\d+\.\s/,""),depth:0});i++;continue;}
    if(line.trim()===""){blocks.push({type:"space",key:i});i++;continue;}
    blocks.push({type:"p",key:i,text:line});i++;
  }
  return (
    <div className="ans-body">
      {blocks.map(b=>{
        if(b.type==="hr")return <hr key={b.key} className="ans-hr"/>;
        if(b.type==="space")return <div key={b.key} className="ans-space"/>;
        if(b.type==="h1")return <h2 key={b.key} className="ans-h1">{renderInline(b.text,sources)}</h2>;
        if(b.type==="h2")return <h3 key={b.key} className="ans-h2">{renderInline(b.text,sources)}</h3>;
        if(b.type==="h3")return <h4 key={b.key} className="ans-h3">{renderInline(b.text,sources)}</h4>;
        if(b.type==="bullet")return(
          <div key={b.key} className={`ans-bullet${b.isUp?" bullet-up":b.isDown?" bullet-down":""}`} style={{paddingLeft:`${b.depth*16+20}px`}}>
            <span className="bullet-mark">—</span><span>{renderInline(b.text,sources)}</span>
          </div>
        );
        if(b.type==="p")return <p key={b.key} className="ans-p">{renderInline(b.text,sources)}</p>;
        if(b.type==="table"){
          const changeIdx=new Set();
          b.header.forEach((h,idx)=>{const lc=h.toLowerCase();if(lc.includes("change")||lc.includes("growth")||lc.includes("delta"))changeIdx.add(idx);});
          return(
            <div key={b.key} className="ans-table-wrap">
              <table className="ans-table">
                <thead><tr>{b.header.map((h,j)=><th key={j}>{renderInline(h,sources)}</th>)}</tr></thead>
                <tbody>{b.rows.map((row,ri)=>(
                  <tr key={ri}>{row.map((cell,ci)=><td key={ci}>{renderInline(cell,sources)}</td>)}</tr>
                ))}</tbody>
              </table>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

/* ── Retrieval plan ──────────────────────────────────────────────── */
function RetrievalPlan({steps, activeStep, completed}) {
  if (!steps?.length) return null;
  return(
    <div className="plan-box">
      <div className="plan-head"><span className="plan-title">RETRIEVAL PLAN</span><span className="plan-count">{steps.length} steps</span></div>
      <div className="plan-list">
        {steps.map((step,idx)=>{
          const done=completed||idx<activeStep, active=!completed&&idx===activeStep;
          return(
            <div key={idx} className={`plan-row${done?" row-done":active?" row-active":" row-pending"}`}>
              <div className="row-icon">
                {done?<span className="icon-check">✓</span>
                  :active?<span className="icon-pulse"/>
                  :<span className="icon-num">{step.step}</span>}
              </div>
              <div className="row-body">
                <div className="row-name">{step.name}</div>
                {(done||active)&&step.actions?.map((a,j)=><div key={j} className="row-action">› {a}</div>)}
                {(done||active)&&step.details&&(
                  <div className="row-chips">
                    {Object.entries(step.details).filter(([k])=>k!=="route").map(([k,v])=>{
                      const warn=typeof v==="string"&&(v.startsWith("NO ")||v.includes("MISSING"));
                      return<span key={k} className={`chip${warn?" chip-warn":""}`}><span className="chip-k">{k}</span><span className="chip-v">{typeof v==="object"?JSON.stringify(v):String(v)}</span></span>;
                    })}
                  </div>
                )}
                {(done||active)&&step.warnings?.map((w,j)=><div key={j} className="row-warn">⚠ {w}</div>)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Skeleton ────────────────────────────────────────────────────── */
function Skeleton(){
  return(
    <div className="skel-wrap">
      {["w40","w100","w100","w70","","w35","w100","w80"].map((w,i)=>
        w?<div key={i} className={`skel-line ${w}`}/>:<div key={i} className="skel-gap"/>
      )}
    </div>
  );
}

/* ── Sources panel ───────────────────────────────────────────────── */
function parseSource(src){
  const f=src.filing||""; let type="10-K";
  if(f.includes("10-Q"))type="10-Q";
  const tm=f.match(/\]\s*([A-Z]{1,5})\b/), ym=f.match(/(?:FY\s?)(\d{4})/), qm=f.match(/Q([1-4])/);
  return{type,ticker:src.ticker||tm?.[1]||"",year:ym?.[1]||"",quarter:qm?.[1]||"",filing:f,url:src.filing_url||null};
}
function SourcesPanel({sources}){
  if(!sources?.length) return null;
  const seen=new Set(), deduped=[];
  for(const s of sources.map(parseSource)){
    if(s.type!=="10-K"&&s.type!=="10-Q")continue;
    const k=`${s.ticker}|${s.type}|${s.year}|${s.quarter}`;
    if(seen.has(k))continue; seen.add(k); deduped.push(s);
  }
  if(!deduped.length)return null;
  return(
    <div className="sources-box">
      <div className="sources-head">
        <span className="sources-title">SOURCES</span>
        <span className="sources-badge">SEC EDGAR</span>
      </div>
      <div className="sources-list">
        {deduped.map((s,i)=>{
          const inner=<>
            <span className={`src-type-tag ${s.type==="10-Q"?"tag-green":"tag-blue"}`}>{s.type}</span>
            <span className="src-name">{s.ticker}{s.year?` FY${s.year}`:""}{s.quarter?` Q${s.quarter}`:""}</span>
            {s.url&&<span className="src-ext-icon">↗</span>}
          </>;
          return s.url
            ?<a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="src-row src-row-link">{inner}</a>
            :<div key={i} className="src-row">{inner}</div>;
        })}
      </div>
      <p className="sources-note">Dates reflect fiscal years, which may differ from calendar years.</p>
    </div>
  );
}

/* ── Confidence breakdown ────────────────────────────────────────── */
const SIGNAL_LABELS={retrieval_quality:"SRC AUTH",source_coverage:"COVERAGE",cross_source_agreement:"AGREEMENT",citation_density:"CITATION",data_recency:"RECENCY"};
function ConfidenceBreakdown({confidence}){
  if(!confidence||!confidence.signals)return null;
  const {overall_score,tier_label,tier_color,tier_description,signals}=confidence;
  const tc=tier_color==="green"?"score-high":tier_color==="yellow"?"score-mid":"score-low";
  return(
    <div className="meta-card">
      <div className="meta-card-head">
        <span className="meta-card-title">CONFIDENCE</span>
        <span className={`tag ${tier_color==="green"?"tag-green":tier_color==="yellow"?"tag-amber":"tag-red"}`}>{tier_label}</span>
      </div>
      <div className="conf-score-row">
        <span className={`conf-big-score ${tc}`}>{Math.round(overall_score)}</span>
        <span className="conf-denom">/ 100</span>
      </div>
      <div className={`conf-bar-track`}><div className={`conf-bar-fill ${tc}`} style={{width:`${overall_score}%`}}/></div>
      {tier_description&&<p className="conf-desc">{tier_description}</p>}
      <div className="signals-list">
        {Object.entries(signals).map(([key,signal])=>{
          const score=signal.score;
          const bc=score>=80?"bar-high":score>=50?"bar-mid":"bar-low";
          return(
            <div key={key} className="signal-row">
              <span className="signal-name">{SIGNAL_LABELS[key]||key.toUpperCase()}</span>
              <div className="signal-track"><div className={`signal-fill ${bc}`} style={{width:`${Math.max(score,2)}%`}}/></div>
              <span className={`signal-val ${bc}`}>{Math.round(score)}</span>
            </div>
          );
        })}
      </div>
      {confidence.contradictions?.length>0&&(
        <div className="contradictions">
          {confidence.contradictions.map((c,i)=><div key={i} className="contradiction">⚠ {c}</div>)}
        </div>
      )}
    </div>
  );
}

/* ── Cost breakdown ──────────────────────────────────────────────── */
function fmtCost(n){if(n===0)return"0.00¢";if(n<0.01)return`${(n*100).toFixed(3)}¢`;if(n<1)return`${(n*100).toFixed(2)}¢`;return`$${n.toFixed(2)}`;}
const PHASE_LABELS={classify:"Classify",decompose:"Decompose",embed:"Embed",generate:"Generate",full_query:"Full Query",retrieve:"Retrieve"};
function CostBreakdown({cost}){
  if(!cost||!cost.phases||cost.phases.length===0)return null;
  const {phases,total_cost,total_tokens,wall_time_ms,efficiency}=cost;
  const grade=efficiency?.grade||"B";
  const gc=grade==="S"||grade==="A+"||grade==="A"?"tag-green":grade==="B"?"tag-amber":"tag-red";
  const allCached=phases.every(p=>p.cached);
  const costPhases=phases.filter(p=>!p.cached&&p.cost>0);
  const totalPhaseCost=costPhases.reduce((s,p)=>s+p.cost,0)||1;
  return(
    <div className="meta-card">
      <div className="meta-card-head">
        <span className="meta-card-title">EXECUTION COST</span>
        <span className={`tag ${gc}`}>{grade}</span>
      </div>
      <div className="cost-total-row">
        <span className="cost-big">{fmtCost(total_cost)}</span>
        {allCached&&<span className="tag tag-green">CACHED</span>}
      </div>
      <div className="cost-models">
        {[{l:"LLM",v:"gpt-4o-mini"},{l:"Embed",v:"text-embedding-3-small"},{l:"Reranker",v:"ms-marco-MiniLM-L-6"}].map(m=>(
          <span key={m.l} className="model-chip"><span className="model-k">{m.l}</span><span className="model-v">{m.v}</span></span>
        ))}
      </div>
      {!allCached&&costPhases.length>0&&(
        <div className="cost-phases">
          {phases.map((p,i)=>{
            const pct=!p.cached&&totalPhaseCost>0?(p.cost/totalPhaseCost)*100:0;
            return(
              <div key={i} className="cost-phase">
                <div className="phase-row">
                  <div className="phase-left">
                    <span className={`phase-dot ${p.cached?"dot-cached":"dot-active"}`}/>
                    <span className="phase-name">{PHASE_LABELS[p.phase]||p.phase}</span>
                  </div>
                  <span className="phase-cost">{p.cached?<span className="phase-cached">CACHED</span>:fmtCost(p.cost??0)}</span>
                </div>
                {!p.cached&&<div className="phase-track"><div className="phase-fill" style={{width:`${Math.max(pct,3)}%`}}/></div>}
              </div>
            );
          })}
        </div>
      )}
      <div className="cost-stats">
        <span>{(total_tokens||0).toLocaleString()} tokens</span>
        <span className="stat-sep">·</span>
        <span>{((wall_time_ms||0)/1000).toFixed(1)}s wall</span>
        {total_tokens>0&&wall_time_ms>0&&<><span className="stat-sep">·</span><span>{Math.round(total_tokens/(wall_time_ms/1000)).toLocaleString()} tok/s</span></>}
      </div>
    </div>
  );
}

/* ── Landing page ────────────────────────────────────────────────── */
const FEATURES=[
  {n:"01",label:"Metric Lookup",desc:"70+ XBRL concepts with 3-layer resolution, Q4 derivation, and statement fallback."},
  {n:"02",label:"Trend Analysis",desc:"YoY timeseries with auto-year expansion and quarterly/annual hybrid support."},
  {n:"03",label:"Narrative Search",desc:"Vector + cross-encoder reranking over Risk Factors and MD&A sections."},
  {n:"04",label:"Multi-Company",desc:"Parallel per-ticker sub-queries with fair-share context budgeting."},
  {n:"05",label:"Smart Routing",desc:"5-way dispatch: metric, timeseries, narrative, hybrid, full statement."},
  {n:"06",label:"Source Attribution",desc:"Every answer links to official SEC EDGAR filings with confidence scoring."},
];
const STATS=[{v:70,s:"+",l:"XBRL Metrics"},{v:1,s:"M+",l:"Data Points"},{v:10,s:"",l:"Companies"},{v:16,s:"yr",l:"Coverage"}];

function LandingPage({onExample}){
  const {displayed,done}=useTypewriter("Financial Filings Intelligence Engine",52);
  return(
    <div className="landing">
      <div className="lp-hero">
        <div className="lp-eyebrow">SEC EDGAR · 10-K · 10-Q · XBRL</div>
        <h1 className="lp-title">{displayed}{!done&&<span className="lp-cursor">|</span>}</h1>
        <p className="lp-sub">Structured XBRL data and vector search across official SEC filings — answered in seconds with full source attribution.</p>
        <div className="lp-tickers">{TICKERS.map(t=><span key={t} className="ticker-pill">{t}</span>)}<span className="ticker-pill ticker-dim">2010–2026</span></div>
      </div>

      <div className="lp-stats">
        {STATS.map(s=>(
          <div key={s.l} className="stat-card">
            <div className="stat-num"><AnimatedNumber value={s.v} duration={2000}/>{s.s}</div>
            <div className="stat-label">{s.l}</div>
          </div>
        ))}
      </div>

      <div className="lp-features">
        {FEATURES.map((f,i)=>(
          <Reveal key={f.n} delay={i*60}>
            <div className="feature-card">
              <div className="feature-num">{f.n}</div>
              <div className="feature-label">{f.label}</div>
              <p className="feature-desc">{f.desc}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <div className="lp-examples">
        <div className="section-label">TRY AN EXAMPLE</div>
        <div className="example-list">
          {EXAMPLE_QUERIES.map(q=>(
            <button key={q} className="example-row" onClick={()=>onExample(q)}>
              <span>{q}</span><span className="example-arrow">→</span>
            </button>
          ))}
        </div>
      </div>

      <div className="lp-stack">
        <div className="section-label">TECH STACK</div>
        <div className="stack-grid">
          {[["LLM","GPT-4o-mini"],["Embeddings","text-embedding-3-small"],["Reranker","MiniLM-L-6-v2"],["Database","PostgreSQL + pgvector"],["Data","SEC EDGAR / XBRL"],["Backend","Python / FastAPI"],["Frontend","React"],["Streaming","Server-Sent Events"]].map(([k,v])=>(
            <div key={k} className="stack-cell"><div className="stack-k">{k}</div><div className="stack-v">{v}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Main App ─────────────────────────────────────────────────────── */
export default function App(){
  const [query,setQuery]=useState("");
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState(null);
  const [classification,setClassification]=useState(null);
  const [planSteps,setPlanSteps]=useState([]);
  const [activeStep,setActiveStep]=useState(0);
  const [sessionCost,setSessionCost]=useState(0);
  const stepTimerRef=useRef(null);
  const [now,setNow]=useState(new Date());

  useEffect(()=>{const t=setInterval(()=>setNow(new Date()),1000);return()=>clearInterval(t);},[]);
  useEffect(()=>{const p=new URLSearchParams(window.location.search);const q=p.get("q");if(q)handleSearch(q);},[]);// eslint-disable-line
  useEffect(()=>()=>{if(stepTimerRef.current)clearInterval(stepTimerRef.current);},[]);

  const cleanAnswer=(raw)=>{if(!raw)return null;return raw.replace(/---\s*\n\*\*Sources:\*\*.*$/s,"").replace(/\*\*Sources:\*\*.*$/s,"").replace(/---\s*\n\*\*Confidence:.*$/s,"").replace(/\*\*Confidence:.*$/s,"").trimEnd();};

  const handleSearch=useCallback(async(overrideQuery)=>{
    const q=(typeof overrideQuery==="string"?overrideQuery:query).trim(); if(!q)return;
    setQuery(q);setLoading(true);setError(null);setResult(null);setClassification(null);setPlanSteps([]);setActiveStep(0);
    if(stepTimerRef.current)clearInterval(stepTimerRef.current);
    try{
      const res=await fetch(`${BACKEND_URL}/query/stream`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query:q})});
      if(!res.ok){
        if(res.status===429){
          const data=await res.json();
          throw new Error(data.error||"You have reached the daily limit of 5 queries. To continue, please use a different device, connect to a different network, or wait until tomorrow.");
        }
        throw new Error(`Server responded with ${res.status}`);
      }
      const reader=res.body.getReader(),decoder=new TextDecoder();
      let buffer="",stepsReceived=[];
      while(true){
        const{done,value}=await reader.read(); if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        const parts=buffer.split("\n\n"); buffer=parts.pop()||"";
        for(const part of parts){
          const em=part.match(/^event:\s*(.+)/m),dm=part.match(/^data:\s*(.+)/m);
          if(!em||!dm)continue;
          let data; try{data=JSON.parse(dm[1]);}catch{continue;}
          const ev=em[1].trim();
          if(ev==="classification")setClassification(data);
          if(ev==="retrieval_plan"){
            stepsReceived=data.steps||[];setPlanSteps(stepsReceived);setActiveStep(0);
            let step=0;const ms=Math.max(800,Math.min(2000,8000/Math.max(stepsReceived.length,1)));
            stepTimerRef.current=setInterval(()=>{step++;if(step<stepsReceived.length)setActiveStep(step);else clearInterval(stepTimerRef.current);},ms);
          }
          if(ev==="result"){if(stepTimerRef.current)clearInterval(stepTimerRef.current);setActiveStep(stepsReceived.length);setResult(data);if(data.cost?.total_cost)setSessionCost(p=>p+data.cost.total_cost);setLoading(false);}
          if(ev==="error"){if(stepTimerRef.current)clearInterval(stepTimerRef.current);setError(data.error||"An unknown error occurred");setLoading(false);}
        }
      }
    }catch(err){
      if(stepTimerRef.current)clearInterval(stepTimerRef.current);
      setError(err.message==="Failed to fetch"?`Cannot connect to backend at ${BACKEND_URL}`:err.message);
      setLoading(false);
    }
  },[query]);

  const handleKey=(e)=>{if(e.key==="Enter"&&!e.shiftKey&&!loading){e.preventDefault();handleSearch();}};

  return(
    <div className="app">
      {/* Header */}
      <header className="hdr">
        <div className="hdr-left">
          <div className="hdr-logo">
            <span className="logo-sigil">§</span>
            <div>
              <div className="logo-name">Financial Filings Intelligence</div>
              <div className="logo-sub">AI-powered SEC EDGAR filings analysis</div>
            </div>
          </div>
          {classification&&loading&&(
            <span className={`tag ${ROUTE_CLASS[classification.route]||"tag-blue"}`}>
              {classification.route_name||ROUTE_LABELS[classification.route]||classification.route}
            </span>
          )}
        </div>
        <div className="hdr-right">
          <span className="hdr-chip">10-K</span><span className="hdr-chip">10-Q</span>
          <span className="hdr-date">{now.toLocaleDateString("en-US",{month:"short",day:"2-digit",year:"numeric"})} · <span className="hdr-clock">{now.toLocaleTimeString("en-US",{hour12:false})}</span></span>
        </div>
      </header>

      {/* Query bar */}
      <div className="qbar">
        <div className="qbar-inner">
          <div className="qfield-wrap">
            <textarea value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={handleKey}
              placeholder="Ask about SEC filings — revenue, risk factors, balance sheet, trends…"
              disabled={loading} rows={2} className="qfield"/>
            <div className="qhint"><kbd>Enter</kbd> to search · <kbd>Shift+Enter</kbd> for newline</div>
          </div>
          <button onClick={()=>handleSearch()} disabled={loading||!query.trim()} className="qbtn">
            {loading?<><span className="qbtn-spinner"/>Searching</>:<><span className="qbtn-icon">⌕</span>Search</>}
          </button>
        </div>
        <div className="example-pills">
          <span className="pills-prefix">Try:</span>
          {EXAMPLE_QUERIES.map(eq=>(
            <button key={eq} className="pill" onClick={()=>{setQuery(eq);handleSearch(eq);}} disabled={loading}>{eq}</button>
          ))}
        </div>
      </div>

      {/* Main */}
      <main className="main">
        <div className="main-inner">

          {loading&&!classification&&(
            <div className="init-loading">
              <span className="ld"/><span className="ld"/><span className="ld"/>
              <span className="ld-text">Classifying query…</span>
            </div>
          )}

          {classification&&!result&&(
            <div className="class-strip">
              <span className={`tag ${ROUTE_CLASS[classification.route]||"tag-blue"}`}>{classification.route_name||ROUTE_LABELS[classification.route]}</span>
              <span className="class-reason">{classification.reasoning}</span>
            </div>
          )}

          {planSteps.length>0&&!result&&<RetrievalPlan steps={planSteps} activeStep={activeStep} completed={false}/>}
          {loading&&classification&&!result&&<Skeleton/>}

          {error&&(
            <div className="err-box">
              <span className="err-label">ERROR</span>
              <span>{error}</span>
            </div>
          )}

          {result&&(
            <div className="result">
              {/* Meta strip */}
              <div className="result-strip">
                <span className={`tag ${ROUTE_CLASS[result.route]||"tag-blue"}`}>{result.route_name||ROUTE_LABELS[result.route]||result.route}</span>
                {result.response_time!=null&&<span className="strip-meta">{result.response_time.toFixed(2)}s</span>}
                {result.cost?.total_cost>0&&<span className="strip-meta">{fmtCost(result.cost.total_cost)}</span>}
              </div>

              {/* Retrieval plan collapsed */}
              {planSteps.length>0&&(
                <details className="plan-details">
                  <summary className="plan-summary">
                    <span className="plan-chevron">›</span>
                    RETRIEVAL PLAN <span className="plan-count-sm">({planSteps.length} steps)</span>
                  </summary>
                  <RetrievalPlan steps={planSteps} activeStep={planSteps.length} completed={true}/>
                </details>
              )}

              {/* Answer + sources grid */}
              <div className="ans-grid">
                <div className="ans-card">
                  <div className="ans-card-head">
                    <span className="ans-card-title">ANALYSIS</span>
                    {result.confidence&&(
                      <span className={`tag ${result.confidence.tier_color==="green"?"tag-green":result.confidence.tier_color==="yellow"?"tag-amber":"tag-red"}`}>
                        {Math.round(result.confidence.overall_score)}/100
                      </span>
                    )}
                  </div>
                  <AnswerBlock answer={cleanAnswer(result.answer||(typeof result.data==="string"?result.data:null))} sources={result.sources}/>
                  {Array.isArray(result.data)&&result.data.length>0&&(
                    <div className="ans-table-wrap">
                      <table className="ans-table">
                        <thead><tr>{Object.keys(result.data[0]).map(k=><th key={k}>{k}</th>)}</tr></thead>
                        <tbody>{result.data.map((row,i)=><tr key={i}>{Object.values(row).map((v,j)=><td key={j}>{v!=null?String(v):"—"}</td>)}</tr>)}</tbody>
                      </table>
                    </div>
                  )}
                </div>
                <SourcesPanel sources={result.sources}/>
              </div>

              {/* Confidence + cost */}
              <div className="meta-grid">
                <ConfidenceBreakdown confidence={result.confidence}/>
                <CostBreakdown cost={result.cost}/>
              </div>
            </div>
          )}

          {!loading&&!result&&!error&&!classification&&<LandingPage onExample={(q)=>{setQuery(q);handleSearch(q);}}/>}
        </div>
      </main>

      {/* Footer */}
      <footer className="ftr">
        <div className="ftr-left">
          <span className="ftr-status"><span className="status-dot"/>Online</span>
          {result?.route&&<span className="ftr-meta">Route: <strong>{result.route_name||ROUTE_LABELS[result.route]||result.route}</strong></span>}
          {result?.response_time!=null&&<span className="ftr-meta">{result.response_time.toFixed(2)}s</span>}
        </div>
        <div className="ftr-right">
          {sessionCost>0&&<span className="ftr-meta">Session: <strong>{fmtCost(sessionCost)}</strong></span>}
          <a href="https://github.com/Ashu290905/Financial-Intelligence-Engine" target="_blank" rel="noopener noreferrer" className="ftr-link">GitHub ↗</a>
        </div>
      </footer>
    </div>
  );
}