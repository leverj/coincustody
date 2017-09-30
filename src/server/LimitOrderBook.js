const emitter     = require('events').EventEmitter;
const AVLTree     = require('binary-search-tree').AVLTree;
const Queue       = require("queue.js");
const microTime   = require("microtime.js");
const TimeUuid    = require('cassandra-driver').types.TimeUuid
const sinful      = require('sinful-math.js')
const _           = require('lodash')
const config      = require('config') // replaced with dbconfig when exchange creates instance of limitOrderBook
const affirm      = require('affirm.js')
const util        = require("util")
const flag        = require("./flag")
const instruments = require("../common/instruments")
const flipSide    = { buy: 'sell', sell: 'buy' }
const bluebird    = require('bluebird')

AVLTree._AVLTree.prototype.partialTreeTraversal = function (lambda) {
  if (lambda.done) return

  if (this.left) {
    this.left.partialTreeTraversal(lambda)
  }
  if (!lambda.done) lambda.fn(this)
  if (this.right) {
    this.right.partialTreeTraversal(lambda)
  }
};

function DepthCollector(depth) {
  this.done       = false
  this.depth      = depth
  this.collection = []

  this.fn = function (node) {
    if (node.data[0]) this.collection.push(node.data[0]);
    this.done = (this.depth == this.collection.length);
  }
}
function TriggeredCollector(price, compare) {
  this.done       = false
  this.collection = []
  this.fn         = function (node) {
    if (!node.data[0] || compare(node.data[0].price, price) < 0) {
      return (this.done = true)
    }
    var self = this
    node.data[0].orders.forEach(order => self.collection.push(order))
  }
}

function Execution(buyOrder, sellOrder, filled, executionPrice, instrument) {
  this.uuid           = TimeUuid.now();
  this.buyOrderId     = buyOrder.uuid;
  this.sellOrderId    = sellOrder.uuid;
  this.filled         = filled;
  this.executionPrice = executionPrice;
  this.eventTime      = microTime.micro();
  this.buyUser        = buyOrder.userid
  this.sellUser       = sellOrder.userid
  this.liquidity      = liquiditySide(buyOrder, sellOrder)
  this.buyTerminated  = buyOrder.terminated
  this.sellTerminated = sellOrder.terminated
  this.instrument     = instrument
}

function liquiditySide(buyOrder, sellOrder) {
  var liquidity             = {}
  liquidity[buyOrder.uuid]  = isMakerOrTaker(buyOrder, sellOrder)
  liquidity[sellOrder.uuid] = isMakerOrTaker(sellOrder, buyOrder)
  affirm(liquidity[buyOrder.uuid] === 'commission' || liquidity[sellOrder.uuid] === 'commission', 'Error determining commission')
  return liquidity;
}

function isMakerOrTaker(order1, order2) {
  if (instruments.get(order1.instrument).isExpired()) {
    return 'commission'
  }
  return isMakerOrTakerByType(order1) || isMakerOrTakerByTime(order1.entryTime, order2.entryTime)
}

function isMakerOrTakerByType(order) {
  if (order.orderType === 'MKT' || order.orderType === 'STP' || order.orderType === 'STM') return 'commission'
}

function isMakerOrTakerByTime(time1, time2) {
  return time1 > time2 ? 'commission' : 'reward'
}

function Order(symbol, side, quantity, price, userid, orderType, uuid, stopPrice, targetPrice, clientid) {
  this.uuid            = uuid || TimeUuid.now().toString();
  this.userid          = userid;
  this.side            = side;
  this.quantity        = quantity;
  this.filled          = 0;
  this.cancelled       = 0;
  this.price           = price;
  this.normalizedPrice = instruments.get(symbol).getNormalizedPrice(price)
  this.averagePrice    = 0;
  this.entryTime       = microTime.micro();
  this.eventTime       = this.entryTime;
  this.status          = Order.OPEN;
  this.entryOrder      = {}
  this.orderType       = orderType ? orderType : "LMT";
  this.stopPrice       = stopPrice
  if (typeof(targetPrice) === 'number' || targetPrice === 'NONE') this.targetPrice = targetPrice
  else this.targetPrice = instruments.get(symbol).config.targetprice
  this.clientid   = clientid
  this.instrument = symbol
}

Object.defineProperties(Order.prototype, {
  "toBeFilled": {
    get       : function () {
      return sinful.sub(this.quantity, this.filled || 0, this.cancelled || 0)
    },
    enumerable: true
  },
  "queuePos"  : {
    value   : undefined,
    writable: true
  }
})

Order.BUY       = "buy";
Order.SELL      = "sell";
Order.CANCELLED = "cancelled";
Order.CLOSED    = "closed";
Order.OPEN      = "open";
Order.STP       = "STP"
Order.STM       = "STM"
Order.SLM       = "SLM"
Order.LMT       = "LMT"
Order.MKT       = "MKT"
Order.TGT       = "TGT"

Order.direction = { 'buy': 1, 'sell': -1 }

Order.fromOrder = function (symbol, order, userid, commission, reward, cushion, reservedTicks) {
  var newOrder           = new Order(symbol, order.side, order.quantity, order.price, userid, order.orderType, undefined, order.stopPrice, order.targetPrice, order.clientid)
  newOrder.crossMargin   = order.crossMargin
  newOrder.commission    = commission;
  newOrder.reward        = reward;
  newOrder.cushion       = cushion;
  newOrder.reservedTicks = reservedTicks;
  if (!newOrder.stopPrice) newOrder.marginPerQty = order.marginPerQty
  return newOrder;
}

Order.accumulator = function (oco) {
  var quantity         = 0
  var order            = new Order(oco.instrument, oco.side, quantity, oco.price, oco.userid, oco.orderType)
  order.merges         = []
  order.entryAmount    = 0
  order.executionPrice = 0
  return order
}

Order.clone = function (order) {
  return _.assign(new Order(order.instrument, order.side, order.quantity, order.price, order.userid, order.orderType),
                  {
                    uuid                : order.uuid,
                    filled              : order.filled,
                    cancelled           : order.cancelled,
                    averagePrice        : order.averagePrice,
                    entryTime           : order.entryTime,
                    eventTime           : order.eventTime,
                    status              : order.status,
                    oco                 : order.oco,
                    stopPrice           : order.stopPrice,
                    targetPrice         : order.targetPrice,
                    maxStop             : order.maxStop,
                    flatten             : order.flatten,
                    entryOrder          : order.entryOrder,
                    triggered           : order.triggered,
                    clientid            : order.clientid,
                    executionPrice      : order.executionPrice,
                    entryPrice          : order.entryPrice,
                    // entryPrices         : order.entryPrices,
                    // entryAmounts        : order.entryAmounts,
                    entryAmount         : order.entryAmount,
                    terminated          : order.terminated,
                    reason              : order.reason,
                    commission          : order.commission,
                    reward              : order.reward,
                    cushion             : order.cushion,
                    reservedTicks       : order.reservedTicks,
                    migration           : order.migration,
                    instrument          : order.instrument,
                    crossMargin         : order.crossMargin || false,
                    normalizedEntryPrice: order.normalizedEntryPrice,
                    normalizedPrice     : order.normalizedPrice,
                    normalizedMaxStop   : order.normalizedMaxStop,
                    marginPerQty        : order.marginPerQty
                  })
}

var mergeFunctions = {
  TGT: function (symbol, side, price1, price2) {
    affirm(side === Order.BUY || Order.SELL, 'Invalid order side')
    if (price1 === 'NONE' || price2 === 'NONE') return 'NONE'
    var sideFunction = side === Order.BUY ? Math.min : Math.max
    return sideFunction(price1, price2)
  },
  STP: function (symbol, side, price1, price2, qty1, qty2) {
    var price = instruments.get(symbol).mergePrice(price1, price2, qty1, qty2)
    return getAdjustedStopPrice(price, side, instruments.get(symbol).config.ticksize)
  }
}

function getAdjustedStopPrice(price, side, ticksize) {
  var fn = side === Order.BUY ? Math.floor : Math.ceil
  return fn(Math.pow(10, ticksize) * price) / Math.pow(10, ticksize)
}

Order.prototype.setMarginRequiredByOrder = function (bands) {
  var instrument = instruments.get(this.instrument)
  if (instrument.config.type !== 'inverse') {
    this.marginPerQty = undefined
    return
  }
  if (this.marginPerQty > 0) return
  var marginRequired = instrument.calculateMarginRequiredByOrder(this, bands)
  this.marginPerQty  = Math.ceil(marginRequired / this.toBeFilled)
}

Order.prototype.merge = function (order) {
  affirm(order, 'can not merge undefined order')
  affirm(this.orderType === Order.TGT || this.orderType === Order.STP, 'Merge is supported for TGT or STP order type')
  affirm(this.orderType === order.orderType, 'Incompatible order types for merge')
  affirm(order instanceof Order, 'order should an instance of Order object')
  var quantity     = order.toBeFilled
  var mergedQty    = this.toBeFilled
  var fn           = mergeFunctions[this.orderType]
  var orig         = this.entryAmount
  this.entryAmount = sinful.add(order.entryAmount, this.entryAmount)
  affirm(this.entryAmount % 1 === 0, 'Invalid entry amount ' + this.entryAmount + " = " + order.entryAmount + "+" + orig)
  this.quantity     = sinful.add(this.quantity, quantity)
  this.commission   = Math.max(order.commission, this.commission)
  this.reward       = Math.max(order.reward, this.reward)
  var origThisprice = this.price
  this.price        = fn(order.instrument, this.side, order.price, this.price, quantity, mergedQty)
  if (this.orderType === Order.STP) {
    if (!(!isNaN(this.price) && this.price > 0)) {
      console.log("######## orderbook merge instrument", order.instrument, "side", this.side, "price1", order.price, "price2", origThisprice, "qty1", quantity, "qty2", mergedQty, "result", this.price)
    }
    affirm(!isNaN(this.price) && this.price > 0, 'Invalid merged price.')
  }
  this.updateNormalizedPrice()
  // if (merged.crossMargin || order.crossMargin) merged.crossMargin = true
  this.updateEntryPrice()
  if (this.merges) this.merges.push(order.uuid)
  if (order.orderType === Order.STP) this.updateMaxStop()
  order.merged = quantity
  order.cancel(quantity)
  order.mergedTo = this.uuid
}

Order.prototype.stopOrder = function (executionPrice, qty, commissionPerQty) {
  affirm(!isNaN(executionPrice) && executionPrice > 0, 'Invalid stop price calculated: ' + executionPrice)
  affirm(!isNaN(qty) && qty > 0, 'Invalid quantity for stop order: ' + qty)
  affirm(!isNaN(commissionPerQty), 'Invalid commision for stop order: ' + commissionPerQty)
  var instrument = instruments.get(this.instrument)
  var stopPrice
  if (this.marginPerQty) {
    var marginForStop = sinful.mul(qty, sinful.sub(this.marginPerQty, commissionPerQty))
    stopPrice         = instrument.calculateStopPriceForMargin(qty, executionPrice, marginForStop, flipSide[this.side])
  } else {
    var stopPoints = this.stopPrice && sinful.mul(this.stopPrice, Order.direction[this.side]) || undefined
    affirm(stopPoints, "stop price not defined " + this.stopPrice)
    stopPrice = sinful.sub(executionPrice, stopPoints)
  }
  affirm(typeof stopPrice === 'number' && stopPrice > 0, 'Invalid stop price calculated: ' + stopPrice)
  var stopOrder = this.exitOrder(stopPrice, qty, executionPrice, 'STP')
  stopOrder.updateMaxStop()
  return stopOrder
}

Order.prototype.updateMaxStop = function () {
  if (this.orderType !== Order.STP) return
  var instrument         = instruments.get(this.instrument)
  var cushion            = this.cushion || instrument.config.stopcushion
  this.maxStop           = sinful.add(this.price, sinful.mul(Order.direction[this.side], cushion))
  this.maxStop           = instrument.updateMaxWithCommission(this)
  this.normalizedMaxStop = instrument.getNormalizedPrice(this.maxStop)
  affirm(this.normalizedMaxStop > 0 && this.normalizedMaxStop <= 1e10, "Invalid max stop calculated. Price: " + this.price + " Max Stop: " + this.maxStop + " Normalized Max Stop: " + this.normalizedMaxStop)
}

Order.prototype.updateNormalizedPrice = function () {
  this.normalizedPrice = instruments.get(this.instrument).getNormalizedPrice(this.price)
}

Order.prototype.isExitOrder = function () {
  return this.orderType === "TGT" || this.orderType === "STP"
}
Order.isExitOrder           = function (order) {
  return order.orderType === "TGT" || order.orderType === "STP"
}
Order.prototype.targetOrder = function (executionPrice, qty) {
  var targetPrice = typeof(this.targetPrice) === 'number' ? sinful.mul(this.targetPrice, Order.direction[this.side]) : this.targetPrice
  var orderPrice  = targetPrice === 'NONE' ? 'NONE' : Math.max(sinful.add(executionPrice, targetPrice), 1)
  return this.exitOrder(orderPrice, qty, executionPrice, 'TGT')
}

Order.prototype.exitOrder = function (orderPrice, quantity, executionPrice, orderType) {
  affirm(orderPrice === 'NONE' || orderPrice > 0, 'Order price must be > 0: ' + orderPrice)
  affirm(executionPrice > 0, 'Execution price must be > 0: ' + executionPrice)
  affirm(this.orderType !== 'STP' && this.orderType !== 'TGT', `not valid for orderType ${this.orderType}`)
  var order                  = new Order(this.instrument, flipSide[this.side], quantity, orderPrice, this.userid, orderType)
  order.commission           = this.commission
  order.reward               = this.reward
  order.cushion              = this.cushion
  order.reservedTicks        = this.reservedTicks
  order.targetPrice          = this.targetPrice
  order.stopPrice            = this.stopPrice
  order.entryPrice           = executionPrice
  order.normalizedEntryPrice = instruments.get(this.instrument).getNormalizedPrice(executionPrice)
  order.entryAmount          = sinful.mul(order.normalizedEntryPrice, quantity)
  affirm(order.entryAmount % 1 === 0, 'Invalid entry amount ' + order.entryAmount + " = " + order.normalizedEntryPrice + " * " + quantity)
  order.crossMargin = this.crossMargin
  return order
}

Order.prototype.updateEntryPrice = function () {
  affirm(this.isExitOrder(), 'Order is not an exit order')
  this.entryPrice           = instruments.get(this.instrument).calculateEntryPrice(this);
  this.normalizedEntryPrice = instruments.get(this.instrument).getNormalizedPrice(this.entryPrice)
}

Order.prototype.getExitOrders = function (executionPrice, qty, commissionPerQty) {
  var stopOrder   = this.stopOrder(executionPrice, qty, commissionPerQty)
  var targetOrder = this.targetOrder(executionPrice, qty)
  stopOrder.oco   = targetOrder.uuid
  targetOrder.oco = stopOrder.uuid

  stopOrder.entryOrder[this.uuid]   = qty
  targetOrder.entryOrder[this.uuid] = qty
  return [stopOrder, targetOrder]
}

Order.toBeFilled = function (order) {
  return sinful.sub(order.quantity, (order.filled || 0), (order.cancelled || 0))
}

Order.prototype.match = function (qty) {
  affirm(this.toBeFilled >= qty, `matching ${qty} is more than toBeFilled ${this.toBeFilled}`)
  this.filled = sinful.add(this.filled, qty)
  this.updateStatus()
}

Order.prototype.cancel = function (qty) {
  affirm(this.toBeFilled >= qty, `cancelling ${qty} is more than toBeFilled ${this.toBeFilled}`)
  this.cancelled = sinful.add(this.cancelled, qty)
  this.updateStatus()
}

Order.prototype.terminate = function (qty) {
  this.terminated = this.terminated || 0
  this.terminated = sinful.add(this.terminated, qty)
}

Order.prototype.updateStatus = function () {
  if (this.toBeFilled !== 0) {
    this.status = Order.OPEN
  } else {
    if (this.filled !== 0) {
      this.status = Order.CLOSED
    } else {
      this.eventTime = microTime.micro()
      this.status    = Order.CANCELLED
    }
  }
}

Order.prototype.terminates = function (price, band) {
  if (this.orderType !== Order.STP) return false
  if (price === 'NONE') return true
  affirm(band && band.min && band.max, 'Band is not defined')
  if (this.side === Order.BUY) {
    return price > this.maxStop || price > band.max;
  } else {
    return price < this.maxStop || price < band.min;
  }
}

function Limit(limitPrice) {
  this.price          = limitPrice;
  this.numberOfOrders = 0;
  this.totalQuantity  = 0;
  this.orders         = new Queue();
}

Limit.prototype.addOrder = function (order) {
  this.orders.push(order);
  order.queuePos = this.orders.tail;
  this.numberOfOrders++;
  this.totalQuantity = sinful.add(this.totalQuantity, order.toBeFilled)
};

function OrderBook(dbConfig, symbol) {
  if (dbConfig) config = dbConfig
  emitter.call(this);
  this.symbol     = symbol
  this.instrument = instruments.get(symbol)
  this.reset();
}

OrderBook.prototype = new emitter();

OrderBook.prototype.reset = function () {
  this.buy           = new AVLTree({ compareKeys: buyOrderCompare });
  this.sell          = new AVLTree({ compareKeys: sellOrderCompare });
  this.buyTarget     = new AVLTree({ compareKeys: buyOrderCompare });
  this.sellTarget    = new AVLTree({ compareKeys: sellOrderCompare });
  this.buyStop       = new AVLTree({ compareKeys: sellOrderCompare });
  this.sellStop      = new AVLTree({ compareKeys: buyOrderCompare });
  this.buyMarket     = new Limit(null)
  this.sellMarket    = new Limit(null)
  this.buyTriggered  = new Limit(null)
  this.sellTriggered = new Limit(null)
  this.lastPrice     = null;
  this.allOrders     = {};
  this.targets       = {}
}

OrderBook.prototype.getAffectedStops = function (band) {
  if (!(band && band.max && band.min)) return []
  var affectedStops = [];
  this.computeTriggeredStops(this.getBandAdjustedTriggerAsk(band), buyOrderCompare, affectedStops, this.buyStop)
  this.computeTriggeredStops(this.getBandAdjustedTriggerBid(band), sellOrderCompare, affectedStops, this.sellStop)
  return affectedStops
}

OrderBook.prototype.getBandAdjustedTriggerAsk = function (band) {
  var max = sinful.sub(band.max, this.instrument.config.stopcushion)
  return Math.min(max, this.getTriggerAsk())
}

OrderBook.prototype.getBandAdjustedTriggerBid = function (band) {
  var min = sinful.add(band.min, this.instrument.config.stopcushion)
  return Math.max(min, this.getTriggerBid())
}

OrderBook.prototype.getAffectedStopsByPrice = function (price) {
  var affectedStops = [];
  affirm(price > 0, 'Invalid price:' + price)
  var max = sinful.sub(price, this.instrument.config.stopcushion)
  var min = sinful.add(price, this.instrument.config.stopcushion)
  this.computeTriggeredStops(max, buyOrderCompare, affectedStops, this.buyStop)
  this.computeTriggeredStops(min, sellOrderCompare, affectedStops, this.sellStop)
  return affectedStops
}

OrderBook.prototype.computeTriggeredStops = function (price, compare, affectedStops, stop) {
  if (!price) return
  var collector = new TriggeredCollector(price, compare)
  stop.tree.partialTreeTraversal(collector)
  collector.collection.forEach(order => affectedStops.push(Order.clone(order)))
}

OrderBook.prototype.waitForTriggeredMatch = function*() {
  while (this.buyTriggered.numberOfOrders !== 0 || this.sellTriggered.numberOfOrders !== 0) {
    util.log('waiting for triggered orders to done matching', this.instrument.symbol)
    yield bluebird.delay(1000)
  }
}

OrderBook.prototype.waitUntilOrderBookIsEmpty = function*() {
  while (!_.isEmpty(this.allOrders)) {
    util.log('waiting for orders to clean:', this.instrument.symbol)
    yield bluebird.delay(1000)
  }
}
function sellOrderCompare(a, b) {
  if (a === 'NONE' && b === 'NONE') return 0
  if (a === 'NONE') return 1
  if (b === 'NONE') return -1
  return a == b ? 0 : ( a < b ? -1 : 1 );
}

function buyOrderCompare(a, b) {
  if (a === 'NONE' && b === 'NONE') return 0
  if (a === 'NONE') return 1
  if (b === 'NONE') return -1
  return a == b ? 0 : ( a > b ? -1 : 1 );
}

OrderBook.prototype.volumeAt = function (side, price) {
  var ordersAtPrice = this.getBookType(side).search(price)[0]

  return ordersAtPrice ? ordersAtPrice.totalQuantity : 0
};

OrderBook.prototype.getBidAsk = function () {
  return { bid: this.getBid(), ask: this.getAsk() }
}

OrderBook.prototype.getTriggerBid = function () {
  var bid = this.getBid()
  return isNaN(bid) ? 0 : bid
}

OrderBook.prototype.getTriggerAsk = function () {
  var ask = this.getAsk()
  return isNaN(ask) ? Infinity : ask
}

OrderBook.prototype.getLowestBuyStopPrice = function () {
  var price = this.buyStop.tree.getMinKey()
  return isNaN(price) ? Infinity : price
}

OrderBook.prototype.getHighestSellStopPrice = function () {
  var price = this.sellStop.tree.getMinKey()
  return isNaN(price) ? 0 : price
}

OrderBook.prototype.getBid = function () {
  var minKey = this.buy.tree.getMinKey()
  return minKey === "NONE" ? undefined : minKey
}

OrderBook.prototype.getAsk = function () {
  var minKey = this.sell.tree.getMinKey()
  return minKey === "NONE" ? undefined : minKey
}

/*
 OrderBook.prototype.isMarketOrderSupported = function () {
 return this.getBid() || this.getAsk() || this.lastPrice;
 }
 */

OrderBook.prototype.computeExecutionPrice = function (buyOrder, sellOrder) {
  var bidAsk                = this.getBidAsk()
  var marketPrice           = this.lastPrice || bidAsk.bid && bidAsk.ask && sinful.div(sinful.add(bidAsk.bid, bidAsk.ask), 2)
  var buyOrderTypeForMatch  = getOrderTypeForMatch(buyOrder.orderType)
  var sellOrderTypeForMatch = getOrderTypeForMatch(sellOrder.orderType)
  var lastPrice             = {
    'MKT.MKT': marketPrice,
    'MKT.LMT': sellOrder.price,
    'LMT.MKT': buyOrder.price,
    'LMT.LMT': earlierOf(buyOrder, sellOrder).price
  }
  return (this.lastPrice = lastPrice[buyOrderTypeForMatch + '.' + sellOrderTypeForMatch])
}

function isMarketOrderForMatching(orderType) {
  return orderType === 'STM' || orderType === 'MKT' || orderType === 'STP'
}

function isLimitOrderForMatching(orderType) {
  return orderType === 'SLM' || orderType === 'LMT' || orderType === 'TGT';
}

function getOrderTypeForMatch(orderType) {
  if (isMarketOrderForMatching(orderType)) return 'MKT';
  if (isLimitOrderForMatching(orderType)) return 'LMT';
  affirm(false, "Found order type not able handle: " + orderType)
}

function earlierOf(order1, order2) {
  return order1.entryTime > order2.entryTime ? order2 : order1
}

OrderBook.prototype.addMarketOrder = function (order) {
  var limit = this.getMarketLimit(order)
  affirm(limit, `Unable to process order ${order.uuid}, ${order.side}, ${order.orderType}, ${order.isTriggered()} `)
  limit.addOrder(order)
  this.allOrders[order.uuid] = order
}

Order.prototype.isStopAsMarket = function () {
  return (this.orderType == 'STP' || this.orderType == 'STM' ) && this.isTriggered()
}

Order.prototype.isStopOrder = function () {
  return this.orderType == 'STP' ||
         this.orderType == 'SLM' ||
         this.orderType == 'STM'
}

OrderBook.prototype.addOrder = function (order) {
  if (order.status !== Order.OPEN) return
  if (order.orderType == 'MKT' ||
      (order.orderType == 'STM' || order.orderType == 'STP') && order.isTriggered()) {
    return this.addMarketOrder(order)
  }
  var book = this.getBook(order)
  this.addOrderToBook(book, order)
  this.allOrders[order.uuid] = order
  this.addOrderToTargets(order)
}

OrderBook.prototype.addOrderToTargets = function (order) {
  if (order.orderType !== Order.TGT) return
  order    = Order.clone(order)
  var book = this.getBookType(order.side, "Target")
  affirm(order.entryPrice, 'Entry price is not set on target order: ' + order.uuid)
  this.addOrderToBook(book, order, order.entryPrice)
  this.targets[order.uuid] = order
}

OrderBook.prototype.addOrderToBook = function (book, order, price) {
  price     = price || order.price
  var limit = book.search(price)[0]
  if (!limit) book.insert(price, limit = new Limit(price))
  limit.addOrder(order)
}

OrderBook.prototype.removeOrderFromTarget = function (order) {
  if (order.orderType !== Order.TGT) return
  order = this.targets[order.uuid]
  affirm(order, "order not in targets")
  var book = this.getBookType(order.side, "Target")
  affirm(order.entryPrice, 'Entry price is not set on target order: ' + order.uuid)
  var limit = this.getOrderLimit(book, order, order.entryPrice)
  this.removeOrderFromLimit(book, limit, order, order.entryPrice)
  delete this.targets[order.uuid]
}

Order.prototype.isTriggered = function () {
  return this.triggered || this.flatten
}

Order.prototype.isMarketOrder = function () {
  return this.orderType === 'MKT' || this.isStopAsMarket()
}

OrderBook.prototype.getOrder = function (orderId) {
  return this.allOrders[orderId]
}

OrderBook.prototype.getMarketLimit = function (order) {
  if (!(order && order.isMarketOrder())) return
  var marketOrTriggered = order.isTriggered() ? "Triggered" : "Market"
  return this.getBookType(order.side, marketOrTriggered)
}

OrderBook.prototype.getOrderLimit = function (book, order, price) {
  price = price || order.price
  return order && book.search(price)[0]
}

OrderBook.prototype.cancelOrder = function (orderId) {
  var order = this.removeOrder(orderId)
  if (!order) return undefined
  order.status = Order.CANCEL
  return order
}

OrderBook.prototype.getBook = function (order) {
  if (order.isMarketOrder()) return
  var bookType = order.isStopOrder() && !order.isTriggered() ? 'Stop' : ''
  return this.getBookType(order.side, bookType)
}

OrderBook.prototype.removeOrderFromLimitAndAll = function (book, limit, order) {
  this.removeOrderFromLimit(book, limit, order)
  return delete this.allOrders[order.uuid];
}

OrderBook.prototype.removeOrderFromLimit = function (book, limit, order, price) {
  affirm(limit, `limit not found for ${order.uuid}`)
  price = price || order.price
  limit.orders.remove(order.queuePos);
  limit.numberOfOrders--;
  limit.totalQuantity = sinful.sub(limit.totalQuantity, order.toBeFilled)
  if (limit.totalQuantity === 0 && book) book.delete(price)
}

OrderBook.prototype.removeOrder = function (orderId) {
  var order = this.getOrder(orderId)
  if (!order) {
    return undefined
  }
  this.removeOrderFromTarget(order)
  var book  = this.getBook(order)
  var limit = this.getMarketLimit(order) || this.getOrderLimit(book, order)
  return this.removeOrderFromLimitAndAll(book, limit, order);
}

OrderBook.prototype.update = function (order) {
  var orderFromCache = this.getOrder(order.uuid)
  var book           = this.getBook(orderFromCache)
  var limit          = this.getMarketLimit(orderFromCache) || this.getOrderLimit(book, orderFromCache)
  this.updateOrderElements(orderFromCache, order, limit)

  if (order.orderType !== Order.TGT) return
  this.removeOrderFromTarget(order)
  this.addOrderToTargets(order)
}

OrderBook.prototype.updateOrderElements = function (orderFromCache, order, limit) {
  var matched                 = sinful.sub(orderFromCache.toBeFilled, order.toBeFilled)
  orderFromCache.filled       = order.filled
  orderFromCache.cancelled    = order.cancelled
  orderFromCache.eventTime    = order.eventTime
  orderFromCache.averagePrice = order.averagePrice
  orderFromCache.status       = order.status
  orderFromCache.entryAmount  = order.entryAmount
  // orderFromCache.entryAmounts = order.entryAmounts
  orderFromCache.entryPrice   = order.entryPrice
  // orderFromCache.entryPrices  = order.entryPrices
  orderFromCache.terminated   = order.terminated
  limit.totalQuantity -= matched;
}

OrderBook.prototype.getOrderBookByDepth = function (depth) {
  var sellDepthCollector = new DepthCollector(depth);
  var buyDepthCollector  = new DepthCollector(depth);

  this.sell.tree.partialTreeTraversal(sellDepthCollector);
  this.buy.tree.partialTreeTraversal(buyDepthCollector);

  return {
    bid : this.getBid(),
    ask : this.getAsk(),
    buy : buyDepthCollector.collection,
    sell: sellDepthCollector.collection
  };
}

OrderBook.prototype.getOrderBookCacheByDepth = function (depth) {
  var sellDepthCollector       = new DepthCollector(depth);
  var buyDepthCollector        = new DepthCollector(depth);
  var sellTargetDepthCollector = new DepthCollector(depth);
  var buyTargetDepthCollector  = new DepthCollector(depth);
  var sellStopDepthCollector   = new DepthCollector(depth);
  var buyStopDepthCollector    = new DepthCollector(depth);
  /*
   var buyMarket                = []
   var sellMarket               = []
   var buyTriggered                = []
   var sellTriggered               = []
   this.buyMarket.orders.forEach(order => buyMarket.push(order))
   this.sellMarket.orders.forEach(order => sellMarket.push(order))
   this.buyTriggered.orders.forEach(order => buyTriggered.push(order))
   this.sellTriggered.orders.forEach(order => sellTriggered.push(order))
   */

  this.sell.tree.partialTreeTraversal(sellDepthCollector);
  this.buy.tree.partialTreeTraversal(buyDepthCollector);
  this.sellTarget.tree.partialTreeTraversal(sellTargetDepthCollector);
  this.buyTarget.tree.partialTreeTraversal(buyTargetDepthCollector);
  this.sellStop.tree.partialTreeTraversal(sellStopDepthCollector);
  this.buyStop.tree.partialTreeTraversal(buyStopDepthCollector);
  var self      = this
  var allOrders = {}
  Object.keys(self.allOrders).forEach(orderid => allOrders[orderid] = Order.clone(self.allOrders[orderid]))
  var targets = {}
  Object.keys(self.targets).forEach(orderid => targets[orderid] = Order.clone(self.targets[orderid]))
  return {
    bid          : this.getBid(),
    ask          : this.getAsk(),
    buy          : buyDepthCollector.collection.map(extractOrderFromDepth),
    sell         : sellDepthCollector.collection.map(extractOrderFromDepth),
    buyTarget    : buyTargetDepthCollector.collection.map(extractOrderFromDepth),
    sellTarget   : sellTargetDepthCollector.collection.map(extractOrderFromDepth),
    buyStop      : buyStopDepthCollector.collection.map(extractOrderFromDepth),
    sellStop     : sellStopDepthCollector.collection.map(extractOrderFromDepth),
    buyMarket    : extractOrderFromDepth(this.buyMarket),
    sellMarket   : extractOrderFromDepth(this.sellMarket),
    buyTriggered : extractOrderFromDepth(this.buyTriggered),
    sellTriggered: extractOrderFromDepth(this.sellTriggered),
    orders       : allOrders,
    targets      : targets
  };
}

function extractOrderFromDepth(limit) {
  var orders = []
  limit.orders.forEach(function (order) {
    orders.push(Order.clone(order))
  })
  return { price: limit.price, numberOfOrders: limit.numberOfOrders, totalQuantity: limit.totalQuantity, orders: orders }
}

/*
 OrderBook.prototype.flatten = function () {
 var depth  = this.getOrderBookByDepth(Object.keys(this.allOrders).length)
 var orders = []

 depth.buy.forEach(function (limit) {
 for (var q = limit.orders.head; q; q = q.next) {
 orders.push(q.data);
 }
 })
 depth.sell.forEach(function (limit) {
 for (var q = limit.orders.tail; q; q = q.prev) {
 orders.push(q.data);
 }
 })
 return orders;
 }
 */

OrderBook.prototype.getMarketLimitForMatching = function (side) {
  return this.getBookType(side, "Triggered").totalQuantity > 0 ? this.getBookType(side, "Triggered") : this.getBookType(side, "Market")
}

OrderBook.prototype.isMarketMatchable = function () {
  var bidAsk     = this.getBidAsk()
  var buyMarket  = this.getMarketLimitForMatching('buy')
  var sellMarket = this.getMarketLimitForMatching('sell')
  return isLimitOrdersMatchable() ||
         // isMarketOrdersMatchable(buyMarket, sellMarket, this.lastPrice) ||
         isLimitToMarketMatchable(buyMarket, sellMarket) ||
         this.isTerminateMatchable()

  function isLimitOrdersMatchable() {
    return typeof bidAsk.bid === 'number' && typeof bidAsk.ask === 'number' && bidAsk.bid >= bidAsk.ask
  }

  function isLimitToMarketMatchable(buyMarket, sellMarket) {
    return buyMarket.totalQuantity > 0 && bidAsk.ask ||
           sellMarket.totalQuantity > 0 && bidAsk.bid
  }

  function isMarketOrdersMatchable(buyMarket, sellMarket, lastPrice) {
    return buyMarket.totalQuantity > 0 && sellMarket.totalQuantity > 0 && lastPrice
  }
}

OrderBook.prototype.isTerminateMatchable = function () {
  return this.buyTriggered.totalQuantity > 0 && this.sellTarget.tree.height > 0 ||
         this.sellTriggered.totalQuantity > 0 && this.buyTarget.tree.height > 0
}

OrderBook.prototype.matchOrders = function (band) {
  // if (flag.getFlag("readonly")) return
  if (this.isMarketMatchable()) {
    var result         = this.getBuySellForMatch(band)
    var executionPrice = result.price
    var buy            = Order.clone(result.buy)
    var sell           = Order.clone(result.sell)
    var matched        = Math.min(buy.toBeFilled, sell.toBeFilled)

    if (result.buyTerm) buy.terminate(matched)
    if (result.sellTerm) sell.terminate(matched)

    var execution  = new Execution(buy, sell, matched, executionPrice, this.symbol);
    execution.band = { max: band.max, min: band.min, price: band.price }
    util.log('Matching buy', buy.uuid, 'and sell', sell.uuid)
    updateMatchedOrder(buy, matched, execution)
    updateMatchedOrder(sell, matched, execution)
    return { execution: execution, buy: buy, sell: sell }
  }
}

OrderBook.prototype.getBuySellForMatch = function (band) {
  var bidAsk          = this.getBidAsk()
  var buyMarket       = this.getMarketLimitForMatching('buy')
  var sellMarket      = this.getMarketLimitForMatching('sell')
  var isBuyMarket     = buyMarket.totalQuantity > 0 && (this.lastPrice || bidAsk.ask)
  var isSellMarket    = sellMarket.totalQuantity > 0 && (this.lastPrice || bidAsk.bid)
  var buyLimit        = isBuyMarket ? buyMarket : this.buy.search(bidAsk.bid)[0];
  var sellLimit       = !isBuyMarket && isSellMarket ? sellMarket : this.sell.search(bidAsk.ask)[0];
  var buyOrder        = buyLimit ? buyLimit.orders.head.data : this.findFirstTarget(Order.BUY)
  var sellOrder       = sellLimit ? sellLimit.orders.head.data : this.findFirstTarget(Order.SELL);
  var price           = this.computeExecutionPrice(buyOrder, sellOrder)
  var buySellForMatch = this.updateForTermination({ buy: buyOrder, sell: sellOrder, price: price }, band)
  buySellForMatch     = this.limitStopsToBand(buySellForMatch, band)
  return buySellForMatch
}

OrderBook.prototype.limitStopsToBand = function (buySellForMatch, band) {
  affirm(band && band.min && band.max, 'Band is not defined')
  var buyOrder  = buySellForMatch.buy
  var sellOrder = buySellForMatch.sell
  var price     = buySellForMatch.price
  affirm(buyOrder instanceof Order, 'Invalid buy order')
  affirm(sellOrder instanceof Order, 'Invalid sell order')
  affirm(price > 0, 'Invalid price')
  var isBothExitOrders = buyOrder.isExitOrder() && sellOrder.isExitOrder()
  if (!isBothExitOrders) return buySellForMatch
  if (buyOrder.orderType !== Order.STP && sellOrder.orderType !== Order.STP) return buySellForMatch
  if (price > band.min && price < band.max) return buySellForMatch
  /*
   Exchange will maintain following scenario at all cost
   long.maxStop <= exePrice <= short.maxStop
   */
  var shortMaxStop = this.getMaxStopPrice(buyOrder)
  var longMaxStop  = this.getMaxStopPrice(sellOrder)
  if (price >= band.max) buySellForMatch.price = Math.max(band.max, longMaxStop)
  if (price <= band.min) buySellForMatch.price = Math.min(band.min, shortMaxStop)
  return buySellForMatch
}

OrderBook.prototype.getMaxStopPrice = function (order) {
  affirm(order instanceof Order, 'Invalid order')
  affirm(order.orderType === Order.STP || order.orderType === Order.TGT, 'Order type must be TGT or STP')
  if (order.orderType === Order.STP) return order.maxStop
  if (order.orderType === Order.TGT) {
    var stp = this.getOrder(order.oco)
    affirm(stp, "STP " + order.oco + " not found for " + order.uuid)
    return stp.maxStop
  }
}

OrderBook.prototype.updateForTermination = function (buySellForMatch, band) {
  affirm(band && band.min && band.max, 'Band is not defined')
  var buyOrder  = buySellForMatch.buy
  var sellOrder = buySellForMatch.sell
  var price     = buySellForMatch.price
  var buyTerm   = false
  var sellTerm  = false
  affirm(buyOrder instanceof Order, 'Invalid buy order')
  affirm(sellOrder instanceof Order, 'Invalid sell order')
  affirm(price > 0 || price === 'NONE', 'Invalid price')
  if (buyOrder.terminates(price, band)) {
    sellOrder = this.findFirstTarget(Order.SELL)
    sellTerm  = true
    price     = Math.min(buyOrder.maxStop, band.max)
  } else if (sellOrder.terminates(price, band)) {
    buyOrder = this.findFirstTarget(Order.BUY)
    buyTerm  = true
    price    = Math.max(sellOrder.maxStop, band.min)
  }
  return { buy: buyOrder, sell: sellOrder, price: price, buyTerm: buyTerm, sellTerm: sellTerm }
}

OrderBook.prototype.findFirstTarget = function (side) {
  affirm(side && (side === 'buy' || side === 'sell'), 'Invalid order side' + side)
  var book = this.getBookType(side, "Target")
  return book.search(book.tree.getMinKey())[0].orders.head.data
}

function updateMatchedOrder(order, matched, execution) {
  var executionPrice = execution.executionPrice
  var amount         = sinful.mul(order.filled, order.averagePrice)
  var matchedAmount  = sinful.mul(matched, executionPrice)

  order.match(matched)
  order.eventTime    = execution.eventTime
  order.averagePrice = sinful.div(sinful.add(amount, matchedAmount), order.filled);
}

OrderBook.prototype.getBookType = function (side, type) {
  type = type || ""
  return this[side + type]
}

exports.OrderBook = OrderBook;
exports.Order     = Order;
exports.Limit     = Limit;
