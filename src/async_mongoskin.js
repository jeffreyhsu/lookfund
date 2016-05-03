
var Bluebird = require("bluebird");
var mongoskin = require("mongoskin");
Object.keys(mongoskin).forEach(function(key) {
  var value = mongoskin[key];
  if (typeof value === "function") {
    Bluebird.promisifyAll(value);
    Bluebird.promisifyAll(value.prototype);
  }
});
Bluebird.promisifyAll(mongoskin);

module.exports = mongoskin
