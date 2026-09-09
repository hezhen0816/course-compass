import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Compass, CalendarDays, Search, Plus, X, ArrowLeft, ArrowRight, Check, SlidersHorizontal, Clock3, MapPin, UserRound, BookOpen, RotateCcw, List, AlertTriangle, CheckCircle2, FlaskConical, ChevronRight, PanelRightClose, Maximize2 } from 'lucide-react';
import { courses, official, defaultPlans, weekdays, times, storageKey, conflicts, slotText, restorePlans, restoreMode, modeStorageKey, canPlan, layoutMeetings } from './model.js';
import './style.css';
import { catalog, metadata, initialFilters, filterCatalog } from './search-model.js';
import { SearchTools, PlanningTray, DetailExtras } from './SearchTools.jsx';

function App() {
  const [plans, setPlans] = useState(() => restorePlans(window.localStorage));
  const [mode, setMode] = useState(() => restoreMode(window.localStorage));
  const isLottery = mode === 'lottery';
  const planLabel = isLottery ? '志願草稿' : '預排中';
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部課程');
  const [onlyFree, setOnlyFree] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const [pending, setPending] = useState([{name:'貨幣銀行學',group:'輔系'}]);
  const [tracking, setTracking] = useState([]);
  const [recognition, setRecognition] = useState({});
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  const [panel, setPanel] = useState(() => !window.matchMedia('(max-width: 900px)').matches);
  const [detail, setDetail] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [view, setView] = useState(() => window.matchMedia('(max-width: 600px)').matches ? 'list' : 'week');
  const panelRef = useRef(null);
  const [notice, setNotice] = useState('');
  const [storageError, setStorageError] = useState(false);
  const searchRef = useRef(null);
  const backRef = useRef(null);
  const planned = courses.filter(c => plans.includes(c.id));
  const selected = [...official, ...planned];
  const selectedIds = selected.map(c => c.id);
  const preview = detail?.historical ? null : detail || hovered;
  const previewConflicts = preview ? conflicts(preview, selected) : [];
  const meetings = layoutMeetings(selected, preview);
  const overlappingPlans = planned.filter(c => conflicts(c, selected).length);
  const results = filterCatalog(query, category, onlyFree, filters, selected);
  function clearFilters() { setQuery(''); setCategory('全部課程'); setOnlyFree(false); setFilters(prev=>({...initialFilters,semester:prev.semester})); setHovered(null); }

  useEffect(() => { try { window.localStorage.setItem(storageKey, JSON.stringify(plans)); setStorageError(false); } catch { setStorageError(true); } }, [plans]);
  useEffect(() => { try { window.localStorage.setItem(modeStorageKey, mode); } catch { /* Mode remains usable in memory. */ } }, [mode]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (detail) backRef.current?.focus(); }, [detail]);
  useEffect(() => {
    function key(event) {
      if (event.key === 'Escape') { if (detail) { setDetail(null); setTimeout(() => searchRef.current?.focus(), 0); } else if (expanded) { setExpanded(false); } else { setPanel(false); } setHovered(null); }
    }
    window.addEventListener('keydown',key); return () => window.removeEventListener('keydown',key);
  }, [detail, expanded]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => setCompact(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!compact || !panel) return;
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (searchRef.current || backRef.current)?.focus();
    function trap(event) {
      if (event.key !== 'Tab') return;
      const elements = [...panelRef.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter(element=>element.getClientRects().length>0);
      const first = elements[0], last = elements[elements.length-1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener('keydown', trap);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, [compact, panel]);

  function returnToSchedule() { setExpanded(false); setDetail(null); setHovered(null); setPanel(true); setTimeout(() => searchRef.current?.focus(), 0); }
  function openSearch() { setDetail(null); setPanel(true); setTimeout(() => searchRef.current?.focus(), 0); }
  function openDetail(course) { setDetail(metadata(course)); setHovered(null); setPanel(true); }
  function add(course) {
    if (course.historical || !canPlan(course, selected, mode)) return;
    setPlans(prev => [...prev, course.id]);
    setNotice(`已將「${course.name}」加入${isLottery?'志願草稿':'預排'}，尚未送出官方選課。`);
  }
  function remove(course) { setPlans(prev => prev.filter(id => id !== course.id)); setNotice(`已移除「${course.name}」的${isLottery?'志願草稿':'預排'}。`); }
  function switchMode(nextMode) { setMode(nextMode); setOnlyFree(false); setHovered(null); }
  function reset() { setPlans(defaultPlans); setDetail(null); setHovered(null); setQuery(''); setCategory('全部課程'); setOnlyFree(false); setFilters(initialFilters); setPending([{name:'貨幣銀行學',group:'輔系'}]); setTracking([]); setRecognition({}); setNotice('已還原示範課表。'); }
  const plannedCredits = planned.reduce((sum,c) => sum+c.credits,0);

  return <div className={`app ${panel ? 'panel-open' : ''} ${panel && expanded && !compact ? 'search-expanded' : ''}`}>
    <a className="skip" href="#main">跳至課表</a>
    <nav className="rail" aria-label="主要導覽">
      <a className="brand" href="#main" aria-label="修課羅盤首頁"><Compass size={28}/></a>
      <button className={`rail-item ${expanded && panel && !compact ? '' : 'active'}`} onClick={() => { setExpanded(false); setPanel(false); setDetail(null); }} aria-label="本學期"><CalendarDays size={21}/><span>本學期</span></button>
      <button className={`rail-item ${expanded && panel && !compact ? 'active' : panel ? 'selected' : ''}`} onClick={openSearch} aria-label="找課"><Search size={21}/><span>找課</span></button>
      <div className="rail-bottom"><FlaskConical size={19}/><span>原型</span></div>
    </nav>
    <div className="shell">
      <header className="topbar"><div className="wordmark">修課羅盤 <span>Course Compass</span></div><div className="prototype-label"><FlaskConical size={14}/>互動原型 · 模擬資料</div></header>
      <main id="main">
        <div className="page-heading"><div><div className="eyebrow">115 學年度 · 第一學期</div><h1>把這學期，安排好。</h1><p>看清已選課程，為下一門課留個位置。</p></div><button className="reset subtle" onClick={reset}><RotateCcw size={15}/>重設示範</button></div>
        <div className="phase-bar"><div className="phase-controls"><span>規劃模式</span><div className="segmented"><button aria-pressed={isLottery} className={isLottery?'chosen':''} onClick={()=>switchMode('lottery')}>初選志願登記</button><button aria-pressed={!isLottery} className={!isLottery?'chosen':''} onClick={()=>switchMode('addDrop')}>加退選</button></div></div><p>{isLottery?'情境預覽 · 同時段可放多門志願，尚未抽選。':'加退選／初選後繼續選課 · 新增前先處理衝堂。'}</p></div>
        <div className="summary"><div><span className="status-dot blue"/>已選上 <strong>18</strong><span>學分</span><small>6 門課</small></div><div><span className="status-dot amber"/>{isLottery?'志願總量':'預排中'} <strong>{plannedCredits}</strong><span>學分</span><small>{planned.length} 門課</small></div><div className="summary-note"><CheckCircle2 size={16}/>{isLottery?'含重疊志願，不代表可同時修讀':'已選與預排分開計算'}</div></div>
        <div className="workspace">
          <section className="calendar-section" aria-label="本學期課表">
            <div className="calendar-toolbar"><div><h2>我的課表</h2><span className="muted">每週固定課程</span></div><div className="calendar-actions"><div className="segmented" aria-label="課表檢視"><button aria-label="週課表" className={view==='week'?'chosen':''} aria-pressed={view==='week'} onClick={() => setView('week')}><CalendarDays size={15}/><span>週課表</span></button><button aria-label="清單" className={view==='list'?'chosen':''} aria-pressed={view==='list'} onClick={() => setView('list')}><List size={15}/><span>清單</span></button></div><button className="primary add-course" onClick={openSearch}><Plus size={16}/>找課預排</button></div></div>
            <div className={`overlap-notice ${isLottery?'lottery':'add-drop'}`} role="status">{isLottery?<List size={17}/>:<AlertTriangle size={17}/>}<div><strong>{isLottery?'同時段可以有多個選擇':overlappingPlans.length?'有重疊課程需要處理':'新增前檢查衝堂'}</strong><p>{isLottery?'重疊志願會並排顯示，不會互相遮住；不等於都能選上。':overlappingPlans.length?`保留了 ${overlappingPlans.length} 門有重疊時段的草稿，請逐一確認並移除不採用的預排。切換模式不會自動刪課。`:'此模式會阻擋新增衝堂課程；你可以切到初選志願登記，先放入同時段的其他選擇。'}</p></div></div>
            <div className="legend"><span><i className="blue"/>本系</span><span><i className="teal"/>雙主修</span><span><i className="purple"/>通識</span><span><i className="orange"/>輔系</span><span className="planned-key">虛線框：{planLabel}</span></div>
            {view === 'week' ? <div className="calendar-scroll"><div className="calendar">
              <div className="day-corner">節次</div>{weekdays.map(day => <div key={day} className="day-header">週{day}</div>)}
              {times.map((time,index) => <React.Fragment key={time}><div className={`time-label ${index===4?'lunch':''}`} style={{gridColumn:1,gridRow:index+2}}><b>{index+1}</b><span>{time}</span></div>{weekdays.map((day,d) => <div key={day} className={`grid-cell ${index===4?'lunch':''}`} style={{gridColumn:d+2,gridRow:index+2}}>{index===4 && d===2 ? <span>午間休息</span>:null}</div>)}</React.Fragment>)}
              {meetings.map(event => {
                const {course,day,start,length,lane,laneCount} = event;
                const overlap = laneCount > 1;
                const tone = event.preview ? `preview ${overlap&&!isLottery?'conflict-preview':''}` : `${course.color} ${course.official?'official':'planned'}`;
                const style = {gridColumn:day+2,gridRow:`${start+1} / span ${length}`,width:`calc(${100/laneCount}% - 6px)`,marginLeft:`calc(${lane*100/laneCount}% + 3px)`};
                const content = <><strong>{course.name}</strong>{length>1 && <><span>{course.teacher}{laneCount===1?` · ${course.room}`:''}</span><small>{event.preview?(overlap?(isLottery?'同時段候選':'時段衝突'):'加入後的位置'):course.official?'已選上':planLabel}</small></>}</>;
                return event.preview ? <div key={event.key} className={`course-block ${tone} ${overlap?'multi-course':''}`} style={style}>{content}</div> : <button key={event.key} className={`course-block ${tone} ${overlap?'multi-course':''} ${overlap&&!isLottery?'conflict-target':''} ${detail?.id===course.id?'focused':''}`} style={style} onClick={()=>openDetail(course)} aria-label={`${course.name}，${course.official?'已選上':planLabel}，${slotText(course)}${overlap?`，${isLottery?'同時段多課':'有時段重疊'}`:''}`}>{content}</button>;
              })}
            </div></div> : <div className="schedule-list">{selected.map(c => <button key={c.id} className="schedule-row" onClick={() => openDetail(c)}><span className={`course-mark ${c.color}`}><BookOpen size={18}/></span><span><strong>{c.name}</strong><small>{slotText(c)} · {c.room}</small></span><span className={`badge ${c.official?'neutral':'amber'}`}>{c.official?'已選上':planLabel}</span><ChevronRight size={16}/></button>)}</div>}
            <div className="calendar-footer"><span><Check size={14}/>{storageError?'暫時無法儲存，重整後可能遺失預排':'預排自動儲存在此瀏覽器'}</span><span>點選課程查看詳情</span></div>
            <div className="planning-note"><div className="note-icon"><BookOpen size={20}/></div><div><strong>{isLottery?'先保留選擇，再看抽選結果。':'先試排，再做決定。'}</strong><p>{isLottery?'初選上機登記可放入同時段志願；抽選後的繼續選課已是先選先上，請切換加退選規劃模式。':'預排課程只用來比較時間安排，不代表已選上，也不計入已完成學分。'}</p></div></div>
          </section>
          {panel && <><button className="mobile-backdrop" aria-label="關閉找課側欄" onClick={() => { setPanel(false); setDetail(null); }}/><aside ref={panelRef} role={compact ? "dialog" : undefined} aria-modal={compact ? true : undefined} className="search-panel" aria-label={detail?'課程詳情':expanded&&!compact?'完整找課':'找課側欄'}>
            <div className="panel-heading"><div><span className="eyebrow">{detail?'COURSE DETAILS':'FIND YOUR NEXT COURSE'}</span><h2>{detail?'課程詳情':expanded&&!compact?(filters.semester==='1151'?'探索本學期課程':'探索歷史開課'):'下一門，想學什麼？'}</h2></div><div className="panel-actions">{!compact && <button className="subtle expand-search" onClick={() => expanded ? returnToSchedule() : (setExpanded(true), setHovered(null))}>{expanded?<ArrowLeft size={16}/>:<Maximize2 size={16}/>} {expanded?'回到課表':'展開找課'}</button>}<button className="icon-button" aria-label="關閉側欄" onClick={() => {setExpanded(false);setPanel(false);setDetail(null);setHovered(null);}}><PanelRightClose size={19}/></button></div></div>
            {detail ? <div className="detail"><button ref={backRef} className="back subtle" onClick={openSearch}><ArrowLeft size={16}/>回到找課</button><div className={`detail-symbol ${detail.color}`}><BookOpen size={26}/></div><div className="detail-category">{detail.category} · {detail.code||detail.id}</div><h3>{detail.name}</h3><span className={`badge ${detail.official?'neutral':plans.includes(detail.id)?'amber':'blue'}`}>{detail.historical?'114-1 歷史參考':detail.official?'已選上':plans.includes(detail.id)?planLabel:'尚未加入'}</span><dl><div><dt><UserRound size={16}/>授課教師</dt><dd>{detail.teacher}</dd></div><div><dt><BookOpen size={16}/>學分</dt><dd>{detail.credits} 學分</dd></div><div><dt><Clock3 size={16}/>上課時間</dt><dd>{slotText(detail)}</dd></div><div><dt><MapPin size={16}/>教室</dt><dd>{detail.room}</dd></div></dl><h4>這門課在學什麼</h4><p className="description">{detail.description}</p>
            {!detail.historical && !selectedIds.includes(detail.id) && <div className={`fit-box ${previewConflicts.length&&!isLottery?'warning':'success'}`}>{previewConflicts.length?<AlertTriangle size={19}/>:<CheckCircle2 size={19}/>}<div><strong>{previewConflicts.length?(isLottery?'同時段志願，可以加入':'與目前課表衝堂'):'時間剛剛好'}</strong><p>{previewConflicts.length?`與「${previewConflicts.map(c=>c.name).join('、')}」時段重疊。${isLottery?'初選登記可保留多個選擇；最終結果以學校抽選為準。':'請選擇其他課程，或先移除衝突的預排課程。'}`:'與已選及預排課程皆無衝突，可加入課表比較。'}</p></div></div>}
            {detail.seats === 0 && <p className="capacity-note">模擬名額：已額滿。仍可預排，但不代表能完成官方選課。</p>}
            <div className="detail-action">{detail.historical?<div className="history-banner">歷史課程不能加入本學期課表。</div>:detail.official?<div className="official-note"><CheckCircle2 size={17}/>官方已選示範資料 · 僅供檢視</div>:plans.includes(detail.id)?<button className="danger-button" onClick={() => remove(detail)}>{isLottery?'移除志願草稿':'移除預排'}</button>:<button className="primary wide" disabled={!canPlan(detail,selected,mode)} onClick={() => add(detail)}><Plus size={17}/>{previewConflicts.length&&!isLottery?'衝堂，暫時無法預排':isLottery?'加入志願草稿':'加入預排'}</button>}<small>這裡的所有課程與名額皆為示範資料</small></div><DetailExtras key={detail.id} course={detail} tracked={tracking.includes(detail.id)} toggleTrack={()=>setTracking(prev=>prev.includes(detail.id)?prev.filter(id=>id!==detail.id):[...prev,detail.id])} recognition={recognition[detail.id]} onRecognition={value=>setRecognition(prev=>({...prev,[detail.id]:value}))}/></div> : <>
            <div className="search-controls"><label className="search-input"><Search size={18}/><input ref={searchRef} aria-label="搜尋課名、課碼或教師" placeholder="搜尋課名、課碼或教師" value={query} onChange={e => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="清除搜尋" onClick={() => setQuery('')}><X size={15}/></button>}</label><div className="filter-line"><select aria-label="課程類別" value={category} onChange={e => setCategory(e.target.value)}>{['全部課程','本系必修','本系選修','雙主修','輔系','通識','跨校'].map(c=><option key={c}>{c}</option>)}</select><button className={`filter-button ${advanced?'on':''}`} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><SlidersHorizontal size={15}/>篩選</button></div>{advanced && <label className="filter-check"><input type="checkbox" checked={onlyFree} disabled={filters.semester!=='1151'} onChange={e => setOnlyFree(e.target.checked)}/>{isLottery?'只顯示無時段重疊課程':'只顯示不衝堂課程'}</label>}<SearchTools filters={filters} setFilters={update=>{const next=typeof update==='function'?update(filters):update;if(next.semester!==filters.semester)setOnlyFree(false);setFilters(next);setHovered(null);}} advanced={advanced} clear={clearFilters} results={results}/><div className="results-heading"><span>{query?'搜尋結果':filters.semester==='1151'?'探索本學期課程':'歷史開課參考'}</span><small>{filters.state==='ready'?`${results.length} 門`:'等待查詢結果'}</small></div></div>
            {expanded && !compact && <div className="comparison-heading" aria-hidden="true"><span>課程／教師</span><span>類別／學分</span><span>上課時間</span><span>規劃狀態／模擬名額</span></div>}<div className="results">{filters.state!=='ready'?<div className="empty" role="status"><Search size={28}/><h3>{filters.state==='loading'?'正在查詢課程…':'課程暫時無法載入'}</h3><p>{filters.state==='loading'?'條件與預排會保留。這是載入畫面的示範。':'目前沒有可用結果，請重試；你的預排不受影響。'}</p><button className="secondary" onClick={()=>setFilters(prev=>({...prev,state:'ready'}))}>{filters.state==='loading'?'完成模擬載入':'重試'}</button></div>:results.length===0?<div className="empty"><Search size={28}/><h3>還沒找到符合的課程</h3><p>試試其他關鍵字，或放寬篩選條件。</p><button className="subtle" onClick={clearFilters}>清除所有條件</button></div>:results.map(course => {const clash=conflicts(course, selected); const isSelected=selectedIds.includes(course.id); return <button key={course.id} className="result" onClick={()=>openDetail(course)} onMouseEnter={()=>setHovered(course.historical?null:course)} onMouseLeave={()=>setHovered(null)} onFocus={()=>setHovered(course.historical?null:course)} onBlur={()=>setHovered(null)}><div className="result-top"><span className={`category-label ${course.color}`}>{course.category}</span><span className="credits">{course.credits} 學分</span></div><div className="result-title"><h3>{course.name}</h3><ArrowRight size={16}/></div><p>{course.teacher} <span>·</span> {course.code||course.id}</p><div className="result-time"><Clock3 size={13}/>{slotText(course)}</div><div className="result-bottom"><span className={isSelected?'planned-text':clash.length?'warning-text':'success-text'}>{isSelected?<Check size={13}/>:clash.length?<AlertTriangle size={13}/>:<CheckCircle2 size={13}/>} {course.historical?'歷史參考':course.official?'已選上':isSelected?(isLottery?'已加入志願草稿':'已加入預排'):clash.length?(isLottery?'同時段可登記':'與課表衝堂'):'無時段重疊'}</span><span>{course.historical?'114-1 開課':course.seats==null?'名額未公告':course.seats===0?'模擬：額滿':`模擬餘額 ${course.seats} 人`}</span></div></button>;})}</div><PlanningTray items={pending} setItems={setPending} onSearch={name=>{setQuery(name);setCategory('全部課程');setOnlyFree(false);setFilters(initialFilters);searchRef.current?.focus();}} tracked={catalog.filter(c=>tracking.includes(c.id))} onUntrack={id=>setTracking(prev=>prev.filter(x=>x!==id))}/><div className="panel-footnote">{expanded&&!compact?'選取課程查看詳情；回到課表可比較實際時段。':'選取課程，在課表預覽時段。'}</div></>}
          </aside></>}
        </div>
        <div className="prototype-scenarios"><label>查詢畫面示範 <select value={filters.state} onChange={e=>{setFilters(prev=>({...prev,state:e.target.value}));openSearch();}}><option value="ready">正常結果</option><option value="loading">載入中</option><option value="error">連線失敗</option></select></label><span>示範名額非即時資料 · 待修、追蹤與認列用途僅保留於本次頁面</span></div><footer className="page-footer">設計探索 01 <span>本學期工作區</span><span>本機原型，不連接校務系統</span></footer>
      </main>
    </div>
    {notice && <div className="toast" role="status"><CheckCircle2 size={18}/>{notice}<button className="icon-button" aria-label="關閉提示" onClick={()=>setNotice('')}><X size={16}/></button></div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
