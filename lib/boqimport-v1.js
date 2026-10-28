/* boqimport-v1.js — อ่านตาราง ปร.1 / BOQ จาก Excel (array-of-arrays) แบบไม่ล็อกตำแหน่งช่อง
 * หาแถวหัวตารางเองจากคำ (รายการ / จำนวน-ปริมาณ / หน่วย / ค่าวัสดุ / ค่าแรง) แล้วเดาคอลัมน์
 * ใช้ BoqImport.detect(aoa) → map ; BoqImport.parse(aoa, map?) → {map, groups, rows, skipped}
 * BoqImport.similar(a, b) → 0..1 คะแนนความคล้ายของชื่อ ใช้จับคู่ชื่อรายการกับฐานราคา
 * ฟังก์ชันล้วน ไม่แตะ DOM — ทดสอบด้วย node ได้
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.BoqImport=factory();
})(typeof self!=='undefined'?self:this,function(){
  const TH='๐๑๒๓๔๕๖๗๘๙';
  const norm=s=>String(s==null?'':s).replace(/[๐-๙]/g,c=>TH.indexOf(c)).replace(/[​ ]/g,' ').replace(/\s+/g,' ').trim();
  const isNum=v=>typeof v==='number'?isFinite(v):(typeof v==='string'&&/^-?[\d,]*\.?\d+$/.test(norm(v)));
  const toNum=v=>typeof v==='number'?v:parseFloat(norm(v).replace(/,/g,''));
  const colLetter=i=>{let s='';i++;while(i>0){const m=(i-1)%26;s=String.fromCharCode(65+m)+s;i=Math.floor((i-1)/26);}return s;};

  const RE={
    name:/^(รายการ|รายละเอียด|ชื่อ(งาน|วัสดุ|รายการ)|รายการงาน|description|item)/i,
    qty:/^(จำนวน|ปริมาณ|qty|quantity)(?!เงิน)/i,
    unit:/^(หน่วย|หน่วยนับ|unit)$/i,
    seq:/^(ลำดับ|ลำดับที่|ที่|no\.?|item no\.?)$/i,
    unitPrice:/(ราคา)?ต่อหน่วย|ราคา\/หน่วย|unit ?price/i,
    mat:/(ค่า|ราคา)?(วัสดุ|วสัดุ)/,
    lab:/(ค่า|ราคา)?(แรงงาน|แรง)/,
    both:/(วัสดุ|วสัดุ).*(แรง)|(แรง).*(วัสดุ|วสัดุ)/,
    amount:/จำนวนเงิน|เป็นเงิน|amount/i,
  };

  function cell(row,c){return c==null||c<0?'':(row&&row[c]!==undefined?row[c]:'');}

  /* หาแถวหัวตาราง + คอลัมน์ */
  function detect(aoa){
    const lim=Math.min(aoa.length,300);
    for(let r=0;r<lim;r++){
      const rows=[aoa[r]||[],aoa[r+1]||[],aoa[r+2]||[]];
      const hits={};
      let qtyIn=-1;
      rows.forEach((row,ri)=>{
        for(let c=0;c<row.length;c++){
          const t=norm(row[c]);if(!t||t.length>40)continue;
          if(ri===0&&RE.name.test(t)&&hits.name===undefined)hits.name=c;
          if(RE.qty.test(t)&&hits.qty===undefined){hits.qty=c;qtyIn=ri;}
          if(RE.unit.test(t)&&hits.unit===undefined)hits.unit=c;
          if(RE.seq.test(t)&&hits.seq===undefined&&ri===0)hits.seq=c;
        }
      });
      if(hits.name===undefined||hits.qty===undefined||hits.unit===undefined)continue;
      if(qtyIn>0&&false)continue;
      /* ราคาต่อหน่วย: หาคอลัมน์หัวข้อ วัสดุ / แรง และช่อง "ราคาต่อหน่วย" ใต้หัว */
      let matH,labH;const upCols=[];
      rows.forEach(row=>{for(let c=0;c<row.length;c++){
        const t=norm(row[c]);if(!t||t.length>40)continue;
        if(RE.both.test(t)||/^รวม/.test(t))continue;
        if(RE.unitPrice.test(t)&&!RE.mat.test(t)&&!RE.lab.test(t)){if(!upCols.includes(c))upCols.push(c);continue;}
        if(RE.amount.test(t))continue;
        if(RE.mat.test(t)&&matH===undefined&&c>hits.qty)matH=c;
        else if(RE.lab.test(t)&&labH===undefined&&c>hits.qty)labH=c;
      }});
      upCols.sort((a,b)=>a-b);
      let mat=null,lab=null;
      if(matH!==undefined){
        const up=upCols.find(c=>c>=matH&&(labH===undefined||c<labH));
        /* หัวรวมเซลล์: ช่อง "ราคาต่อหน่วย" อยู่ใต้หัวพอดี ถ้าไม่มีช่องย่อย ใช้คอลัมน์ของหัวเอง */
        mat=up!==undefined?up:matH;
      }
      if(labH!==undefined){
        const up=upCols.find(c=>c>=labH);
        lab=up!==undefined?up:labH;
      }
      if(mat!==null&&lab!==null&&mat===lab)lab=null;
      let seq=hits.seq!==undefined?hits.seq:null;
      if(seq===null&&hits.name>0)seq=hits.name-1;
      if(seq===hits.name)seq=null;
      return {header:r,start:r+1,seq,name:hits.name,qty:hits.qty,unit:hits.unit,mat,lab};
    }
    return null;
  }

  /* รหัสหมวดจากช่องลำดับ/ต้นชื่อ: 1, 1.1, "1.", "หมวด 2", "๓.๑" */
  function parseCode(v){
    if(typeof v==='number'&&isFinite(v)&&v>0)return String(Math.round(v*1e6)/1e6);
    const t=norm(v).replace(/^หมวด(ที่)?\s*/,'').replace(/[.)\s]+$/,'');
    return /^\d+(\.\d+)*$/.test(t)?t:null;
  }
  const isTotal=t=>/^(รวม|สรุป|ยอดรวม|รวมเป็น|ภาษี|หมายเหตุ|ผู้ประมาณ|ผู้ตรวจ|\(\s)/.test(t)||/^รวมค่า/.test(t);
  const isBullet=t=>/^[-–—•·*]+$/.test(t);

  function parse(aoa,mapIn){
    const map=mapIn||detect(aoa);
    if(!map)return {map:null,groups:[],rows:[],skipped:[]};
    const groups=[],rows=[],skipped=[];
    const nameLast=Math.min(map.qty,map.unit)-1;
    /* ถ้ามีหมวดแบบเลขอยู่ในชีตหรือไม่ — ใช้ตัดสินว่าบรรทัดที่เป็นหัวข้อล้วนคือหมวดหรือเปล่า */
    let hasNumGroups=false;
    for(let r=map.start;r<aoa.length;r++){
      const row=aoa[r]||[];
      if(isNum(cell(row,map.qty)))continue;
      if(map.seq!==null&&parseCode(cell(row,map.seq))&&firstText(row,map,nameLast)){hasNumGroups=true;break;}
    }
    let cur=null,auto=0;
    const addGroup=(code,name)=>{
      if(groups.some(g=>g.code===code))return false;
      groups.push({code,name});return true;
    };
    for(let r=map.start;r<aoa.length;r++){
      const row=aoa[r]||[];
      if(!row.some(v=>norm(v)!==''))continue;
      const nameTxt=firstText(row,map,nameLast);
      const unitTxt=norm(cell(row,map.unit));
      const qtyRaw=cell(row,map.qty);
      const rowTxt=row.map(norm).join(' ');
      const where=colLetter(0)+(r+1);
      if(RE.unitPrice.test(rowTxt)&&!isNum(qtyRaw)||(/ลำดับ/.test(rowTxt)&&/รายการ/.test(rowTxt)))continue;   /* หัวซ้ำทุกหน้า */
      if(!nameTxt){ if(isNum(qtyRaw))skipped.push({row:r+1,why:'มีปริมาณแต่ไม่มีชื่อรายการ',text:rowTxt.slice(0,60)}); continue; }
      if(isTotal(nameTxt)||unitTxt==='รวม')continue;
      const seqRaw=map.seq!==null?cell(row,map.seq):'';
      let code=parseCode(seqRaw),name=nameTxt;
      if(!code&&map.seq===null||(!code&&norm(seqRaw)==='')){
        const m=/^(\d+(?:\.\d+)*)[.)]?\s+(.+)$/.exec(nameTxt);
        if(m&&!isNum(qtyRaw)){code=m[1];name=m[2];}
      }
      const hasQty=isNum(qtyRaw);
      if(hasQty){
        if(!cur){const c=nextFree(groups,'1');addGroup(c,'รายการทั่วไป');cur=c;}
        const q=toNum(qtyRaw);
        const mp=map.mat!==null&&isNum(cell(row,map.mat))?toNum(cell(row,map.mat)):null;
        const lp=map.lab!==null&&isNum(cell(row,map.lab))?toNum(cell(row,map.lab)):null;
        rows.push({group_code:cur,name:name.replace(/\s+/g,' '),unit:unitTxt==='-'?'':unitTxt,qty:Math.round(q*100)/100,qtyRaw:q,oldMat:mp,oldLab:lp,srcRow:r+1});
        continue;
      }
      if(code){ /* หัวหมวดมีเลขที่ */
        if(addGroup(code,name))cur=code;else if(groups.some(g=>g.code===code))cur=code;
        continue;
      }
      if(isBullet(nameTxt))continue;
      if(!hasNumGroups&&!unitTxt){  /* ไฟล์ที่ไม่มีเลขหมวดเลย: บรรทัดหัวข้อล้วนถือเป็นหมวดใหม่ */
        auto++;const c=String(auto);addGroup(c,name);cur=c;continue;
      }
      if(unitTxt&&unitTxt!=='-'){   /* มีหน่วยแต่ไม่มีปริมาณ → รายการที่ยังไม่ได้ใส่ปริมาณ */
        if(!cur){const c=nextFree(groups,'1');addGroup(c,'รายการทั่วไป');cur=c;}
        const mp=map.mat!==null&&isNum(cell(row,map.mat))?toNum(cell(row,map.mat)):null;
        const lp=map.lab!==null&&isNum(cell(row,map.lab))?toNum(cell(row,map.lab)):null;
        rows.push({group_code:cur,name,unit:unitTxt,qty:'',qtyRaw:null,oldMat:mp,oldLab:lp,srcRow:r+1,noQty:true});
        continue;
      }
      skipped.push({row:r+1,why:'ข้ามบรรทัด (ไม่ใช่รายการหรือหมวด)',text:rowTxt.slice(0,60)});
    }
    return {map,groups,rows,skipped};
  }
  function nextFree(groups,c){let n=+c;while(groups.some(g=>g.code===String(n)))n++;return String(n);}
  function firstText(row,map,last){
    for(let c=map.name;c<=last;c++){
      if(c===map.seq)continue;
      const v=row[c];if(typeof v==='number')continue;
      const t=norm(v);if(t&&!isBullet(t))return t;
    }
    return '';
  }

  /* ---------- ความคล้ายของชื่อ ---------- */
  const cache=new Map();
  function prep(s){
    let p=cache.get(s);if(p)return p;
    const t=norm(s).toLowerCase().replace(/[()\[\],;:"'“”‘’]/g,' ');
    const nums=(t.match(/\d+(?:\.\d+)?/g)||[]).map(x=>String(+x)).sort().join(',');
    const flat=t.replace(/[\s\-_/.]+/g,'');const grams=new Map();let size=0;
    for(let i=0;i<flat.length-1;i++){const g=flat.slice(i,i+2);grams.set(g,(grams.get(g)||0)+1);size++;}
    p={nums,grams,size};if(cache.size>20000)cache.clear();cache.set(s,p);return p;
  }
  /* ตัวเลขในชื่อ (ขนาด/ความหนา/เกรด) ต้องตรงกันทั้งหมดจึงนับว่าคล้าย — กันจับ "9 มม." ไปผูก "12 มม." */
  function similar(a,b){
    const A=prep(a),B=prep(b);
    if(A.nums!==B.nums)return 0;
    if(!A.size||!B.size)return 0;
    let inter=0;A.grams.forEach((v,k)=>{const w=B.grams.get(k);if(w)inter+=Math.min(v,w);});
    return 2*inter/(A.size+B.size);
  }

  return {detect,parse,similar,norm,colLetter,isNum,toNum};
});
