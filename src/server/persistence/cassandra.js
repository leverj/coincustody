const bluebird   = require('bluebird')
const util              = require('util')
const cassandra         = require('cassandra-driver')
const config            = require('config')
const Position          = require("./../Position").Position
const ProfitAndLoss     = require('./../ProfitAndLoss')
const Order             = require("./../LimitOrderBook").Order
const assert            = require('affirm.js')

module.exports = async function() {
  var FAR_INTO_FUTURE   = '13814000-1dd2-13b2-807f-a507ee2a39e9'
  var DEFAULT_PAGE_SIZE = 200
  var options = { prepare: true, consistency: cassandra.types.consistencies.quorum }
  var client  = new cassandra.Client({ contactPoints: config.contactPoints })
  var batch   = bluebird.promisify(client.batch.bind(client))
  var execute = bluebird.promisify(client.execute.bind(client))

  var orderStatusTableMap              = {}
  orderStatusTableMap[Order.OPEN]      = { DELETE: [], INSERT: ["open_orders"] }
  orderStatusTableMap[Order.CLOSED]    = { DELETE: ["open_orders"], INSERT: ["closed_orders"] }
  orderStatusTableMap[Order.CANCELLED] = { DELETE: ["open_orders"], INSERT: ["cancelled_orders"] }
  var ORDER_TABLE_MAP                  = { open: "open_orders", closed: "closed_orders", cancelled: "cancelled_orders" }
  var persistence                      = {}
  var dbTransactions                   = {}

  persistence.beginTransaction = function () {
    var txid             = cassandra.types.TimeUuid.now().toString()
    dbTransactions[txid] = { statements: [], time: Date.now() + '' }
    return txid
  }

  function getTransactionTime(dbtx) {
    return dbTransactions[dbtx].time
  }

  persistence.commitTransaction = function*(txid) {
    assert(dbTransactions[txid], `no such transaction ${txid}`)
    persistence.logTransaction("", txid)
    yield* batchCommit(dbTransactions[txid].statements)
    delete dbTransactions[txid]
  }

  persistence.rollbackTransaction = function (txid) {
    // assert(dbTransactions[txid], `no such transaction ${txid}`)
    delete dbTransactions[txid]
  }

  persistence.logTransaction = function (title, txid) {
    assert(dbTransactions[txid], `no such transaction ${txid}`)
    util.log(title, txid, JSON.stringify(dbTransactions[txid].statements))
  }

  persistence.persistOrders = function*(orders, txid) {
    assert(!txid || dbTransactions[txid], `no such transaction ${txid}`)
    var statements = []
    orders.forEach(order => {
      assert(order.status in orderStatusTableMap, `Invalid order status ${order.status}`)
      orderStatusTableMap[order.status].DELETE.forEach(table => {
        var statement = {
          query : "delete from " + table + " where instrument=? AND userid = ? AND uuid = ?",
          params: [order.instrument, order.userid, order.uuid]
        }
        statements.push(statement)
      })
      orderStatusTableMap[order.status].INSERT.forEach(table => {
        var statement = {
          query : "insert into " + table + " (userid, instrument, uuid, payload) values (?,?,?,?)",
          params: [order.userid, order.instrument, order.uuid, JSON.stringify(Order.clone(order))]
        }
        statements.push(statement)
      })
    })
    yield* merge(txid, statements)
    //yield* batchCommit(queries);
  }

  persistence.addExecution = function*(symbol, execution, txid) {
    assert(dbTransactions[txid], `no such transaction ${txid}`)
    var statements = [{
      query : "insert into execution (instrument, uuid, payload) values(?, ? ,?)",
      params: [symbol, execution.uuid, JSON.stringify(execution)]
    }];
    yield* merge(txid, statements)
    //yield* batchCommit(statements);
  }

  function* merge(txid, statements) {
    if (txid) {
      setStatements(txid, statements, 'statements')
    } else {
      yield* batchCommit(statements)
    }
  }

  function setStatements(txid, statements, key) {
    if (!statements || statements.length === 0) return
    var orig                  = dbTransactions[txid][key]
    dbTransactions[txid][key] = orig.concat(statements)
  }

  persistence.addUser = function*(user, txid) {
    var statement = {
      "query" : "insert into user (userid, payload) values (?,?)",
      "params": [user.userid, JSON.stringify(user)]
    }
    yield* merge(txid, [statement])
  }

  persistence.addToRequestQueue = function*(symbol, payload) {
    assert(payload.uuid, `uuid missing: ${payload} `)
    var statement = {
      "query" : "insert into request_queue (instrument, uuid, payload) values (?,?,?)",
      "params": [symbol, payload.uuid, JSON.stringify(payload)]
    }
    yield* batchCommit([statement])
    util.log("add to request queue", JSON.stringify(payload))
  }

  persistence.deleteRequestInQueue = function*(symbol, uuid) {
    assert(uuid, "uuid undefined")
    var statement = {
      "query" : "delete from request_queue where instrument = ? and uuid = ?",
      "params": [symbol, uuid]
    }
    yield* batchCommit([statement])
    util.log("removed from request queue", uuid)
  }

  persistence.saveInstrument = function*(instrument) {
    assert(instrument, "instrument undefined")
    assert(instrument.symbol, "symbol undefined " + instrument.symbol)
    var statement = {
      "query" : "insert into instrument (symbol, start, expiry, expired, payload) values (?,?,?,?,?)",
      "params": [instrument.symbol, instrument.start + "", instrument.expiry + "", instrument.status === 'expired' ? 'true' : 'false', JSON.stringify(instrument)]
    }
    util.log("INSTRUMENT:", statement)
    yield* batchCommit([statement])
  }

  persistence.addPnL = function*(profitAndLoss, txid) {
    assert(dbTransactions[txid], `no such transaction ${txid}`)
    assert(profitAndLoss.userid, 'addPnL: userid required ' + JSON.stringify(profitAndLoss))
    var statements = [{
      "query" : "insert into pnl (userid, payload) values (?,?)",
      "params": [profitAndLoss.userid, JSON.stringify(profitAndLoss)]
    }, {
      "query" : "insert into pnl_history (userid, time, payload) values (?,?,?)",
      "params": [profitAndLoss.userid, getTransactionTime(txid), JSON.stringify(profitAndLoss)]
    }]
    yield* merge(txid, statements)
    //yield* batchCommit([statement])
  }

  persistence.delPnL = function*(profitAndLoss, txid) {
    assert(dbTransactions[txid], `no such transaction ${txid}`)
    assert(profitAndLoss.userid, 'delPnL: userid required ' + JSON.stringify(profitAndLoss))
    var statements = [{
      "query" : "delete from pnl where userid = ?",
      "params": [profitAndLoss.userid]
    }, {
      "query" : "insert into pnl_history (userid, time, payload) values (?,?,?)",
      "params": [profitAndLoss.userid, getTransactionTime(txid), JSON.stringify({ action: 'deleted' })]
    }]
    yield* merge(txid, statements)
  }

  persistence.saveSettlements = function*(settlements, txid) {
    assert(dbTransactions[txid], `no such transaction ${txid}`)
    var statements = settlements.map(settlement => {
      return {
        query : "insert into settlement(userid, time,payload) values(?,?,?)",
        params: [settlement.userid, settlement.time, JSON.stringify(settlement)]
      }
    })
    yield* merge(txid, statements)
  }

  persistence.updatePnls = function*(pnls, txid) {
    assert(dbTransactions[txid], `no such transaction ${txid}`)
    assert(pnls, 'PnLs not specified')
    for (var i = 0; i < pnls.length; i++) {
      var pnl = pnls[i]
      if (pnl.pnl === 0 && pnl.commission === 0) {
        yield* persistence.delPnL(pnl, txid)
      } else {
        yield* persistence.addPnL(pnl, txid)
      }
    }
  }

  persistence.getConfig = function*(key) {
    if (key === undefined)
      return yield execute('select * from config where env=?', [process.env.NODE_ENV])
    return yield execute('select * from config where env=? and key=?', [process.env.NODE_ENV, key])
  }

  persistence.setConfig = function*(key, value) {
    var statement = {
      query : "insert into config (env, key, value) values (?,?,?)",
      params: [process.env.NODE_ENV, key, value]
    }
    yield* batchCommit([statement])
  }

  persistence.updateUserPosition = function*(position, txid) {
    assert(!txid || dbTransactions[txid], `no such transaction ${txid}`)
    var statements = [{
      query : "insert into position (instrument, userid, payload) values (?,?,?)",
      params: [position.instrument, position.userid, position.toPayload()]
    }, {
      query : "insert into position_history (instrument, userid, time, payload) values (?,?,?,?)",
      params: [position.instrument, position.userid, getTransactionTime(txid), position.toPayload()]
    }]
    yield* merge(txid, statements)
  }

  persistence.deleteUserPosition = function*(position, txid) {
    assert(dbTransactions[txid], `no such transaction ${txid}`)
    var statements = [{
      query : "DELETE from position where instrument = ? and userid = ?",
      params: [position.instrument, position.userid]
    }, {
      query : "insert into position_history (instrument, userid, time, payload) values (?,?,?,?)",
      params: [position.instrument, position.userid, getTransactionTime(txid), JSON.stringify({ action: 'deleted' })]
    }]
    yield* merge(txid, statements)
  }

  persistence.saveUserExecutions = function*(symbol, userExecutions, txid) {
    assert(Array.isArray(userExecutions) && userExecutions.length > 0, `invalid userExecutions ${userExecutions}`)
    // assert(dbTransactions[txid], `no such transaction ${txid}`)
    var statements = userExecutions.map(userExecution => {
      return {
        query : "insert into user_execution(instrument, userid, executionid, side, payload) values (?,?,?,?,?)",
        params: [symbol, userExecution.userid, userExecution.executionid, userExecution.side, JSON.stringify(userExecution)]
      }
    })
    yield* merge(txid, statements)
  }

  persistence.saveReport = function*(userid, uuid, report) {
    var statement = {
      query : "insert into report(userid, uuid, payload) values (?,?,?)",
      params: [userid, uuid, JSON.stringify(report)]
    }
    yield execute(statement.query, statement.params, options);
  }

  persistence.addAffiliate = function*(id, payload, txid) {
    var statements = [{ query: "insert into affiliate (id, payload) values (?,?)", params: [id, JSON.stringify(payload)] }]
    yield* merge(txid, statements)
  }

  persistence.removeAffiliate = function*(id) {
    var statements = [{ query: "delete from affiliate  where id=?", params: [id] }]
    yield* batchCommit(statements)
  }

  persistence.updateAffiliateRewards = function*(rewards, txid) {
    if (rewards.length === 0) return rewards
    var statements = rewards.map(reward => {
      return { query: "insert into affiliate_rewards (userid, payload) values (?,?)", params: [reward.userid, JSON.stringify(reward)] }
    })
    yield* merge(txid, statements)
  }

  persistence.addUnconfirmedTxId = function*(userId, txid) {
    var statements = [{ query: "insert into unconfirmed_tx (userid, payload) values (?,?)", params: [userId, txid] }]
    yield* merge(undefined, statements)
  }

  persistence.removeConfirmedTxId = function*(userId, txid) {
    var statements = [{ query: "delete from  unconfirmed_tx where userid = ? and payload = ?", params: [userId, txid] }]
    yield* merge(undefined, statements)
  }

  persistence.addSettlementHistory = function*(year, time, payload, txid) {
    var statements = [{ query: "insert into settlement_history (year, time, payload) values (?,?,?)", params: [year, time, JSON.stringify(payload)] }]
    yield* merge(txid, statements)
  }

  persistence.putApiKey = function*(userid, apiPublicKey, exportApiKey, revoked, timeColumn) {
    var statements = [
      {
        query : `insert into apikey(userid, publicapikey, revoked, payload, ${timeColumn}) values (?,?,?,?, ?)`,
        params: [userid, apiPublicKey, revoked, exportApiKey, Date.now() + ""]
      }]
    yield* merge(undefined, statements)
  }

  persistence.saveCandles = function*(symbol, tf, candles) {
    assert(tf, 'Timeframe not specified')
    assert(candles, 'No candles given to save')
    var statements = candles.map(candle => ({
      query : "insert into candle (instrument, timeframe, time, payload ) values (?,?,?,?)",
      params: [symbol, tf.toString(), candle.t.toString(), JSON.stringify(candle)]
    }))
    util.log(JSON.stringify(statements))
    yield* batchCommit(statements)
  }

  persistence.createTicket = function*(ticket) {
    var statements = [{ query: "insert into open_ticket (userid, uuid, payload) values (?,?,?)", params: [ticket.userid, ticket.uuid, JSON.stringify(ticket)] }]
    yield* batchCommit(statements)
  }

  persistence.deleteTicket = function*(ticket) {
    var statements = [
      { query: "delete from open_ticket where userid = ? and uuid = ?", params: [ticket.userid, ticket.uuid] },
      { query: "insert into closed_ticket (userid, uuid, payload) values (?,?,?)", params: [ticket.userid, ticket.uuid, JSON.stringify(ticket)] }
    ]
    yield* batchCommit(statements)
  }

  persistence.addAdvisory = function*(id, payload) {
    yield* batchCommit([{ query: 'insert into advisory (id, payload) values (?,?)', params: [id, JSON.stringify(payload)] }])
  }

  persistence.deleteAdvisory = function*(id) {
    yield* batchCommit([{ query: 'delete from advisory where id = ?', params: [id] }])
  }

  function* batchCommit(statements) {
    try {
      if (!statements || statements.length === 0) return;
      yield batch(statements, options);
    } catch (e) {
      util.log(e, statements)
      util.log(e.stack)
      if (cassandra.types.responseErrorCodes.writeTimeout === e.code) {
        util.log('####### suppressing error for writeTimeout')
      } else {
        throw new Error("Unable to complete request")
      }
    }
  }

  function addLastModified(payload) {
    payload.lastModified = Date.now()
  }

  //************************************************************************** READ ******************************************************************************************

  persistence.getOpenOrdersForAllUsers = bluebird.coroutine(function*(symbol, action) {
    var pageState
    do {
      var time     = Date.now()
      var response = yield execute("select * from open_order_book where instrument = ?",
                                   [symbol], { prepare: true, pageState: pageState, consistency: cassandra.types.consistencies.quorum })
      pageState    = response.pageState
      util.log("getOpenOrdersForAllUsers", Date.now() - time, response.rows.length, pageState)
      for (var i = 0; i < response.rows.length; i++) {
        var row          = response.rows[i];
        var order        = JSON.parse(row.payload)
        order.instrument = order.instrument || symbol
        action(order)
      }
    } while (pageState)
  })

  persistence.getOpenOrders = function*(symbol, userid) {
    var orders = yield persistence.readRecords("select payload from open_orders where userid = ? and instrument = ?", [userid, symbol])
    setInstrument(symbol, orders)
    return orders
  }

  function setInstrument(symbol, list) {
    list.forEach(item => item.instrument = item.instrument || symbol)
  }

  persistence.getApiKeys = function*(userid) {
    return (yield persistence.readRecords('select payload from apikey where userid=?', [userid]))
  }

  persistence.getOpenOrder = function*(symbol, userid, uuid) {
    var records = yield persistence.readRecords("select payload from open_orders where userid = ? and instrument = ? and uuid = ?",
                                                [userid, symbol, uuid])
    setInstrument(symbol, records)
    return records && records.length > 0 ? records[0] : undefined
  }

  persistence.getOrder = function*(symbol, userid, uuid, status) {
    assert(ORDER_TABLE_MAP[status], "Invalid status")
    var records = yield persistence.readRecords("select payload from " + ORDER_TABLE_MAP[status] + " where userid = ? and instrument = ? and uuid = ?",
                                                [userid, symbol, uuid])
    setInstrument(symbol, records)
    return records && records.length > 0 ? records[0] : undefined
  }

  persistence.getClosedOrders = function*(symbol, userid, uuid, limit) {
    uuid       = uuid || FAR_INTO_FUTURE
    limit      = limit || DEFAULT_PAGE_SIZE
    var orders = yield persistence.readRecords("select payload from closed_orders where userid = ? and instrument = ? and uuid < ? ORDER BY uuid desc limit ?", [userid, symbol, uuid, limit])
    setInstrument(symbol, orders)
    return orders
  }

  persistence.getCancelledOrders = function*(symbol, userid, uuid, limit) {
    uuid       = uuid || FAR_INTO_FUTURE
    limit      = limit || DEFAULT_PAGE_SIZE
    var orders = yield persistence.readRecords("select payload from cancelled_orders where userid = ? and instrument = ? and uuid < ? ORDER BY uuid desc limit ?", [userid, symbol, uuid, limit])
    setInstrument(symbol, orders)
    return orders
  }

  persistence.getExecutions = function*(symbol) {
    var executions = yield persistence.readRecords("select payload from execution where instrument = ?", [symbol])
    setInstrument(symbol, executions)
    return executions
  }

  persistence.getExecutionsSince = function*(symbol, sinceInMilli) {
    var query      = "select payload from execution where uuid > maxTimeuuid(?) and instrument = ?"
    var params     = [sinceInMilli, symbol]
    var executions = yield persistence.readRecords(query, params)
    setInstrument(symbol, executions)
    return executions
  }

  persistence.getLastExecution = function*(symbol) {
    var query         = "select payload from execution where instrument = ? limit 1"
    var params        = [symbol]
    var lastExecution = yield persistence.readRecords(query, params)
    setInstrument(symbol, lastExecution)
    return lastExecution.length === 1 ? lastExecution[0] : undefined
  }

  persistence.getLimitedExecutions = function*(symbol, limit) {
    var query      = "select payload from execution where instrument = ? limit ?"
    var params     = [symbol, limit]
    var executions = yield persistence.readRecords(query, params)
    setInstrument(symbol, executions)
    return executions
  }

  persistence.getInstrument = function*(symbol) {
    var query       = "select payload from instrument where symbol = ?"
    var params      = [symbol]
    var instruments = yield persistence.readRecords(query, params)
    return instruments.length === 1 ? instruments[0] : undefined
  }

  persistence.getUnExpiredInstruments = function*() {
    var query = "select payload from instrument where expired = ? "
    return yield persistence.readRecords(query, ['false'])
  }

  persistence.getAllRequestsInQueue = function*(symbol) {
    var query    = "select payload from request_queue where instrument = ?"
    var params   = [symbol]
    var requests = yield persistence.readRecords(query, params)
    setInstrument(symbol, requests)
    return requests
  }

  persistence.countRequestQueue = function*(symbol) {
    var query   = "select payload from request_queue where instrument = ?"
    var params  = [symbol]
    var records = yield persistence.readRecords(query, params)
    return records && records.length > 0
  }

  persistence.getCandles = function*(symbol, t, tf, count) {
    var cql     = "select payload FROM candle where timeframe = ? and  time <= ? and instrument = ? LIMIT ?"
    var candles = yield persistence.readRecords(cql, [tf.toString(), t.toString(), symbol, count])
    setInstrument(symbol, candles)
    return candles
  }

  persistence.getUser = function*(userId) {
    var cql = "select payload FROM user where userid = ?"
    return (yield persistence.readRecords(cql, [userId], JSON.parse))[0]
  }

  //todo: need to have pagination some time in future when lots of users are there
  persistence.getUsers = function*() {
    var cql = "select payload FROM user"
    return yield persistence.readRecords(cql, [], JSON.parse)
  }

  persistence.getAllPnL = function*() {
    var cql = "select payload FROM pnl"
    return yield persistence.readRecords(cql, [], ProfitAndLoss.fromPayload)
  }

  persistence.getPnL = function*(userid) {
    var cql = "select payload FROM pnl where userid = ?"
    var pnl = yield persistence.readRecords(cql, [userid], ProfitAndLoss.fromPayload)
    return pnl.length === 0 ? undefined : pnl[0]
  }

  persistence.getUserPosition = function*(userId) {
    var cql = "select payload FROM position where userid = ?"
    return yield persistence.readRecords(cql, [userId], Position.fromPayload)
  }

  persistence.getAllPositions = function*() {
    var cql = "select payload FROM position"
    return yield persistence.readRecords(cql, [], Position.fromPayload)
  }

  persistence.getTickets = function*(userid) {
    var cql     = "select payload FROM open_ticket where userid = ?"
    var tickets = yield persistence.readRecords(cql, [userid])
    setInstrument(symbol, tickets)
    return tickets
  }

  persistence.getClosedTickets = function*(userid) {
    var cql     = "select payload FROM closed_ticket where userid = ?"
    var tickets = yield persistence.readRecords(cql, [userid])
    setInstrument(symbol, tickets)
    return tickets
  }

  persistence.getTicket = function*(userid, uuid) {
    var cql     = "select payload FROM open_ticket where userid = ? and uuid = ?"
    var records = yield persistence.readRecords(cql, [userid, uuid])
    setInstrument(symbol, records)
    return records.length === 0 ? undefined : records[0]
  }

  persistence.getAffiliate = function*(id) {
    var cql     = "select payload FROM affiliate where id = ? "
    var records = yield persistence.readRecords(cql, [id])
    return records.length === 0 ? undefined : records[0]
  }

  persistence.getAffiliates = function*() {
    var cql = "select payload FROM affiliate"
    return yield persistence.readRecords(cql, [])
  }

  persistence.getAffiliateReward = function*(userid) {
    var cql     = "select payload FROM affiliate_rewards where userid = ? "
    var records = yield persistence.readRecords(cql, [userid])
    return records.length === 0 ? undefined : records[0]
  }

  persistence.getAffiliateRewards = function*() {
    var cql = "select payload FROM affiliate_rewards"
    return yield persistence.readRecords(cql, [])
  }

  persistence.getUserExecutionsAfter = function*(symbol, userid, executionid) {
    var cql           = 'select payload from user_execution where instrument= ? and userid= ?  and executionid > ?'
    var useExecutions = yield persistence.readRecords(cql, [symbol, userid, executionid])
    setInstrument(symbol, useExecutions)
    return useExecutions
  }

  persistence.getUserExecutions = function*(symbol, userid, uuid, limit) {
    uuid               = uuid || FAR_INTO_FUTURE
    limit              = limit || DEFAULT_PAGE_SIZE
    var cql            = 'select payload from user_execution where instrument= ? and userid= ? and executionid < ? ORDER BY executionid desc limit ?'
    var userExecutions = yield persistence.readRecords(cql, [symbol, userid, uuid, limit])
    setInstrument(symbol, userExecutions)
    return userExecutions
  }

  persistence.getAllUserExecutions = function*(userid, uuid, limit) {
    uuid               = uuid || FAR_INTO_FUTURE
    limit              = limit || DEFAULT_PAGE_SIZE
    var cql            = 'select payload from user_execution_history where userid= ? and executionid < ? ORDER BY executionid desc limit ?'
    var userExecutions = yield persistence.readRecords(cql, [userid, uuid, limit])
    setInstrument(undefined, userExecutions)
    return userExecutions
  }

  persistence.getUnconfirmedTxIds = function*(userid, convert) {
    convert = convert || function (data) {
        return data
      }
    var cql = 'select payload from unconfirmed_tx where userid=?'
    return yield persistence.readRecords(cql, [userid], convert)
  }

  persistence.getLastSettlement = function*(year) {
    var cql = "select payload from settlement_history where year = ? limit 1"
    return yield persistence.readRecords(cql, [year])
  }

  persistence.getAdvisories = function*() {
    var cql = 'select payload from advisory'
    return yield persistence.readRecords(cql, [])
  }

  persistence.getReport = function*(userid, uuid) {
    assert(userid, 'userid undefined.')
    assert(uuid, 'uuid undefined.')
    var cql    = 'select payload from report where userid=? and uuid=?'
    var result = yield persistence.readRecords(cql, [userid, uuid])
    return result.length === 0 ? undefined : result[0]
  }

  persistence.getAllReports = function*(userid) {
    assert(userid, 'userid undefined.')
    var cql = 'select uuid from report where userid=?'
    return yield persistence.readRecords(cql, [userid], echo, 'uuid')
  }

  persistence.readRecords = function (query, params, convert, field) {
    return new bluebird(function (success, reject) {
      convert      = convert || JSON.parse
      field        = field || 'payload'
      var payloads = []
      client.eachRow(query, params, { prepare: true, autoPage: true, consistency: cassandra.types.consistencies.quorum }, function (n, row) {
        var convertedRow = convert(row[field])
        payloads.push(convertedRow)
      }, function (err) {
        var newError
        if (err) {
          util.log(err)
          util.log(err.stack)
          newError = new Error("unable to complete request")
          reject(newError)
          return
        }
        success(payloads)
      })
    })
  }

//****************************************************************************SETUP****************************************************************************************

  function* init() {
    var statements = [
      `CREATE KEYSPACE IF NOT EXISTS ${config.keyspace} WITH replication = {'class': 'SimpleStrategy', 'replication_factor': ${config.replicationFactor}}`,
      `use ${config.keyspace}`,
      "CREATE TABLE IF NOT EXISTS pnl (userid text, payload text, PRIMARY KEY(userid))",
      "CREATE TABLE IF NOT EXISTS pnl_history (userid text, time text, payload text, PRIMARY KEY(userid, time)) WITH CLUSTERING ORDER BY(time DESC)",
      "CREATE TABLE IF NOT EXISTS position (userid text, instrument text, payload text, PRIMARY KEY(userid, instrument))",
      "CREATE TABLE IF NOT EXISTS position_history (userid text, instrument text, time text, payload text, PRIMARY KEY(userid, instrument, time)) WITH CLUSTERING ORDER BY(instrument ASC, time DESC)",
      "CREATE TABLE IF NOT EXISTS user (userid text PRIMARY KEY, payload text)",
      "CREATE TABLE IF NOT EXISTS affiliate (id text PRIMARY KEY, payload text)",
      "CREATE TABLE IF NOT EXISTS affiliate_rewards (userid text PRIMARY KEY, payload text)",
      "CREATE TABLE IF NOT EXISTS candle (instrument text, timeframe text, time text, payload text, PRIMARY KEY((instrument, timeframe), time))WITH CLUSTERING ORDER BY(time DESC)",

      "CREATE TABLE IF NOT EXISTS instrument (symbol text, start text, expiry text, expired text, payload text, PRIMARY KEY((symbol), expiry))WITH CLUSTERING ORDER BY(expiry DESC)",
      "CREATE INDEX IF NOT EXISTS INSTRUMENT_STATUS ON instrument (expired)",
      "CREATE TABLE IF NOT EXISTS open_orders (userid text, instrument text, uuid timeuuid, payload text, PRIMARY KEY((userid, instrument), uuid)) WITH CLUSTERING ORDER BY(uuid ASC)",
      "CREATE TABLE IF NOT EXISTS closed_orders (userid text, instrument text, uuid timeuuid, payload text, PRIMARY KEY((userid, instrument), uuid)) WITH CLUSTERING ORDER BY(uuid ASC)",
      "CREATE TABLE IF NOT EXISTS cancelled_orders (userid text, instrument text, uuid timeuuid, payload text, PRIMARY KEY((userid, instrument), uuid)) WITH CLUSTERING ORDER BY(uuid ASC)",
      "CREATE MATERIALIZED VIEW IF NOT EXISTS open_order_book AS SELECT * from open_orders WHERE userid IS NOT NULL AND instrument IS NOT NULL AND uuid IS NOT NULL PRIMARY KEY((instrument), uuid, userid) WITH CLUSTERING ORDER BY(uuid ASC)",

      "CREATE TABLE IF NOT EXISTS settlement (userid text, time double, payload text, PRIMARY KEY((userid), time)) WITH CLUSTERING ORDER BY(time DESC)",
      "CREATE TABLE IF NOT EXISTS user_execution (instrument text, userid text, executionid timeuuid, side text, payload text, PRIMARY KEY((instrument, userid), executionid, side)) WITH CLUSTERING ORDER BY(executionid DESC)",
      //This view is required for reporting user executions for all instruments.
      "create MATERIALIZED VIEW IF NOT EXISTS user_execution_history as SELECT * FROM user_execution where userid is not null and executionid is not null and instrument is not null and side is not null PRIMARY KEY ((userid), executionid, instrument, side) WITH CLUSTERING ORDER BY(executionid DESC);",

      "CREATE TABLE IF NOT EXISTS unconfirmed_tx (userid text, payload text, PRIMARY KEY((userid), payload))",
      "CREATE TABLE IF NOT EXISTS settlement_history (year text, time text, payload text, supplement text, PRIMARY KEY((year), time)) WITH CLUSTERING ORDER BY(time DESC)",

      "CREATE TABLE IF NOT EXISTS execution (instrument text, uuid  timeuuid, payload text, PRIMARY KEY(instrument, uuid)) WITH CLUSTERING ORDER BY(uuid DESC)",
      "CREATE TABLE IF NOT EXISTS closed_ticket (userid text, uuid timeuuid, payload text, PRIMARY KEY((userid), uuid)) WITH CLUSTERING ORDER BY(uuid DESC)",
      "CREATE TABLE IF NOT EXISTS open_ticket (userid text, uuid timeuuid, payload text, PRIMARY KEY((userid), uuid)) WITH CLUSTERING ORDER BY(uuid DESC)",
      "CREATE TABLE IF NOT EXISTS request_queue (instrument text, uuid timeuuid, payload text, PRIMARY KEY((instrument), uuid)) WITH CLUSTERING ORDER BY(uuid ASC)",
      "CREATE TABLE IF NOT EXISTS config(env text, key text, value text, PRIMARY KEY(env, key)) WITH CLUSTERING ORDER BY(key ASC)",
      "CREATE TABLE IF NOT EXISTS advisory(id text, payload text, PRIMARY KEY(id))",
      "CREATE TABLE IF NOT EXISTS report(userid text, uuid timeuuid, payload text, PRIMARY KEY((userid), uuid)) WITH CLUSTERING ORDER BY(uuid DESC)",
      "CREATE TABLE IF NOT EXISTS apikey(userid text, publicapikey text, revoked text, createtime text, revoketime text, payload text, PRIMARY KEY((userid), publicapikey)) ",
      // "CREATE TABLE IF NOT EXISTS apikeyreq_history(userid text, nonce, auth_header, publicapikey text, signature text, payload text)"
      // "CREATE TABLE IF NOT EXISTS obj_history(userid text, uuid, publicapikey text, signature text, payload text)"

      // user -> keyname -> apikey
    ];
    yield* isDBConnected(statements[0])
    for (var i = 0; i < statements.length; i++) {
      yield execute(statements[i]);
    }
    util.log("############ Cassandra initiated")
    return true
  }

  function* isDBConnected(statement) {
    var connecting = true
    while (connecting) {
      try {
        yield execute(statement)
        connecting = false
      } catch (e) {
        util.log("not connected to db. waiting for next 5 sec")
        util.log(e.stack)
        yield bluebird.delay(5000)
      }
    }

  }

  function echo(value) {
    return value
  }

  yield* init()
  return persistence
}()
