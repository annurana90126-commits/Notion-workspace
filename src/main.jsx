import React,{useState,useEffect,useReducer,useRef,useContext,createContext,memo} from 'react';
import {createRoot} from 'react-dom/client';
import htm from 'htm';
import './styles.css';
const html=htm.bind(React.createElement);
const uid=()=>Math.random().toString(36).slice(2,9);
const KEY='notebook-ws-v1';
const mkBlock=(type='text',content='')=>({id:uid(),type,content,...(type==='todo'?{checked:false}:{}),...(type==='table'?{content:[['',''],['','']]}:{})});
const mkPage=(title='Untitled',parentId=null)=>({id:uid(),title,parentId,blocks:[mkBlock()],children:[]});

/* ---------- state: pages map + roots, wrapped in undo/redo history ---------- */
function seed(){
  const a=mkPage('Welcome'),b=mkPage('Try the shortcuts',a.id);
  a.children=[b.id];
  a.blocks=[mkBlock('h1','Your workspace'),mkBlock('text','Type "# " for a heading, "> " for a quote, "- " for a checklist item, or "` " for code.'),mkBlock('todo','Drag the ⋮⋮ handle to reorder blocks'),mkBlock('quote','Ctrl+K searches everything. Ctrl+Z undoes.')];
  b.blocks=[mkBlock('text','Enter adds a block, Backspace on an empty block removes it, arrow keys move between blocks, Ctrl+D duplicates.')];
  return {pages:{[a.id]:a,[b.id]:b},roots:[a.id],current:a.id};
}
function load(){try{const s=JSON.parse(localStorage.getItem(KEY));if(s&&s.pages&&Object.keys(s.pages).length)return s}catch(e){}return seed()}
const desc=(P,id)=>[id,...P[id].children.flatMap(c=>desc(P,c))];
const upd=(s,pid,fn)=>({...s,pages:{...s.pages,[pid]:fn(s.pages[pid])}});
const setBlocks=(s,pid,fn)=>upd(s,pid,p=>({...p,blocks:fn(p.blocks)}));
function core(s,a){
  const P=s.pages;
  switch(a.t){
    case'go':return{...s,current:a.id};
    case'addPage':{const p=mkPage('Untitled',a.parent);let n={...s,pages:{...P,[p.id]:p},current:p.id};
      if(a.parent)n=upd(n,a.parent,q=>({...q,children:[...q.children,p.id]}));else n.roots=[...s.roots,p.id];return n}
    case'rename':return upd(s,a.id,p=>({...p,title:a.v}));
    case'delPage':{const gone=new Set(desc(P,a.id)),np={};for(const k in P)if(!gone.has(k))np[k]=P[k];
      const par=P[a.id].parentId;if(par)np[par]={...np[par],children:np[par].children.filter(c=>c!==a.id)};
      const roots=s.roots.filter(r=>r!==a.id);const cur=gone.has(s.current)?(par||roots[0]||null):s.current;
      if(!Object.keys(np).length){const p=mkPage();return{pages:{[p.id]:p},roots:[p.id],current:p.id}}
      return{pages:np,roots,current:cur||Object.keys(np)[0]}}
    case'dupPage':{const np={...P};const cp=(id,par)=>{const o=P[id],n={...o,id:uid(),parentId:par,title:par===o.parentId&&id===a.id?o.title+' copy':o.title,blocks:o.blocks.map(b=>({...b,id:uid()}))};
        np[n.id]=n;n.children=o.children.map(c=>cp(c,n.id));return n.id};
      const nid=cp(a.id,P[a.id].parentId);let n={...s,pages:np,current:nid};const par=P[a.id].parentId;
      if(par)n.pages[par]={...np[par],children:[...np[par].children,nid]};else n.roots=[...s.roots,nid];return n}
    case'movePage':{if(a.id===a.to||desc(P,a.id).includes(a.to))return s;const np={...P},old=P[a.id].parentId;
      if(old)np[old]={...np[old],children:np[old].children.filter(c=>c!==a.id)};
      np[a.id]={...np[a.id],parentId:a.to};
      let roots=s.roots.filter(r=>r!==a.id);
      if(a.to)np[a.to]={...np[a.to],children:[...np[a.to].children,a.id]};else roots=[...roots,a.id];
      return{...s,pages:np,roots}}
    case'addBlock':return setBlocks(s,a.pid,b=>{const c=[...b];c.splice(a.i,0,a.block);return c});
    case'edit':return setBlocks(s,a.pid,b=>b.map(x=>x.id===a.bid?{...x,...a.patch}:x));
    case'delBlock':return setBlocks(s,a.pid,b=>b.length>1?b.filter(x=>x.id!==a.bid):[mkBlock()]);
    case'dupBlock':return setBlocks(s,a.pid,b=>{const i=b.findIndex(x=>x.id===a.bid),c=[...b];c.splice(i+1,0,{...b[i],id:a.nid,content:JSON.parse(JSON.stringify(b[i].content))});return c});
    case'moveBlock':return setBlocks(s,a.pid,b=>{const c=[...b],i=c.findIndex(x=>x.id===a.from),[m]=c.splice(i,1);let j=c.findIndex(x=>x.id===a.to);c.splice(j<0?c.length:j,0,m);return c});
  }return s;
}
function reducer(h,a){
  if(a.t==='undo')return h.past.length?{...h,past:h.past.slice(0,-1),present:h.past.at(-1),future:[h.present,...h.future],k:''}:h;
  if(a.t==='redo')return h.future.length?{past:[...h.past,h.present],present:h.future[0],future:h.future.slice(1),k:''}:h;
  const next=core(h.present,a);if(next===h.present)return h;
  if(a.t==='go')return{...h,present:next};
  const key=a.t==='edit'||a.t==='rename'?a.t+(a.bid||a.id):'',now=Date.now();
  const merge=key&&key===h.k&&now-h.at<1200;
  return{past:merge?h.past:[...h.past.slice(-99),h.present],present:next,future:[],k:key,at:now};
}
const WS=createContext();

/* ---------- blocks ---------- */
const focusReq={id:null,end:true};
const RULES=[[/^# $/,'h1'],[/^## $/,'h2'],[/^> $/,'quote'],[/^(- |\[\] )$/,'todo'],[/^(` |```)$/,'code']];
function Auto({value,onChange,onKeyDown,bid,cls,ph}){
  const r=useRef();
  useEffect(()=>{const e=r.current;e.style.height='auto';e.style.height=e.scrollHeight+'px'},[value]);
  useEffect(()=>{if(focusReq.id===bid){r.current.focus();const n=focusReq.end?r.current.value.length:0;r.current.setSelectionRange(n,n);focusReq.id=null}});
  return html`<textarea ref=${r} rows=1 className=${'in '+cls} data-bid=${bid} value=${value} placeholder=${ph} onChange=${onChange} onKeyDown=${onKeyDown} spellCheck=${cls!=='code'}/>`;
}
const Block=memo(function Block({pid,b,i,n}){
  const {dispatch}=useContext(WS);const [over,setOver]=useState(false);
  const patch=p=>dispatch({t:'edit',pid,bid:b.id,patch:p});
  const focusAt=(k,end)=>{const el=document.querySelectorAll('[data-bid]');const all=[...el].map(e=>e.dataset.bid);const cur=all.indexOf(b.id);const t=all[cur+k];if(t){focusReq.id=t;focusReq.end=end;dispatch({t:'noop'});const e2=document.querySelector(`[data-bid="${t}"]`);e2&&e2.focus()}};
  const change=e=>{const v=e.target.value;
    if(b.type==='text'){for(const[re,ty]of RULES)if(re.test(v)){focusReq.id=b.id;return patch({type:ty,content:'',...(ty==='todo'?{checked:false}:{})})}}
    patch({content:v})};
  const key=e=>{
    if(e.key==='Enter'&&!e.shiftKey&&b.type!=='code'){e.preventDefault();const nb=mkBlock(b.type==='todo'?'todo':'text');focusReq.id=nb.id;focusReq.end=true;dispatch({t:'addBlock',pid,i:i+1,block:nb})}
    else if(e.key==='Backspace'&&b.content===''){e.preventDefault();if(b.type!=='text'){patch({type:'text'})}else if(n>1){focusAt(-1,true);dispatch({t:'delBlock',pid,bid:b.id})}}
    else if(e.key==='ArrowUp'&&e.target.selectionStart===0){e.preventDefault();focusAt(-1,true)}
    else if(e.key==='ArrowDown'&&e.target.selectionStart===e.target.value.length){e.preventDefault();focusAt(1,false)}
    else if((e.ctrlKey||e.metaKey)&&e.key==='d'){e.preventDefault();const nid=uid();focusReq.id=nid;dispatch({t:'dupBlock',pid,bid:b.id,nid})}
    else if((e.ctrlKey||e.metaKey)&&e.altKey&&/^[0-9]$/.test(e.key)){e.preventDefault();patch({type:['text','h1','h2','todo','quote','code'][+e.key]||'text'})}
  };
  const P={value:b.content,onChange:change,onKeyDown:key,bid:b.id};let body;
  if(b.type==='todo')body=html`<div className=${'todo'+(b.checked?' done':'')}><input type="checkbox" checked=${!!b.checked} onChange=${e=>patch({checked:e.target.checked})}/><${Auto} ...${P} cls="" ph="To-do"/></div>`;
  else if(b.type==='image')body=html`<div className="img">${b.content&&html`<img src=${b.content} alt=""/>`}<input className="in" placeholder="Paste an image URL" value=${b.content} onChange=${e=>patch({content:e.target.value})}/></div>`;
  else if(b.type==='table'){const set=(r,c,v)=>patch({content:b.content.map((row,ri)=>row.map((x,ci)=>ri===r&&ci===c?v:x))});
    body=html`<div><table><tbody>${b.content.map((row,r)=>html`<tr key=${r}>${row.map((x,c)=>html`<td key=${c}><input className="in" value=${x} onChange=${e=>set(r,c,e.target.value)}/></td>`)}</tr>`)}</tbody></table>
      <button onClick=${()=>patch({content:[...b.content,b.content[0].map(()=>'')]})}>+ row</button><button onClick=${()=>patch({content:b.content.map(r=>[...r,''])})}>+ column</button></div>`}
  else body=html`<${Auto} ...${P} cls=${b.type} ph=${b.type==='text'?"Type '/' … or start writing":b.type==='code'?'Code':b.type==='quote'?'Quote':'Heading'}/>`;
  const drag=e=>{e.dataTransfer.setData('text/block',b.id);e.dataTransfer.effectAllowed='move'};
  return html`<div className=${'blk'+(over?' over':'')} onDragOver=${e=>{if(e.dataTransfer.types.includes('text/block')){e.preventDefault();setOver(true)}}} onDragLeave=${()=>setOver(false)}
    onDrop=${e=>{const from=e.dataTransfer.getData('text/block');setOver(false);if(from&&from!==b.id){e.preventDefault();dispatch({t:'moveBlock',pid,from,to:b.id})}}}>
    <span className="grip" draggable onDragStart=${drag} title="Drag to reorder">⋮⋮</span>
    <div className="body">${body}</div>
    <select className="type" value=${b.type} onChange=${e=>patch({type:e.target.value,...(e.target.value==='table'&&!Array.isArray(b.content)?{content:[['',''],['','']]}:{}),...(typeof b.content!=='string'&&e.target.value!=='table'?{content:''}:{})})} aria-label="Block type">
      ${[['text','Text'],['h1','Heading 1'],['h2','Heading 2'],['todo','Checklist'],['code','Code'],['quote','Quote'],['image','Image'],['table','Table']].map(([v,l])=>html`<option key=${v} value=${v}>${l}</option>`)}</select>
    <button className="bx" title="Delete block" onClick=${()=>dispatch({t:'delBlock',pid,bid:b.id})}>✕</button></div>`;
});

/* ---------- sidebar tree ---------- */
function Node({id,depth}){
  const {s,dispatch}=useContext(WS);const p=s.pages[id];const [open,setOpen]=useState(true);const [over,setOver]=useState(false);
  if(!p)return null;
  return html`<div>
    <div className=${'row'+(s.current===id?' cur':'')+(over?' over':'')} style=${{paddingLeft:4+depth*14}} draggable onDragStart=${e=>{e.dataTransfer.setData('text/page',id);e.stopPropagation()}}
      onDragOver=${e=>{if(e.dataTransfer.types.includes('text/page')){e.preventDefault();setOver(true)}}} onDragLeave=${()=>setOver(false)}
      onDrop=${e=>{const f=e.dataTransfer.getData('text/page');setOver(false);if(f){e.preventDefault();e.stopPropagation();dispatch({t:'movePage',id:f,to:id});setOpen(true)}}} onClick=${()=>dispatch({t:'go',id})}>
      <button className="tg" onClick=${e=>{e.stopPropagation();setOpen(!open)}} aria-label="Toggle children">${p.children.length?(open?'▾':'▸'):'·'}</button>
      <span className="t">${p.title||'Untitled'}</span>
      <span className="acts"><button title="Add child page" onClick=${e=>{e.stopPropagation();dispatch({t:'addPage',parent:id});setOpen(true)}}>+</button>
      <button title="Duplicate" onClick=${e=>{e.stopPropagation();dispatch({t:'dupPage',id})}}>⧉</button>
      <button title="Delete" onClick=${e=>{e.stopPropagation();if(confirm('Delete "'+(p.title||'Untitled')+'" and its child pages?'))dispatch({t:'delPage',id})}}>✕</button></span></div>
    ${open&&p.children.map(c=>html`<${Node} key=${c} id=${c} depth=${depth+1}/>`)}</div>`;
}

/* ---------- search ---------- */
function search(P,q){
  q=q.trim().toLowerCase();if(!q)return[];const out=[];
  for(const p of Object.values(P)){
    if(p.title.toLowerCase().includes(q))out.push({id:p.id,title:p.title,snip:''});
    for(const b of p.blocks){const t=typeof b.content==='string'?b.content:b.content.flat().join(' ');const k=t.toLowerCase().indexOf(q);
      if(k>=0){out.push({id:p.id,title:p.title,snip:t.slice(Math.max(0,k-20),k+60),q});break}}}
  return out.slice(0,30);
}
function Search({onClose}){
  const {s,dispatch}=useContext(WS);const [q,setQ]=useState('');const res=search(s.pages,q);
  const go=r=>{dispatch({t:'go',id:r.id});onClose()};
  return html`<div className="ov" onMouseDown=${onClose}><div className="modal" onMouseDown=${e=>e.stopPropagation()}>
    <input autoFocus placeholder="Search titles and content" value=${q} onChange=${e=>setQ(e.target.value)} onKeyDown=${e=>{if(e.key==='Escape')onClose();if(e.key==='Enter'&&res[0])go(res[0])}}/>
    <div className="res">${!q?html`<div className="empty" style=${{padding:14}}>Type to search every page.</div>`:!res.length?html`<div className="empty" style=${{padding:14}}>No matches for “${q}”.</div>`:
      res.map((r,i)=>html`<button key=${i} onClick=${()=>go(r)}>${r.title||'Untitled'}${r.snip&&html`<small>${r.snip}</small>`}</button>`)}</div></div></div>`;
}

/* ---------- app ---------- */
function App(){
  const [h,dispatch]=useReducer(reducer,null,()=>({past:[],present:load(),future:[],k:''}));
  const s=h.present;const [dark,setDark]=useState(()=>{try{return localStorage.getItem(KEY+'-theme')}catch(e){return null}});
  const [find,setFind]=useState(false);const [saved,setSaved]=useState(true);
  useEffect(()=>{setSaved(false);const t=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify(s))}catch(e){}setSaved(true)},500);return()=>clearTimeout(t)},[s]);
  useEffect(()=>{if(dark){document.documentElement.dataset.theme=dark;try{localStorage.setItem(KEY+'-theme',dark)}catch(e){}}},[dark]);
  useEffect(()=>{const f=e=>{const m=e.ctrlKey||e.metaKey;
    if(m&&e.key==='k'){e.preventDefault();setFind(v=>!v)}
    else if(m&&!e.altKey&&e.key.toLowerCase()==='z'){e.preventDefault();dispatch({t:e.shiftKey?'redo':'undo'})}
    else if(m&&e.key.toLowerCase()==='y'){e.preventDefault();dispatch({t:'redo'})}};
    window.addEventListener('keydown',f);return()=>window.removeEventListener('keydown',f)},[]);
  const page=s.pages[s.current];
  const isDark=dark?dark==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
  const ctx=React.useMemo(()=>({s,dispatch}),[s]);
  return html`<${WS.Provider} value=${ctx}><div className="app">
    <aside className="side">
      <div className="top"><button onClick=${()=>dispatch({t:'addPage',parent:null})}>+ New page</button><button onClick=${()=>setFind(true)} title="Ctrl+K">Search</button>
        <button onClick=${()=>dispatch({t:'undo'})} title="Undo" disabled=${!h.past.length}>↶</button><button onClick=${()=>dispatch({t:'redo'})} title="Redo" disabled=${!h.future.length}>↷</button>
        <button onClick=${()=>setDark(isDark?'light':'dark')} title="Toggle theme">${isDark?'☀':'☾'}</button></div>
      <div className="tree" onDragOver=${e=>e.preventDefault()} onDrop=${e=>{const f=e.dataTransfer.getData('text/page');if(f)dispatch({t:'movePage',id:f,to:null})}}>
        ${s.roots.map(r=>html`<${Node} key=${r} id=${r} depth=${0}/>`)}</div></aside>
    <main className="main">${page?html`<div className="doc" key=${page.id}>
      <input className="title" value=${page.title} placeholder="Untitled" onChange=${e=>dispatch({t:'rename',id:page.id,v:e.target.value})}/>
      ${page.blocks.map((b,i)=>html`<${Block} key=${b.id} pid=${page.id} b=${b} i=${i} n=${page.blocks.length}/>`)}
      <button style=${{color:'var(--mute)',marginTop:8,padding:'4px 8px'}} onClick=${()=>{const nb=mkBlock();focusReq.id=nb.id;dispatch({t:'addBlock',pid:page.id,i:page.blocks.length,block:nb})}}>+ Add block</button></div>`:html`<div className="empty">Create a page to start writing.</div>`}</main>
    <div className="bar">${saved?'Saved':'Saving…'}</div>
    ${find&&html`<${Search} onClose=${()=>setFind(false)}/>`}</div><//>`;
}
createRoot(document.getElementById('root')).render(html`<${App}/>`);