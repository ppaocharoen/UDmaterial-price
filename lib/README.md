# lib — โค้ดคิดราคากลางที่ใช้ร่วมกัน

`pricing-v1.js` คือโค้ดคิดราคาที่ UD-Cost Hub (`index.html`) และ UD-Total-Station (เว็บ BOQ) ใช้ร่วมกัน ไฟล์นี้มีแต่การคำนวณ ไม่แตะหน้าจอ

```html
<script src="https://ppaocharoen.github.io/UDmaterial-price/lib/pricing-v1.js"></script>
<script>
  const db = await UDPrice.load();            // ดึงชีต A และ B ทั้งหมด
  db.material('0101010100300000');            // ราคาที่ใช้ หน่วย จังหวัด เดือนราคา
  db.compPrice('11');                         // ราคาต่อหน่วยวัสดุมวลรวม + รายละเอียดทุกบรรทัด
  db.wage('ARC-2.9.17-a');                    // ค่าแรง ว480 ตามรหัสคอลัมน์ G
</script>
```

ใน Node: `const UDPrice = require('./lib/pricing-v1.js')`

## ฟังก์ชันหลัก

| ฟังก์ชัน | คืนค่า |
|---|---|
| `UDPrice.load({fetch})` | `DB` ที่มีข้อมูลครบทุกชีต |
| `db.material(code)` | แถววัสดุพาณิชย์ (`price` = คอลัมน์ "ราคาที่ใช้") |
| `db.resolveMat(item)` | รหัสพาณิชย์ตัวแรกที่มีราคา `{matItem, codes, missing}` |
| `db.compPrice(id, {qty, prices, subPrices})` | `{price, raw, complete, lines[]}` — `price` ปัด 2 ตำแหน่ง |
| `db.wage(code)` | แถวค่าแรง ว480 |
| `db.checkCodes()` | รหัสพาณิชย์ใน mat_ref ที่ไม่มีราคา `{dead, fallback}` |
| `db.suggest(name)` | วัสดุพาณิชย์ที่ชื่อใกล้เคียงและมีราคา |
| `UDPrice.units.convertPrice(...)` | แปลงหน่วยราคา `{price, ok, how}` แปลงไม่ได้ `ok:false` |

`compPrice` แต่ละบรรทัดบอกที่มาของราคาใน `source`: `user` (กรอกเอง), `fixed` (ราคาตายตัว), `commerce`, `commerce-fallback` (ใช้รหัสสำรอง), `sub-comp` (ราคาจากส่วนผสมย่อย) และคำเตือนใน `warnings`: `missing_qty`, `missing_price`, `no_commerce_price`, `unit_conversion_failed`, `sub_comp_unit_mismatch`

## กติกาเวอร์ชัน

ห้ามแก้ `pricing-v1.js` ในทางที่ทำให้ผลคำนวณเดิมเปลี่ยน ถ้าต้องเปลี่ยน ให้ทำไฟล์ใหม่ `pricing-v2.js` แล้วให้แต่ละเว็บย้ายไปเมื่อพร้อม
