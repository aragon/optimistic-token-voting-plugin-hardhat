// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.8;

import {IVotesUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/utils/IVotesUpgradeable.sol";

/// @title IOptimisticTokenVoting
/// @author Aragon Association - 2022-2023
/// @notice The interface of an optimistic governance plugin.
interface IOptimisticTokenVoting {
    /// @notice getter function for the voting token.
    /// @dev public function also useful for registering interfaceId and for distinguishing from majority voting interface.
    /// @return The token used for voting.
    function getVotingToken() external view returns (IVotesUpgradeable);

    /// @notice Returns the veto ratio parameter stored in the optimistic governance settings.
    /// @return The veto ratio parameter.
    function minVetoRatio() external view returns (uint32);

    /// @notice Checks if the total votes against a proposal is greater than the veto threshold.
    /// @param _proposalId The ID of the proposal.
    /// @return Returns `true` if the total veto power against the proposal is greater or equal than the threshold and `false` otherwise.
    function isMinVetoRatioReached(uint256 _proposalId) external view returns (bool);

    /// @notice Checks if an account can participate on an optimistic proposal. This can be because the proposal
    /// - has not started,
    /// - has ended,
    /// - was executed, or
    /// - the voter doesn't have voting power.
    /// @param _proposalId The proposal Id.
    /// @param _account The account address to be checked.
    /// @return Returns true if the account is allowed to veto.
    /// @dev The function assumes that the queried proposal exists.
    function canVeto(uint256 _proposalId, address _account) external view returns (bool);

    /// @notice Checks if a proposal can be executed.
    /// @param _proposalId The ID of the proposal to be checked.
    /// @return True if the proposal can be executed, false otherwise.
    function canExecute(uint256 _proposalId) external view returns (bool);

    /// @notice Registers the veto for the given proposal.
    /// @param _proposalId The ID of the proposal.
    function veto(uint256 _proposalId) external;

    /// @notice Executes a proposal.
    /// @param _proposalId The ID of the proposal to be executed.
    function execute(uint256 _proposalId) external;

    /// @notice Returns whether the account has voted for the proposal.  Note, that this does not check if the account has vetoing power.
    /// @param _proposalId The ID of the proposal.
    /// @param _account The account address to be checked.
    /// @return The whether the given account has vetoed the given proposal.
    function hasVetoed(uint256 _proposalId, address _account) external view returns (bool);
}
