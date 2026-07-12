const { startAnimalFootballApp } = require("./src/app/main");
const { reportFatal } = require("./src/boot/start");

startAnimalFootballApp().catch(reportFatal);
