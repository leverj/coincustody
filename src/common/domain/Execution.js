function Execution(uuid, price, qty) {
  this.uuid = uuid;
  this.price = price;
  this.qty = qty;
  this.types = ['uint', 'uint', 'uint']
}

module.exports = Execution;