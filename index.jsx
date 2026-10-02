import React,{useEffect,useRef} from 'react';
import cases from './data/cases.json';
import {TEMPLATE} from './template.js';
import {CSS} from './theme.js';
import {init} from './app.js';

export default function App(){
  const root=useRef(null);
  const started=useRef(false);
  useEffect(()=>{
    if(started.current)return;
    started.current=true;
    root.current.innerHTML=TEMPLATE;
    init(cases).then(()=>window.mobius?.signal?.('app_ready',{item_count:cases.length})).catch(err=>{
      root.current.innerHTML=`<main style="padding:40px"><h1>Dataset could not load</h1><p>${String(err.message)}</p></main>`;
      window.mobius?.signal?.('error',{message:err.message,source:'care-gap-observatory'});
    });
  },[]);
  return <><style>{CSS}</style><div ref={root}/></>;
}
