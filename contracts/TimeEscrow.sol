// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TimeEscrow
/// @notice Escrows TimeToken (TTK) between a requester and provider until both confirm completion.
contract TimeEscrow is ReentrancyGuard {
    struct Escrow {
        address requester;
        address provider;
        uint256 amount; // TTK amount representing hours
        bool requesterConfirmed;
        bool providerConfirmed;
        bool active;
    }

    IERC20 public immutable timeToken;
    uint256 public nextEscrowId;
    mapping(uint256 => Escrow) public escrows;

    event EscrowCreated(uint256 indexed escrowId, address indexed requester, address indexed provider, uint256 amount);
    event EscrowCancelled(uint256 indexed escrowId);
    event Confirmed(uint256 indexed escrowId, address indexed user);
    event Released(uint256 indexed escrowId, address indexed provider, uint256 amount);

    constructor(IERC20 _timeToken) {
        timeToken = _timeToken;
        nextEscrowId = 1;
    }

    /// @notice Create an escrow. Requester must approve `amount` to this contract before calling.
    function createEscrow(address provider, uint256 amount) external nonReentrant returns (uint256 escrowId) {
        require(provider != address(0) && provider != msg.sender, "Invalid provider");
        require(amount > 0, "Amount must be > 0");

        // Pull tokens from requester into escrow contract
        require(timeToken.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        escrowId = nextEscrowId++;
        escrows[escrowId] = Escrow({
            requester: msg.sender,
            provider: provider,
            amount: amount,
            requesterConfirmed: false,
            providerConfirmed: false,
            active: true
        });

        emit EscrowCreated(escrowId, msg.sender, provider, amount);
    }

    /// @notice Either party confirms completion. When both confirm, funds release to provider.
    function confirm(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        require(e.active, "Escrow inactive");
        require(msg.sender == e.requester || msg.sender == e.provider, "Not a party");

        if (msg.sender == e.requester) {
            e.requesterConfirmed = true;
        } else {
            e.providerConfirmed = true;
        }

        emit Confirmed(escrowId, msg.sender);

        if (e.requesterConfirmed && e.providerConfirmed) {
            _release(escrowId);
        }
    }

    /// @notice Requester can cancel before provider confirms; tokens return to requester.
    function cancel(uint256 escrowId) external nonReentrant {
        Escrow storage e = escrows[escrowId];
        require(e.active, "Escrow inactive");
        require(msg.sender == e.requester, "Only requester");
        require(!e.providerConfirmed, "Provider confirmed");

        e.active = false;
        require(timeToken.transfer(e.requester, e.amount), "Refund failed");
        emit EscrowCancelled(escrowId);
    }

    function _release(uint256 escrowId) internal {
        Escrow storage e = escrows[escrowId];
        e.active = false;
        require(timeToken.transfer(e.provider, e.amount), "Payout failed");
        emit Released(escrowId, e.provider, e.amount);
    }

    /// @notice Get escrow details (view function for frontend)
    function getEscrow(uint256 escrowId) external view returns (
        address requester,
        address provider,
        uint256 amount,
        bool requesterConfirmed,
        bool providerConfirmed,
        bool active
    ) {
        Escrow storage e = escrows[escrowId];
        return (e.requester, e.provider, e.amount, e.requesterConfirmed, e.providerConfirmed, e.active);
    }
}


