const xlsx = require('xlsx');
const workbook = xlsx.readFile('SECURICO PANEL-GX 4816 -Integration Protocole and Commands- _16-12-2023.xls');
let allData = {};
workbook.SheetNames.forEach(name => {
  allData[name] = xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1 });
});
console.log(JSON.stringify(allData, null, 2));
