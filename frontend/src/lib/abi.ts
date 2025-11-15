export const erc20Abi = [
  { "type": "function", "name": "balanceOf", "stateMutability": "view", "inputs": [{"name":"account","type":"address"}], "outputs": [{"name":"","type":"uint256"}] },
  { "type": "function", "name": "decimals", "stateMutability": "view", "inputs": [], "outputs": [{"name":"","type":"uint8"}] },
  { "type": "function", "name": "symbol", "stateMutability": "view", "inputs": [], "outputs": [{"name":"","type":"string"}] },
  { "type": "function", "name": "approve", "stateMutability": "nonpayable", "inputs": [{"name":"spender","type":"address"},{"name":"amount","type":"uint256"}], "outputs": [{"name":"","type":"bool"}] },
  { "type": "function", "name": "allowance", "stateMutability": "view", "inputs": [{"name":"owner","type":"address"},{"name":"spender","type":"address"}], "outputs": [{"name":"","type":"uint256"}] }
] as const

export const timeEscrowAbi = [
  { "type": "function", "name": "createEscrow", "stateMutability": "nonpayable", "inputs": [
      {"name":"provider","type":"address"},
      {"name":"amount","type":"uint256"}
    ], "outputs": [{"name":"escrowId","type":"uint256"}] },
  { "type": "function", "name": "confirm", "stateMutability": "nonpayable", "inputs": [{"name":"escrowId","type":"uint256"}], "outputs": [] },
  { "type": "function", "name": "cancel", "stateMutability": "nonpayable", "inputs": [{"name":"escrowId","type":"uint256"}], "outputs": [] },
  { "type": "function", "name": "getEscrow", "stateMutability": "view", "inputs": [{"name":"escrowId","type":"uint256"}], "outputs": [
      {"name":"requester","type":"address"},
      {"name":"provider","type":"address"},
      {"name":"amount","type":"uint256"},
      {"name":"requesterConfirmed","type":"bool"},
      {"name":"providerConfirmed","type":"bool"},
      {"name":"active","type":"bool"}
    ] },
  { "type": "function", "name": "escrows", "stateMutability": "view", "inputs": [{"name":"","type":"uint256"}], "outputs": [
      {"name":"requester","type":"address"},
      {"name":"provider","type":"address"},
      {"name":"amount","type":"uint256"},
      {"name":"requesterConfirmed","type":"bool"},
      {"name":"providerConfirmed","type":"bool"},
      {"name":"active","type":"bool"}
    ] },
  { "type": "event", "name": "EscrowCreated", "inputs": [
      {"name":"escrowId","type":"uint256","indexed":true},
      {"name":"requester","type":"address","indexed":true},
      {"name":"provider","type":"address","indexed":true},
      {"name":"amount","type":"uint256","indexed":false}
    ], "anonymous": false },
  { "type": "event", "name": "EscrowCancelled", "inputs": [
      {"name":"escrowId","type":"uint256","indexed":true}
    ], "anonymous": false },
  { "type": "event", "name": "Confirmed", "inputs": [
      {"name":"escrowId","type":"uint256","indexed":true},
      {"name":"user","type":"address","indexed":true}
    ], "anonymous": false },
  { "type": "event", "name": "Released", "inputs": [
      {"name":"escrowId","type":"uint256","indexed":true},
      {"name":"provider","type":"address","indexed":true},
      {"name":"amount","type":"uint256","indexed":false}
    ], "anonymous": false }
] as const


