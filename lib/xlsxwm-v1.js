/*! xlsxwm.js — ใส่ลายน้ำ (รูปในหัวกระดาษ &G) ให้ทุกชีตที่หัวกระดาษมี &G ของไฟล์ .xlsx ที่ ExcelJS สร้าง (ExcelJS ไม่รองรับรูปหัวกระดาษ)
 * ทำเหมือนไฟล์ต้นแบบของหน่วยงาน: VML 8x8 นิ้ว ปรับสี washout (gain/blacklevel/grayscale) — ใช้ได้ทั้งเบราว์เซอร์และ Node */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.XlsxWm = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const vml = n => `<xml xmlns:v="urn:schemas-microsoft-com:vml"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel">
 <o:shapelayout v:ext="edit">
  <o:idmap v:ext="edit" data="${n}"/>
 </o:shapelayout><v:shapetype id="_x0000_t75" coordsize="21600,21600" o:spt="75"
  o:preferrelative="t" path="m@4@5l@4@11@9@11@9@5xe" filled="f" stroked="f">
  <v:stroke joinstyle="miter"/>
  <v:formulas>
   <v:f eqn="if lineDrawn pixelLineWidth 0"/>
   <v:f eqn="sum @0 1 0"/>
   <v:f eqn="sum 0 0 @1"/>
   <v:f eqn="prod @2 1 2"/>
   <v:f eqn="prod @3 21600 pixelWidth"/>
   <v:f eqn="prod @3 21600 pixelHeight"/>
   <v:f eqn="sum @0 0 1"/>
   <v:f eqn="prod @6 1 2"/>
   <v:f eqn="prod @7 21600 pixelWidth"/>
   <v:f eqn="sum @8 21600 0"/>
   <v:f eqn="prod @7 21600 pixelHeight"/>
   <v:f eqn="sum @10 21600 0"/>
  </v:formulas>
  <v:path o:extrusionok="f" gradientshapeok="t" o:connecttype="rect"/>
  <o:lock v:ext="edit" aspectratio="t"/>
 </v:shapetype><v:shape id="CH" o:spid="_x0000_s${1024 + n}" type="#_x0000_t75"
  style='position:absolute;margin-left:0;margin-top:0;width:8in;height:8in;
  z-index:1' o:preferrelative="f">
  <v:imagedata o:relid="rId1" o:title="watermark"
   gain="19661f" blacklevel="24904f" grayscale="t"/>
  <o:lock v:ext="edit" rotation="t"/>
 </v:shape></xml>`;
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  /** JSZip: ตัวคลาส · buf: ไฟล์ xlsx · img: ไบต์ของ jpeg — คืน Uint8Array ใหม่ (จำนวนชีตที่ใส่ใน .count) */
  async function add(JSZip, buf, img) {
    const z = await JSZip.loadAsync(buf);
    const sheets = Object.keys(z.files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    let count = 0;
    for (const name of sheets) {
      let xml = await z.file(name).async('string');
      if (!/<oddHeader>[^<]*&amp;G/.test(xml) || /<legacyDrawingHF/.test(xml)) continue;
      const n = +/sheet(\d+)\.xml/.exec(name)[1], vmlName = `vmlDrawingWM${n}.vml`;
      z.file(`xl/drawings/${vmlName}`, vml(n));
      z.file(`xl/drawings/_rels/${vmlName}.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/image" Target="../media/watermark1.jpg"/></Relationships>`);
      const relPath = `xl/worksheets/_rels/sheet${n}.xml.rels`, relEntry = `<Relationship Id="rIdWM1" Type="${REL}/vmlDrawing" Target="../drawings/${vmlName}"/>`;
      const old = z.file(relPath);
      if (old) { let r = await old.async('string'); r = r.replace('</Relationships>', relEntry + '</Relationships>'); z.file(relPath, r); }
      else z.file(relPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relEntry}</Relationships>`);
      const tag = '<legacyDrawingHF r:id="rIdWM1"/>', m = /<tableParts|<extLst/.exec(xml);
      xml = m ? xml.slice(0, m.index) + tag + xml.slice(m.index) : xml.replace('</worksheet>', tag + '</worksheet>');
      z.file(name, xml); count++;
    }
    if (!count) { const o = await z.generateAsync({ type: 'uint8array' }); o.count = 0; return o; }
    z.file('xl/media/watermark1.jpg', img);
    let ct = await z.file('[Content_Types].xml').async('string');
    const defs = [];
    if (!/Extension="jpg"/i.test(ct)) defs.push('<Default Extension="jpg" ContentType="image/jpeg"/>');
    if (!/Extension="vml"/i.test(ct)) defs.push('<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>');
    if (defs.length) { ct = ct.replace(/(<Types[^>]*>)/, '$1' + defs.join('')); z.file('[Content_Types].xml', ct); }
    const out = await z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    out.count = count; return out;
  }
  return { add };
});
