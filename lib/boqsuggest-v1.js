/* boqsuggest-v1.js — พจนานุกรมงานทั่วไป: ชื่อรายการ → "คำแนะนำ" การผูกวัสดุ/ค่าแรง
 * ที่มา: ตารางผูกราคาที่ตรวจกับ Earth ไว้ใน UD-Total-Station (tools/price_map.json r4, 18 ต.ค. 2569)
 * ใช้เป็นคำแนะนำเท่านั้น — ผู้ใช้กดยืนยันก่อนจึงผูกจริง (ไม่ผูกอัตโนมัติ)
 * ฟังก์ชันล้วน ไม่แตะ DOM:
 *   BoqSuggest.suggest({name, unit, qty}) → null | {mat?, lab?, matNote?, why}
 *     mat = {kind:'mat', codes:[รหัสพาณิชย์…]} | {kind:'mat', re:'regex ชื่อ'} | {kind:'comp', code}
 *     lab = {kind:'wage', code} | {kind:'none'}
 *   ฝั่งเว็บเป็นผู้ตรวจว่ารหัสมีอยู่ในฐานข้อมูลจริง แล้วแปลงเป็นลิงก์ที่ใช้ได้
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();else root.BoqSuggest=factory();
})(typeof self!=='undefined'?self:this,function(){
  const T=s=>String(s==null?'':s).toLowerCase().replace(/[​ ]/g,' ').replace(/\s+/g,' ').trim();
  const NS=s=>T(s).replace(/\s+/g,'');

  /* เหล็กเส้น: ขนาด → รหัสพาณิชย์ (ตัวแรกที่มีราคาอุดรก่อน) */
  const RB={6:['0401010101500000'],9:['0401010101600000']};
  const DB={10:['0401020203600000','0401020202900000'],12:['0401020203700000','0401020203000000'],
            16:['0401020203800000','0401020203100000'],20:['0401020203900000','0401020203200000'],25:['0401020204000000','0401020203300000']};
  const rebarLab=d=>d<10?'STR-1.10.1':d<=16?'STR-1.10.2':'STR-1.10.3';

  function dia(name){
    const s=T(name);
    let m=/(?:db|rb|ø|⌀|φ)\s*(\d+(?:\.\d+)?)/.exec(s);if(m)return +m[1];
    m=/(\d+(?:\.\d+)?)\s*(?:มม|mm|ม\.ม)/.exec(s.replace(/\s+/g,' '));if(m)return +m[1];
    m=/ขนาด\s*(\d+(?:\.\d+)?)/.exec(s);return m?+m[1]:null;
  }

  function suggest(row){
    const name=T(row&&row.name),ns=NS(row&&row.name),qty=+(row&&row.qty)||0;
    if(!name)return null;

    if(/ลวดผูกเหล็ก/.test(ns))return {mat:{kind:'mat',codes:['0401030100100000']},lab:{kind:'none'},why:'ลวดผูกเหล็ก — ไม่มีค่าแรงแยก (รวมในค่าเหล็ก)'};

    if(/เหล็กเส้น|เหล็กข้ออ้อย|เหล็กกลม/.test(ns)||/^(db|rb)\s*\d/.test(name)){
      const d=dia(name);if(d===null)return null;
      const deformed=/sd\s*\.?\s*40|sd40|(^|[^a-z])db|ข้ออ้อย/.test(name);
      const plain=/sr\s*\.?\s*24|sr24|(^|[^a-z])rb|ผิวเรียบ/.test(name);
      let codes=null,kindName='';
      if(deformed){codes=DB[d];kindName='ข้ออ้อย SD40';}
      else if(plain){codes=RB[d];kindName='ผิวเรียบ SR24';}
      if(!codes)return null;
      return {mat:{kind:'mat',codes},lab:{kind:'wage',code:rebarLab(d)},why:`เหล็กเส้น${kindName} ${d} มม.`};
    }

    if(/wiremesh|ตะแกรงเหล็ก|ลวดตาข่ายเสริม/.test(ns))
      return {lab:{kind:'wage',code:'STR-1.10.4'},matNote:'ค่าวัสดุ: ไม่มีในราคาพาณิชย์ — สืบราคา',why:'วางตะแกรงเหล็กสำเร็จรูป (Wire Mesh)'};

    if(/คอนกรีตหยาบ/.test(ns))return {mat:{kind:'comp',code:'1.2'},lab:{kind:'wage',code:'STR-1.6.1'},why:'คอนกรีตหยาบ 1:3:5 (วัสดุมวลรวม 1.2)'};

    if(/คอนกรีต/.test(ns)&&!/หยาบ|เสริมใยเหล็ก|พื้นสำเร็จ/.test(ns)){
      const m=/(?:fc'?|f'c|fc)\s*['’]?\s*(\d{3})/.exec(name)||/(\d{3})\s*(?:ksc|กก)/.exec(name);
      const cube=/cube|ลูกบาศก์/.test(name);
      let mat=null;
      if(m){const n=m[1];mat={kind:'mat',re:cube?('ลูกบาศก์\\s*'+n+'\\s*กก'):('ทรงกระบอก\\s*'+n+'\\s*กก')};}
      return {mat:mat||undefined,lab:{kind:'wage',code:'STR-1.7-b'},why:'คอนกรีตผสมเสร็จ'+(m?' '+(cube?'cube ':'cylinder ')+m[1]+' ksc':'')+' — ค่าแรงเทอาคารชั้นเดียว'};
    }

    if(/ไม้แบบ|แบบหล่อ/.test(ns))return {mat:{kind:'comp',code:'12.3'},lab:{kind:'wage',code:'STR-1.8.1-b'},why:'ไม้แบบหล่อคอนกรีต'};

    if(/ขุด/.test(ns)){
      const code=qty>100?'STR-1.3.1-a':qty>=25?'STR-1.3.1-b':'STR-1.3.1-c';
      return {lab:{kind:'wage',code},lab_none_mat:true,why:'ขุดหลุมแล้วถมคืน — เลือกขั้นตามปริมาณ '+(qty||'?')+' ลบ.ม. (ว.480 ดูทั้งปริมาณ/ความลึก — ตรวจขั้นอีกครั้ง)'};
    }
    if(/ทรายรองก้น/.test(ns))return {lab:{kind:'wage',code:'STR-1.5-b'},matNote:'ค่าวัสดุทราย: ไม่มีในราคาพาณิชย์ — สืบราคา',why:'ใส่ทรายรองก้นหลุม'};
    if(!/ล้าง|ปูนปั้น|ผสม/.test(ns)&&/ทรายหยาบ|ทรายละเอียด|ถมทราย|ทรายถม|ทรายปรับระดับ|^(งาน)?ทราย$|ดินถม|ถมดิน|ถมอัด|ลูกรัง/.test(ns))return {lab:{kind:'wage',code:'STR-1.4'},matNote:'ค่าวัสดุทราย/ดิน: ไม่มีในราคาพาณิชย์ — สืบราคา',why:'ถมดิน/ทรายเพื่อปรับระดับ'};

    if(/ก่ออิฐมอญ|ผนังอิฐมอญ/.test(ns)){
      return /เต็มแผ่น/.test(ns)?{mat:{kind:'comp',code:'6.2'},lab:{kind:'wage',code:'ARC-2.3.1-b'},why:'ก่ออิฐมอญเต็มแผ่น'}
        :{mat:{kind:'comp',code:'6.1'},lab:{kind:'wage',code:'ARC-2.3.1-a'},why:'ก่ออิฐมอญครึ่งแผ่น'};
    }
    if(/เสาเอ็น|คานทับหลัง/.test(ns))return {mat:{kind:'comp',code:'4.1'},why:'เสาเอ็น/คานทับหลัง (ชนิดก่อครึ่งแผ่น)'};

    if(/กันสนิม/.test(ns)&&/สี/.test(ns))return {mat:{kind:'comp',code:'10.10'},lab:{kind:'wage',code:'ARC-2.8.3-b'},why:'ทาสีน้ำมันกันสนิมเหล็ก'};
    if(/ทาสี|สีน้ำ|สีอะคริลิค|สีอะครีลิก/.test(ns)){
      if(/ภายนอก/.test(ns))return {mat:{kind:'comp',code:'10.1'},lab:{kind:'wage',code:'ARC-2.8.1-d'},why:'ทาสีน้ำอะคริลิคภายนอก'};
      if(/ภายใน/.test(ns))return {mat:{kind:'comp',code:'10.2'},lab:{kind:'wage',code:'ARC-2.8.1-b'},why:'ทาสีน้ำอะคริลิคภายใน'};
      return null;
    }
    if(/ฝ้า/.test(ns)&&/ยิปซั่ม|ยิปซัม|โครงคร่าว/.test(ns))return {lab:{kind:'wage',code:'ARC-2.2.3'},why:'โครงคร่าวเหล็ก + แผ่นฝ้ายิปซั่ม (ค่าแรง)'};

    if(/ท่อแป๊บ|ท่อเหล็ก|เหล็กรูปพรรณ|โครงเหล็ก|โครงหลังคาเหล็ก/.test(ns))
      return {lab:{kind:'wage',code:'STR-1.11.1'},matNote:'ค่าวัสดุ: เลือกรหัสเหล็กรูปพรรณ (พาณิชย์ 0402) หรือสืบราคา',why:'ประกอบ/ติดตั้งเหล็กรูปพรรณ (ค่าแรง บาท/กก.)'};

    return null;
  }
  return {suggest,dia};
});
