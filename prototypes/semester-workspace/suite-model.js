export const suiteKey='course-compass:design-suite:v1';
export const historyCourses=[
  {id:'h1',name:'程式設計',term:'1141',credits:3,score:88,group:'本系必修',status:'已通過'},
  {id:'h2',name:'微積分（一）',term:'1141',credits:3,score:76,group:'共同課程',status:'已通過'},
  {id:'h3',name:'英文閱讀',term:'1141',credits:3,score:85,group:'共同課程',status:'已通過'},
  {id:'h4',name:'臺灣文化與社會',term:'1141',credits:2,score:91,group:'通識',status:'已通過'},
  {id:'h5',name:'離散數學',term:'1141',credits:3,score:48,group:'本系必修',status:'未通過'},
  {id:'h6',name:'物件導向程式設計',term:'1142',credits:3,score:90,group:'本系必修',status:'已通過'},
  {id:'h7',name:'離散數學',term:'1142',credits:3,score:81,group:'本系必修',status:'已通過'},
  {id:'h8',name:'線性代數',term:'1142',credits:3,score:83,group:'本系必修',status:'已通過'},
  {id:'h9',name:'網頁程式設計',term:'1142',credits:3,score:92,group:'本系選修',status:'已通過'},
  {id:'h10',name:'Python 資料分析',term:'1142',credits:3,score:87,group:'本系選修',status:'已通過'},
  {id:'h11',name:'藝術與生活',term:'1142',credits:2,score:89,group:'通識',status:'已通過'},
];
export const initialSuite={future:[{id:'f1',name:'作業系統',credits:3,term:'1152',group:'本系必修'},{id:'f2',name:'貨幣銀行學',credits:3,term:'1161',group:'輔系'},{id:'f3',name:'畢業專題（一）',credits:2,term:'1171',group:'本系必修'}],notes:{},monitor:{},connection:'connected',email:false,synced:'尚未執行示範同步',imported:false,target:128};
export function restoreSuite(storage){
  try {
    const saved=JSON.parse(storage.getItem(suiteKey));
    if(!saved||!Array.isArray(saved.future))return initialSuite;
    const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
    return {...initialSuite,
      future:saved.future.filter(c=>c&&typeof c.id==='string'&&typeof c.name==='string'&&Number.isFinite(c.credits)&&c.credits>=0&&['1152','1161','1162','1171','1172'].includes(c.term)),
      notes:object(saved.notes),monitor:object(saved.monitor),recognition:object(saved.recognition),
      tracking:Array.isArray(saved.tracking)?[...new Set(saved.tracking.filter(x=>typeof x==='string'))]:[],
      pending:Array.isArray(saved.pending)?saved.pending.filter(c=>c&&typeof c.name==='string'&&['雙主修','輔系'].includes(c.group)):undefined,
      target:[128,132].includes(saved.target)?saved.target:128,
      email:saved.email===true,imported:saved.imported===true,
      connection:['connected','expired','offline'].includes(saved.connection)?saved.connection:'connected',
      synced:typeof saved.synced==='string'?saved.synced:initialSuite.synced
    };
  } catch{return initialSuite;}
}
export function passedCredits(records){return records.filter(c=>c.status==='已通過').reduce((sum,c)=>sum+c.credits,0);}
export function weightedScore(records){const scored=records.filter(c=>Number.isFinite(c.score));const credits=scored.reduce((s,c)=>s+c.credits,0);return credits?scored.reduce((s,c)=>s+c.score*c.credits,0)/credits:null;}
export function allHistory(suite){return suite.imported?[...historyCourses,{id:'import1',name:'科技與倫理',term:'1142',credits:2,score:86,group:'通識',status:'已通過'}]:historyCourses;}
export function gradeEstimate(parts){const weight=parts.reduce((sum,p)=>sum+Number(p.weight||0),0);const valid=weight===100&&parts.every(p=>p.score!==''&&Number(p.score)>=0&&Number(p.score)<=100&&Number(p.weight)>=0);return {weight,value:valid?parts.reduce((sum,p)=>sum+Number(p.weight)*Number(p.score)/100,0):null};}
