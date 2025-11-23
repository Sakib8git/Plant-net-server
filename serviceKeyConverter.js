// const fs = require("fs");
// const jsonData = fs.readFileSync("./serviceAccountKey.json");

// const base64String = Buffer.from(jsonData, "utf-8").toString("base64");
// console.log(base64String);

const fs = require("fs");
const jsonData = fs.readFileSync("./serviceAccountKey.json");
const base64String = Buffer.from(jsonData).toString("base64");
console.log(base64String);
