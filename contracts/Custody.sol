pragma solidity ^0.4.11;


import "tokens/HumanStandardToken.sol";
import "./SafeMath.sol";


contract Custody {

    struct Order {
    uint uuid;
    uint price;
    uint qty;
    uint cancelled;
    uint expiry;
    bool isBuy;
    address user;
    }

    struct Execution {
    uint executionid;
    uint price;
    uint qty;
    }

    struct LastExecution {
    bytes32 hash;
    uint time;
    }

    event LOG(address _user, address calaculated, bytes32 _hash);

    event CustodyEvent(address _user, uint256 _value, string _unit, string _action);

    event ExecutionSync(uint _order1, uint _order2, uint _execution, bytes32 _hash);

    mapping (address => uint256) public ethers;

    mapping (address => uint256) public tokens;

    mapping (address => uint) public lastStateSyncBlocks;

    mapping (uint => uint) public filled;

    mapping (address => LastExecution) public lastExecutions;

    address public tokenid;

    address public owner;

    uint freezeBlock;

    uint withdrawBlocks;

    HumanStandardToken public token;

    uint256 public tokenCount;

    bool public disabled;
    modifier onlyOwner {
        require(msg.sender == owner);
        _;
    }

    modifier notDisabled{
        require(!disabled);
        _;
    }
    modifier isDisabled{
        require(disabled);
        _;
    }

    modifier notFrozen {
        require(block.number < freezeBlock);
        _;
    }

    function Custody(address _owner, uint _freezeBlock, uint _withdrawBlocks){
        owner = _owner;
        freezeBlock = _freezeBlock;
        withdrawBlocks = _withdrawBlocks;
    }

    function setToken(address _token) onlyOwner notFrozen {
        tokenid = _token;
        token = HumanStandardToken(_token);
    }

    /*user can deposit ether*/
    function() payable {
        ethers[msg.sender] = SafeMath.add(ethers[msg.sender], msg.value);
    }

    /*user can deposit token. user will need to use token.allow(custody, _value) before calling this method.*/
    function depositToken(uint256 _value) returns (bool result){
        tokenCount = SafeMath.add(tokenCount, _value);
        tokens[msg.sender] = SafeMath.add(tokens[msg.sender], _value);
        return token.transferFrom(msg.sender, this, _value);
    }

    /* still trying for delegatecall. otferwise depositToken will be used*/
    function delegateTokens(uint256 _value) returns (bool result){
        tokenCount += _value;
        tokens[msg.sender] += _value;
        //        LOG(token, _value);
        return token.delegatecall(bytes4(sha3("transfer(address,uint256)")), address(this), _value);
    }

    function syncExecutions(uint[] orderUINT, bool[] isBuy, address[] users, uint8[] v, bytes32[] r, bytes32[] s) onlyOwner notDisabled {
        Order memory order1 = Order(orderUINT[0], orderUINT[1], orderUINT[2], orderUINT[3], orderUINT[4], isBuy[0], users[0]);
        Order memory order2 = Order(orderUINT[5], orderUINT[6], orderUINT[7], orderUINT[8], orderUINT[9], isBuy[1], users[1]);
        Execution memory execution = Execution(orderUINT[10], orderUINT[11], orderUINT[12]);
        require(isVerified(order1, users[0], v[0], r[0], s[0]));
        require(isVerified(order2, users[1], v[1], r[1], s[1]));
        updateOrderQuantities(order1, order2, execution);
        validateOrderAndExecution(order1, execution);
        validateOrderAndExecution(order2, execution);
        lastStateSyncBlocks[order1.user] = block.number;
        lastStateSyncBlocks[order2.user] = block.number;
        processExecution(order1, order2, execution);
    }

    //nonce needs to be added to prevent replay attack
    function withdraw(address _user, uint256 _eth, uint256 _tokens) onlyOwner notDisabled {
        require(SafeMath.add(lastStateSyncBlocks[_user], withdrawBlocks) <= block.number);
        send(_user, _eth, _tokens);
    }

    function notifyReplay(uint[] orderUINT, bool isBuy, address user, uint8 v, bytes32 r, bytes32 s){
        Order memory order = Order(orderUINT[0], orderUINT[1], orderUINT[2], orderUINT[3], orderUINT[4], isBuy, user);
        require(isVerified(order, owner, v, r, s));
        require(SafeMath.sub(order.qty, order.cancelled) < filled[order.uuid]);
        disabled = true;
    }

    function recoverFunds() isDisabled {
        send(msg.sender, ethers[msg.sender], tokens[msg.sender]);
    }

    function send(address _user, uint256 _eth, uint256 _tokens) internal {
        require(ethers[_user] >= _eth);
        require(tokens[_user] >= _tokens);
        ethers[_user] = SafeMath.sub(ethers[_user], _eth);
        tokens[_user] = SafeMath.sub(tokens[_user], _tokens);
        _user.transfer(_eth);
        token.transfer(_user, _tokens);
    }

    function processExecution(Order order1, Order order2, Execution execution) internal {
        address buyer = order1.isBuy ? order1.user : order2.user;
        address seller = order1.isBuy ? order2.user : order1.user;
        uint256 amount = SafeMath.mul(execution.price, execution.qty);
        tokens[buyer] = SafeMath.add(tokens[buyer], execution.qty);
        tokens[seller] = SafeMath.sub(tokens[seller], execution.qty);
        ethers[buyer] = SafeMath.sub(ethers[buyer], amount);
        ethers[seller] = SafeMath.add(ethers[seller], amount);
    }

    function validateOrderAndExecution(Order order, Execution execution) internal {
        if (order.isBuy) {
            require(order.price >= execution.price);
        }
        else {
            require(order.price <= execution.price);
        }
        require(order.qty >= execution.qty);
    }

    function isVerified(Order order, address user, uint8 v, bytes32 r, bytes32 s) internal returns (bool result){
        bytes32 hash = keccak256(order.uuid, order.price, order.qty, order.cancelled, order.expiry, order.isBuy, order.user);
        return user == ecrecover(keccak256("\x19Ethereum Signed Message:\n32", hash), v, r, s);
    }

    function updateOrderQuantities(Order order1, Order order2, Execution execution) internal {
        require(SafeMath.sub(order1.qty, filled[order1.uuid]) >= execution.qty);
        require(SafeMath.sub(order2.qty, filled[order2.uuid]) >= execution.qty);
        filled[order1.uuid] = SafeMath.add(filled[order1.uuid], execution.qty);
        filled[order2.uuid] = SafeMath.add(filled[order2.uuid], execution.qty);
    }

    //time has to be added to execution.
    function getExecutionHash(Execution execution, Order order1, Order order2) internal returns (bytes32 _hash){
        return keccak256(order1.uuid, order1.price, order1.qty, order1.cancelled, order1.expiry, order1.isBuy, order1.user,
        order2.uuid, order2.price, order2.qty, order2.cancelled, order2.expiry, order2.isBuy, order2.user,
        execution.executionid, execution.price, execution.qty);
    }
}
