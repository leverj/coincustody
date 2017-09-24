pragma solidity ^0.4.11;


/**
* people can put money
* signed request is received
    U and E have signed


*/

import "tokens/HumanStandardToken.sol";
import "tokens/StandardToken.sol";


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


    event LOG(address _user, address calaculated, bytes32 _hash);

    event CustodyEvent(address _user, uint256 _value, string _unit, string _action);

    mapping (address => uint256) public ethers;

    mapping (address => uint256) public tokens;

    mapping (uint => uint) public filled;

    address public tokenid;

    address public owner;

    uint freezeBlock;

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

    function Custody(address _owner, uint _freezeBlock){
        owner = _owner;
        freezeBlock = _freezeBlock;
    }

    function setToken(address _token) onlyOwner notFrozen {
        tokenid = _token;
        token = HumanStandardToken(_token);
    }

    /*user can deposit ether*/
    function() payable {
        ethers[msg.sender] += msg.value;
    }

    /*user can deposit token. user will need to use token.allow(custody, _value) before calling this method.*/
    function depositToken(uint256 _value) returns (bool result){
        tokenCount += _value;
        tokens[msg.sender] += _value;
        return token.transferFrom(msg.sender, this, _value);
        //        LOG(token, _value);
        //        return token.delegatecall(bytes4(sha3("transfer(address,uint256)")), address(this), _value);
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
    }

    //nonce needs to be added to prevent replay attack
    function withdraw(address _user, uint256 _eth, uint256 _tokens) onlyOwner notDisabled {
        send(_user, _eth, _tokens);
    }

    function notifyReplay(uint[] orderUINT, bool isBuy, address user, uint8 v, bytes32 r, bytes32 s){
        Order memory order = Order(orderUINT[0], orderUINT[1], orderUINT[2], orderUINT[3], orderUINT[4], isBuy, user);
        require(isVerified(order, owner, v,r,s));
        require(order.qty - order.cancelled < filled[order.uuid]);
        disabled = true;
    }

    function recoverFunds() isDisabled {
        send(msg.sender, ethers[msg.sender], tokens[msg.sender]);
    }

    function send(address _user, uint256 _eth, uint256 _tokens) internal {
        require(ethers[_user] >= _eth);
        require(tokens[_user] >= _tokens);
        ethers[_user] -= _eth;
        tokens[_user] -= _tokens;
        _user.transfer(_eth);
        token.transfer(_user, _tokens);
    }

    function processExecution(address buyer, address seller, Execution execution) internal {
        uint256 amount = execution.price * execution.qty;
        tokens[buyer] += execution.qty;
        tokens[seller] -= execution.qty;
        ethers[buyer] -= amount;
        ethers[seller] += amount;
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
        require(order1.qty - filled[order1.uuid] >= execution.qty);
        require(order2.qty - filled[order2.uuid] >= execution.qty);
        filled[order1.uuid] += execution.qty;
        filled[order2.uuid] += execution.qty;
    }

}
