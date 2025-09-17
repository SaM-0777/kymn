// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract YapRewards {
    struct YapRequest {
        uint256 amount; // Total amount deposited for this request
        bool isActive; // Status of the request
        address creator; // Who created this request
    }

    uint256 public nextRequestId; // Auto-incrementing request ID
    mapping(uint256 => YapRequest) public yapRequests;

    /// @notice Create a new Yap request by sending ETH along with the call
    function createYapRequest() external payable returns (uint256) {
        require(msg.value > 0, "Must send some ETH");

        uint256 requestId = nextRequestId++;
        yapRequests[requestId] = YapRequest({
            amount: msg.value,
            isActive: true,
            creator: msg.sender
        });

        return requestId;
    }

    /// @notice Reward winners and deactivate the request
    /// @param requestId The ID of the Yap request
    /// @param winners Array of winner addresses
    /// @param amounts Array of corresponding amounts for winners
    function rewardWinners(
        uint256 requestId,
        address payable[] calldata winners,
        uint256[] calldata amounts
    ) external {
        YapRequest storage req = yapRequests[requestId];
        require(req.isActive, "Request not active");
        require(winners.length == amounts.length, "Array length mismatch");

        uint256 totalToSend;
        for (uint256 i = 0; i < amounts.length; i++) {
            totalToSend += amounts[i];
        }
        require(totalToSend <= req.amount, "Insufficient balance");

        // Distribute rewards
        for (uint256 i = 0; i < winners.length; i++) {
            (bool sent, ) = winners[i].call{value: amounts[i]}("");
            require(sent, "Transfer failed");
        }

        req.isActive = false;
    }

    /// @notice Get details about a specific Yap request
    /// @param requestId The ID of the Yap request
    /// @return amount Total ETH stored for this request
    /// @return creator Address that created the request
    /// @return isActive Whether the request is still active
    function getYapRequest(
        uint256 requestId
    ) external view returns (uint256 amount, address creator, bool isActive) {
        YapRequest memory req = yapRequests[requestId];
        return (req.amount, req.creator, req.isActive);
    }

    /// @notice Get contract balance
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
