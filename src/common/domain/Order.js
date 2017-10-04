
function Order(uuid, price, qty, cancelled, isBuy, user, expiry) {
  this.uuid = uuid;
  this.price = price;
  this.qty = qty;
  this.cancelled = cancelled;
  this.isBuy = isBuy;
  this.user = user;
  this.expiry = expiry;
  this.types = ['uint', 'uint', 'uint', 'uint', 'uint', 'bool', 'address'];
}

Order.prototype.getOrderParams = function () {
  return [this.uuid, this.price, this.qty, this.cancelled, this.expiry, this.isBuy, this.user]
};

module.exports = Order;

