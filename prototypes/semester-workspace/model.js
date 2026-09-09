export const courses = [
  { id: 'CS201', name: '資料結構', teacher: '陳老師', credits: 3, category: '本系必修', color: 'blue', room: 'TR-311', slots: [[0,3,2],[2,4,1]], official: true, description: '從資料的組織方式出發，理解串列、樹與圖，建立演算法設計的基礎。' },
  { id: 'CS202', name: '計算機網路概論', teacher: '沈老師', credits: 3, category: '本系必修', color: 'blue', room: 'TR-309', slots: [[0,1,2],[2,3,1]], official: true, description: '認識網路分層架構、通訊協定與網際網路的運作方式。' },
  { id: 'CS203', name: '數位系統設計', teacher: '劉老師', credits: 3, category: '本系必修', color: 'blue', room: 'TR-313', slots: [[2,2,1],[3,6,2]], official: true, description: '學習數位邏輯與循序電路，透過實作理解系統設計。' },
  { id: 'BA201', name: '企業概論', teacher: '林老師', credits: 3, category: '雙主修', color: 'teal', room: 'IB-410', slots: [[0,6,3]], official: true, description: '從企業案例認識組織、行銷、財務與經營決策。' },
  { id: 'GE201', name: '環境與永續生活', teacher: '蔡老師', credits: 3, category: '通識', color: 'purple', room: 'TR-409', slots: [[3,1,3]], official: true, description: '以生活與環境議題探討永續發展，以及個人可以採取的行動。' },
  { id: 'FN201', name: '基礎理財規劃', teacher: '曹老師', credits: 3, category: '輔系', color: 'orange', room: 'TR-409', slots: [[4,6,3]], official: true, description: '建立財務規劃、風險與資產配置的基本概念。' },
  { id: 'BA302', name: '成本會計', teacher: '張老師', credits: 3, category: '雙主修', color: 'teal', room: 'TR-617', slots: [[1,2,3]], seats: 4, description: '運用成本資訊進行規劃與決策，理解成本分攤及預算管理。' },
  { id: 'BA304', name: '行銷管理', teacher: '許老師', credits: 3, category: '雙主修', color: 'teal', room: 'IB-401', slots: [[1,2,3]], seats: 5, description: '透過案例探討消費者行為、品牌定位與行銷策略。可在初選登記模式與成本會計同時列入志願草稿。' },
  { id: 'CS301', name: '資料庫系統', teacher: '黃老師', credits: 3, category: '本系選修', color: 'blue', room: 'TR-512', slots: [[4,2,3]], seats: 8, description: '學習關聯式資料模型、SQL、正規化與交易處理，透過專題設計資料庫。' },
  { id: 'CS302', name: '人工智慧概論', teacher: '王老師', credits: 3, category: '本系選修', color: 'blue', room: 'TR-310', slots: [[0,3,3]], seats: 12, description: '介紹搜尋、知識表示與機器學習，探索人工智慧的基礎方法。' },
  { id: 'BA303', name: '管理與企業倫理', teacher: '羅老師', credits: 3, category: '雙主修', color: 'teal', room: 'IB-502', slots: [[1,6,3]], seats: 0, description: '透過案例分析企業責任、利害關係人與管理倫理。額滿仍可加入本地預排。' },
  { id: 'GE302', name: '設計思考與實踐', teacher: '李老師', credits: 2, category: '通識', color: 'purple', room: 'IB-302', slots: [[2,6,2]], seats: 6, description: '從使用者觀察、問題定義到原型實作，以團隊合作探索解決方案。' },
  {id:'FN301',name:'貨幣銀行學',teacher:'周老師',credits:3,category:'輔系',color:'orange',room:'TR-610',slots:[[3,2,3]],seats:null,description:'認識金融體系、貨幣政策與銀行經營。',gpa:'查無資料'},
  {id:'3N101',name:'經濟學原理',teacher:'林老師',credits:3,category:'跨校',color:'teal',room:'臺大校本部',slots:[[4,6,3]],seats:0,cross:true,description:'以市場與總體經濟議題理解經濟學的基本方法。',notes:'跨校示範班別；須符合校際選課資格，並預留交通時間。'},
];
export const official = courses.filter(c => c.official);
export const defaultPlans = ['BA302'];
export const weekdays = ['一','二','三','四','五'];
export const times = ['08:10','09:10','10:20','11:20','12:20','13:20','14:20','15:30','16:30','17:30'];
export const storageKey = 'course-compass:semester-prototype:v1';
export function conflicts(course, selected) {
  return selected.filter(other => other.id !== course.id && course.slots.some(([day,start,length]) => other.slots.some(([d,s,l]) => day === d && start < s+l && s < start+length)));
}
export function slotText(course) {
  return course.slots.map(([day,start,length]) => `週${weekdays[day]} ${start}${length > 1 ? `–${start+length-1}` : ''} 節`).join('、');
}
export function restorePlans(storage) {
  try {
    const saved = storage.getItem(storageKey);
    if (!saved) return defaultPlans;
    const value = JSON.parse(saved);
    if (!Array.isArray(value)) return defaultPlans;
    return [...new Set(value.filter(id => courses.some(c => c.id === id && !c.official)))];
  } catch { return defaultPlans; }
}

export const modeStorageKey = `${storageKey}:mode`;
export function restoreMode(storage) {
  try { return storage.getItem(modeStorageKey) === 'lottery' ? 'lottery' : 'addDrop'; }
  catch { return 'addDrop'; }
}
export function canPlan(course, selected, mode) {
  return !selected.some(c => c.id === course.id) && (mode === 'lottery' || conflicts(course, selected).length === 0);
}

// Color meeting intervals independently for each weekday. All meetings in a
// connected overlap group share a lane count, so none cover another course.
export function layoutMeetings(selected, preview = null) {
  const items = selected.map(course => ({course, preview:false}));
  if (preview && !selected.some(c => c.id === preview.id)) items.push({course:preview, preview:true});
  const meetings = items.flatMap(item => item.course.slots.map(([day,start,length], index) => ({...item,day,start,length,end:start+length,key:`${item.course.id}-${index}`})));
  const output = [];
  for (let day=0; day<5; day++) {
    const dayItems = meetings.filter(m=>m.day===day).sort((a,b)=>a.start-b.start || b.end-a.end || a.key.localeCompare(b.key));
    let group = [], end = -1;
    function flush() {
      const laneEnds = [];
      for (const item of group) {
        let lane = laneEnds.findIndex(lastEnd=>lastEnd<=item.start);
        if (lane<0) lane=laneEnds.length;
        laneEnds[lane]=item.end;
        item.lane=lane;
      }
      output.push(...group.map(item=>({...item,laneCount:laneEnds.length})));
      group=[];
    }
    for (const item of dayItems) {
      if (item.start>=end && group.length) flush();
      group.push(item); end=Math.max(end,item.end);
    }
    flush();
  }
  return output;
}
