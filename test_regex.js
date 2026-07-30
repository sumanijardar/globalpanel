const message = '5005F"SIA-DCS"1646R000001L000000#170051[#170051|DCS008|000|000000050A1A00AAAAAA]_11:13:07,07-30-2026';
const match = message.match(/"(SIA-DCS|ACK)"(\d{4})(R\w+)(L\w+)#(\w+)/);
console.log(match);
