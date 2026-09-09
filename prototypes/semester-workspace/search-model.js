import { courses, conflicts, slotText } from './model.js';

export const initialFilters = { semester:'1151', teacher:'', credits:'', required:'', day:'', period:'', capacity:'', department:'', exact:false, cross:false, sort:'default', state:'ready' };
export const departments = { CS:'資訊工程系', BA:'企業管理系', GE:'通識教育中心', FN:'財務金融系', '3N':'臺灣大學', '3T':'臺灣師範大學' };
export function metadata(c) {
  return { semester:'1151', required:c.category==='本系必修'?'必修':'選修', department:departments[c.id.slice(0,2)] || '跨校課程', gpa:'未啟用', notes:'示範開課資料；修課資格與認列須另行確認。', ...c };
}
export const catalog = courses.map(metadata).concat([
  metadata({id:'CS301-1141',code:'CS301',name:'資料庫系統',teacher:'吳老師',credits:3,category:'本系選修',color:'blue',room:'TR-510',slots:[[2,2,3]],seats:null,semester:'1141',historical:true,description:'歷史課綱示範：關聯模型、SQL 與交易處理。',gpa:'3.72（模擬）',notes:'114-1 歷史開課範例，不代表 115-1 的教師、時段或開課承諾。'})
]);
export function filterCatalog(query, category, onlyFree, filters, selected) {
  const normalize=s=>s.replace(/[（）]/g,m=>m==='（'?'(':')').replace(/\s+/g,'').toLowerCase();
  const terms=query.split(/[／/、,，]/).map(s=>s.trim()).filter(Boolean);
  return catalog.filter(c => c.semester===filters.semester && (!c.cross||filters.cross)
    && (!terms.length || terms.some(t=>filters.exact?normalize(c.name)===normalize(t):`${c.name} ${c.code||c.id} ${c.teacher}`.toLowerCase().includes(t.toLowerCase())))
    && (category==='全部課程'||c.category===category)
    && (!filters.teacher||c.teacher.includes(filters.teacher.trim()))
    && (!filters.department||c.department===filters.department)
    && (!filters.credits||String(c.credits)===filters.credits)
    && (!filters.required||c.required===filters.required)
    && ((!filters.day&&!filters.period)||c.slots.some(([day,start,length])=>(!filters.day||day===Number(filters.day)-1)&&(!filters.period||(Number(filters.period)>=start&&Number(filters.period)<start+length))))
    && (!filters.capacity||(filters.capacity==='available'?c.seats>0:filters.capacity==='full'?c.seats===0:c.seats==null))
    && (!onlyFree||(!c.historical&&conflicts(c,selected).length===0)))
    .sort((a,b)=>filters.sort==='credits'?b.credits-a.credits:filters.sort==='seats'?(b.seats??-1)-(a.seats??-1):filters.sort==='name'?a.name.localeCompare(b.name,'zh-TW'):Number(!!a.official)-Number(!!b.official));
}
export function resultCsv(results) {
  const escape=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replace(/"/g,'""')+'"';
  const rows=[['資料性質','學期','課碼','課名','開課系所','教師','學分','必選修','時段','教室','模擬剩餘名額','GPA','備註'],...results.map(c=>['模擬資料',c.semester,c.code||c.id,c.name,c.department,c.teacher,c.credits,c.required,slotText(c),c.room,c.seats??'未公告',c.gpa,c.notes])];
  return '\uFEFF'+rows.map(row=>row.map(escape).join(',')).join('\r\n');
}
