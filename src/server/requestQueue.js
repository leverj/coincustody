const affirm = require("affirm.js");
const _ = require('lodash');
const TimeUuid = require('cassandra-driver').types.TimeUuid;
const Emitter = require('events').EventEmitter;
const config = require("config");

module.exports = function () {
  let emitter = new Emitter();
  let queue = {};
  let jobs = [];
  queue.on = emitter.on.bind(emitter);
  queue.once = emitter.once.bind(emitter);
  queue.removeAllListeners = emitter.removeAllListeners.bind(emitter);
  let locked = false;

  queue.lock = function () {
    if (locked) return false;
    locked = true;
    return true
  };

  queue.isLocked = function () {
    return locked
  };

  queue.unlock = function () {
    affirm(locked, " this was supposed to be locked");
    locked = false
  };

  queue.push = function (payload) {
    affirm(!flag.getFlag('readonly'), 'Server in maintenance mode');
    affirm(payload.expiry || jobs.length < 20, "Server busy. Temporarily unable to accept request.", 503);
    queue.unsafePush(payload)
  };

  //WARNING: admin only
  queue.unsafePush = function (payload) {
    payload.uuid = TimeUuid.now().toString();
    jobs.push(payload);
    emitter.emit("user_message", {})
  };

  queue.shift = function () {
    if (jobs.length === 0) return;
    let job = jobs.shift();
    setTimeout(queue.remove.bind(queue, job.uuid), config.queuePurgeDelay);
    return job
  };

  return queue
}();
