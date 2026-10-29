const ms = require("ms");

// `ms` is a real dependency so `npm ci` has to reach registry.npmjs.org.
exports.toMs = (text) => ms(text);
exports.add = (a, b) => a + b;
