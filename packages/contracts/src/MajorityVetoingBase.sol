// SPDX-License-Identifier: AGPL-3.0-or-later

pragma solidity ^0.8.8;

import {ERC165Upgradeable} from "@openzeppelin/contracts-upgradeable/utils/introspection/ERC165Upgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {SafeCastUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/math/SafeCastUpgradeable.sol";

import {IProposal} from "@aragon/osx/core/plugin/proposal/IProposal.sol";
import {ProposalUpgradeable} from "@aragon/osx/core/plugin/proposal/ProposalUpgradeable.sol";
import {PluginUUPSUpgradeable} from "@aragon/osx/core/plugin/PluginUUPSUpgradeable.sol";
import {RATIO_BASE, _applyRatioCeiled} from "@aragon/osx/plugins/utils/Ratio.sol";
import {IDAO} from "@aragon/osx/core/dao/IDAO.sol";
import {RATIO_BASE, RatioOutOfBounds} from "@aragon/osx/plugins/utils/Ratio.sol";
import {IOptimisticMajority} from "./IOptimisticMajority.sol";

/// @title OptimisticMajorityBase
/// @author Aragon Association - 2022-2023
/// @notice The abstract implementation of optimistic majority plugins.
///
/// @dev This contract implements the `IOptimisticMajority` interface.
abstract contract OptimisticMajorityBase is
    IOptimisticMajority,
    Initializable,
    ERC165Upgradeable,
    PluginUUPSUpgradeable,
    ProposalUpgradeable
{
    using SafeCastUpgradeable for uint256;

    /// @notice A container for the optimistic majority settings that will be applied as parameters on proposal creation.
    /// @param minVetoRatio The support threshold value. Its value has to be in the interval [0, 10^6] defined by `RATIO_BASE = 10**6`.
    /// @param minParticipation The minimum participation value. Its value has to be in the interval [0, 10^6] defined by `RATIO_BASE = 10**6`.
    /// @param minDuration The minimum duration of the proposal vote in seconds.
    /// @param minProposerVotingPower The minimum vetoing power required to create a proposal.
    struct OptimisticGovernanceSettings {
        uint32 minVetoRatio;
        uint32 minParticipation;
        uint64 minDuration;
        uint256 minProposerVotingPower;
    }

    /// @notice A container for proposal-related information.
    /// @param executed Whether the proposal is executed or not.
    /// @param parameters The proposal parameters at the time of the proposal creation.
    /// @param vetoTally The amount of voting power used to veto the proposal.
    /// @param voters The voters who have vetoed.
    /// @param actions The actions to be executed when the proposal passes.
    /// @param allowFailureMap A bitmap allowing the proposal to succeed, even if individual actions might revert. If the bit at index `i` is 1, the proposal succeeds even if the `i`th action reverts. A failure map value of 0 requires every action to not revert.
    struct Proposal {
        bool executed;
        ProposalParameters parameters;
        uint256 vetoTally;
        mapping(address => bool) voters;
        IDAO.Action[] actions;
        uint256 allowFailureMap;
    }

    /// @notice A container for the proposal parameters at the time of proposal creation.
    /// @param minVetoRatio The minimum ratio of the voting power needed to defeat the proposal. The value has to be within the interval [0, 10^6] defined by `RATIO_BASE = 10**6`.
    /// @param startDate The start date of the proposal vote.
    /// @param endDate The end date of the proposal vote.
    /// @param snapshotBlock The number of the block prior to the proposal creation.
    /// @param minVotingPower The minimum voting power needed to create proposals.
    struct ProposalParameters {
        uint32 minVetoRatio;
        uint64 startDate;
        uint64 endDate;
        uint64 snapshotBlock;
        uint256 minVotingPower;
    }

    /// @notice The [ERC-165](https://eips.ethereum.org/EIPS/eip-165) interface ID of the contract.
    bytes4 internal constant MAJORITY_VETOING_BASE_INTERFACE_ID =
        this.minDuration.selector ^
            this.minProposerVotingPower.selector ^
            this.totalVotingPower.selector ^
            this.getProposal.selector ^
            this.updateOptimisticGovernanceSettings.selector ^
            this.createProposal.selector;

    /// @notice The ID of the permission required to call the `updateOptimisticGovernanceSettings` function.
    bytes32 public constant UPDATE_OPTIMISTIC_GOVERNANCE_SETTINGS_PERMISSION_ID =
        keccak256("UPDATE_OPTIMISTIC_GOVERNANCE_SETTINGS_PERMISSION");

    /// @notice A mapping between proposal IDs and proposal information.
    mapping(uint256 => Proposal) internal proposals;

    /// @notice The struct storing the vetoing settings.
    OptimisticGovernanceSettings private governanceSettings;

    /// @notice Thrown if a date is out of bounds.
    /// @param limit The limit value.
    /// @param actual The actual value.
    error DateOutOfBounds(uint64 limit, uint64 actual);

    /// @notice Thrown if the minimal duration value is out of bounds (less than one hour or greater than 1 year).
    /// @param limit The limit value.
    /// @param actual The actual value.
    error MinDurationOutOfBounds(uint64 limit, uint64 actual);

    /// @notice Thrown when a sender is not allowed to create a proposal.
    /// @param sender The sender address.
    error ProposalCreationForbidden(address sender);

    /// @notice Thrown if an account is not allowed to cast a veto. This can be because the challenge period
    /// - has not started,
    /// - has ended,
    /// - was executed, or
    /// - the account doesn't have vetoing powers.
    /// @param proposalId The ID of the proposal.
    /// @param account The address of the _account.
    error ProposalVetoingForbidden(uint256 proposalId, address account);

    /// @notice Thrown if the proposal execution is forbidden.
    /// @param proposalId The ID of the proposal.
    error ProposalExecutionForbidden(uint256 proposalId);

    /// @notice Emitted when the vetoing settings are updated.
    /// @param minVetoRatio The support threshold value.
    /// @param minParticipation The minimum participation value.
    /// @param minDuration The minimum duration of the proposal vote in seconds.
    /// @param minProposerVotingPower The minimum vetoing power required to create a proposal.
    event OptimisticGovernanceSettingsUpdated(
        uint32 minVetoRatio,
        uint32 minParticipation,
        uint64 minDuration,
        uint256 minProposerVotingPower
    );

    /// @notice Initializes the component to be used by inheriting contracts.
    /// @dev This method is required to support [ERC-1822](https://eips.ethereum.org/EIPS/eip-1822).
    /// @param _dao The IDAO interface of the associated DAO.
    /// @param _governanceSettings The vetoing settings.
    function _IOptimisticMajorityBase_init(
        IDAO _dao,
        OptimisticGovernanceSettings calldata _governanceSettings
    ) internal onlyInitializing {
        __PluginUUPSUpgradeable_init(_dao);
        _updateOptimisticGovernanceSettings(_governanceSettings);
    }

    /// @notice Checks if this or the parent contract supports an interface by its ID.
    /// @param _interfaceId The ID of the interface.
    /// @return Returns `true` if the interface is supported.
    function supportsInterface(
        bytes4 _interfaceId
    )
        public
        view
        virtual
        override(ERC165Upgradeable, PluginUUPSUpgradeable, ProposalUpgradeable)
        returns (bool)
    {
        return
            _interfaceId == MAJORITY_VETOING_BASE_INTERFACE_ID ||
            _interfaceId == type(IOptimisticMajority).interfaceId ||
            super.supportsInterface(_interfaceId);
    }

    /// @inheritdoc IOptimisticMajority
    function veto(uint256 _proposalId) public virtual {
        address account = _msgSender();

        if (!_canVeto(_proposalId, account)) {
            revert ProposalVetoingForbidden({proposalId: _proposalId, account: account});
        }
        _veto(_proposalId, account);
    }

    /// @inheritdoc IOptimisticMajority
    function execute(uint256 _proposalId) public virtual {
        if (!_canExecute(_proposalId)) {
            revert ProposalExecutionForbidden(_proposalId);
        }
        _execute(_proposalId);
    }

    /// @inheritdoc IOptimisticMajority
    function hasVetoed(uint256 _proposalId, address _voter) public view virtual returns (bool) {
        return proposals[_proposalId].voters[_voter];
    }

    /// @inheritdoc IOptimisticMajority
    function canVeto(uint256 _proposalId, address _voter) public view virtual returns (bool) {
        return _canVeto(_proposalId, _voter);
    }

    /// @inheritdoc IOptimisticMajority
    function canExecute(uint256 _proposalId) public view virtual returns (bool) {
        return _canExecute(_proposalId);
    }

    /// @inheritdoc IOptimisticMajority
    function isMinVetoRatioReached(uint256 _proposalId) public view virtual returns (bool) {
        Proposal storage proposal_ = proposals[_proposalId];
        uint256 _minVetoPower = _applyRatioCeiled(
            totalVotingPower(proposal_.parameters.snapshotBlock),
            proposal_.parameters.minVetoRatio
        );

        return proposal_.vetoTally >= _minVetoPower;
    }

    /// @inheritdoc IOptimisticMajority
    function minVetoRatio() public view virtual returns (uint32) {
        return governanceSettings.minVetoRatio;
    }

    /// @notice Returns the minimum duration parameter stored in the vetoing settings.
    /// @return The minimum duration parameter.
    function minDuration() public view virtual returns (uint64) {
        return governanceSettings.minDuration;
    }

    /// @notice Returns the minimum vetoing power required to create a proposal stored in the vetoing settings.
    /// @return The minimum vetoing power required to create a proposal.
    function minProposerVotingPower() public view virtual returns (uint256) {
        return governanceSettings.minProposerVotingPower;
    }

    /// @notice Returns the total vetoing power checkpointed for a specific block number.
    /// @param _blockNumber The block number.
    /// @return The total vetoing power.
    function totalVotingPower(uint256 _blockNumber) public view virtual returns (uint256);

    /// @notice Returns all information for a proposal vote by its ID.
    /// @param _proposalId The ID of the proposal.
    /// @return open Whether the proposal is open or not.
    /// @return executed Whether the proposal is executed or not.
    /// @return parameters The parameters of the proposal vote.
    /// @return vetoPower The current voting power used to veto the proposal.
    /// @return actions The actions to be executed in the associated DAO after the proposal has passed.
    /// @return allowFailureMap The bit map representations of which actions are allowed to revert so tx still succeeds.
    function getProposal(
        uint256 _proposalId
    )
        public
        view
        virtual
        returns (
            bool open,
            bool executed,
            ProposalParameters memory parameters,
            uint256 vetoPower,
            IDAO.Action[] memory actions,
            uint256 allowFailureMap
        )
    {
        Proposal storage proposal_ = proposals[_proposalId];

        open = _isProposalOpen(proposal_);
        executed = proposal_.executed;
        parameters = proposal_.parameters;
        vetoPower = proposal_.vetoTally;
        actions = proposal_.actions;
        allowFailureMap = proposal_.allowFailureMap;
    }

    /// @notice Updates the vetoing settings.
    /// @param _governanceSettings The new vetoing settings.
    function updateOptimisticGovernanceSettings(
        OptimisticGovernanceSettings calldata _governanceSettings
    ) external virtual auth(UPDATE_OPTIMISTIC_GOVERNANCE_SETTINGS_PERMISSION_ID) {
        _updateOptimisticGovernanceSettings(_governanceSettings);
    }

    /// @notice Creates a new optimistic majority proposal.
    /// @param _metadata The metadata of the proposal.
    /// @param _actions The actions that will be executed after the proposal passes.
    /// @param _allowFailureMap Allows proposal to succeed even if an action reverts. Uses bitmap representation. If the bit at index `x` is 1, the tx succeeds even if the action at `x` failed. Passing 0 will be treated as atomic execution.
    /// @param _startDate The start date of the proposal vote. If 0, the current timestamp is used and the vote starts immediately.
    /// @param _endDate The end date of the proposal vote. If 0, `_startDate + minDuration` is used.
    /// @return proposalId The ID of the proposal.
    function createProposal(
        bytes calldata _metadata,
        IDAO.Action[] calldata _actions,
        uint256 _allowFailureMap,
        uint64 _startDate,
        uint64 _endDate
    ) external virtual returns (uint256 proposalId);

    /// @notice Internal function to cast a vote. It assumes the queried vote exists.
    /// @param _proposalId The ID of the proposal.
    function _veto(uint256 _proposalId, address _voter) internal virtual;

    /// @notice Internal function to execute a vote. It assumes the queried proposal exists.
    /// @param _proposalId The ID of the proposal.
    function _execute(uint256 _proposalId) internal virtual {
        proposals[_proposalId].executed = true;

        _executeProposal(
            dao(),
            _proposalId,
            proposals[_proposalId].actions,
            proposals[_proposalId].allowFailureMap
        );
    }

    /// @notice Internal function to check if a voter can veto. It assumes the queried proposal exists.
    /// @param _proposalId The ID of the proposal to veto.
    /// @param _voter The address of the voter to check.
    /// @return Returns `true` if the given voter can veto a certain proposal and `false` otherwise.
    function _canVeto(uint256 _proposalId, address _voter) internal view virtual returns (bool);

    /// @notice Internal function to check if a proposal can be executed. It assumes the queried proposal exists.
    /// @param _proposalId The ID of the proposal.
    /// @return True if the proposal can be executed, false otherwise.
    /// @dev Threshold and minimal values are compared with `>` and `>=` comparators, respectively.
    function _canExecute(uint256 _proposalId) internal view virtual returns (bool) {
        Proposal storage proposal_ = proposals[_proposalId];

        // Verify that the vote has not been executed already.
        if (proposal_.executed) {
            return false;
        }
        // Check that the proposal vetoing time frame already expired
        else if (!_isProposalEnded(proposal_)) {
            return false;
        }
        // Check that not enough voters have vetoed the proposal
        else if (!isMinVetoRatioReached(_proposalId)) {
            return false;
        }

        return true;
    }

    /// @notice Internal function to check if a proposal vote is still open.
    /// @param proposal_ The proposal struct.
    /// @return True if the proposal vote is open, false otherwise.
    function _isProposalOpen(Proposal storage proposal_) internal view virtual returns (bool) {
        uint64 currentTime = block.timestamp.toUint64();

        return
            proposal_.parameters.startDate <= currentTime &&
            currentTime < proposal_.parameters.endDate &&
            !proposal_.executed;
    }

    /// @notice Internal function to check if a proposal already ended.
    /// @param proposal_ The proposal struct.
    /// @return True if the end date of the proposal is already in the past, false otherwise.
    function _isProposalEnded(Proposal storage proposal_) internal view virtual returns (bool) {
        uint64 currentTime = block.timestamp.toUint64();

        return currentTime >= proposal_.parameters.endDate;
    }

    /// @notice Internal function to update the plugin-wide proposal vote settings.
    /// @param _governanceSettings The vetoing settings to be validated and updated.
    function _updateOptimisticGovernanceSettings(
        OptimisticGovernanceSettings calldata _governanceSettings
    ) internal virtual {
        // Require the minimum veto ratio value to be in the interval [0, 10^6], because `>=` comparision is used in the participation criterion.
        if (_governanceSettings.minVetoRatio > RATIO_BASE) {
            revert RatioOutOfBounds({
                limit: RATIO_BASE - 1,
                actual: _governanceSettings.minVetoRatio
            });
        }

        if (_governanceSettings.minDuration < 4 days) {
            revert MinDurationOutOfBounds({limit: 4 days, actual: _governanceSettings.minDuration});
        }

        if (_governanceSettings.minDuration > 365 days) {
            revert MinDurationOutOfBounds({
                limit: 365 days,
                actual: _governanceSettings.minDuration
            });
        }

        governanceSettings = _governanceSettings;

        emit OptimisticGovernanceSettingsUpdated({
            minVetoRatio: _governanceSettings.minVetoRatio,
            minParticipation: _governanceSettings.minParticipation,
            minDuration: _governanceSettings.minDuration,
            minProposerVotingPower: _governanceSettings.minProposerVotingPower
        });
    }

    /// @notice Validates and returns the proposal vote dates.
    /// @param _start The start date of the proposal vote. If 0, the current timestamp is used and the vote starts immediately.
    /// @param _end The end date of the proposal vote. If 0, `_start + minDuration` is used.
    /// @return startDate The validated start date of the proposal vote.
    /// @return endDate The validated end date of the proposal vote.
    function _validateProposalDates(
        uint64 _start,
        uint64 _end
    ) internal view virtual returns (uint64 startDate, uint64 endDate) {
        uint64 currentTimestamp = block.timestamp.toUint64();

        if (_start == 0) {
            startDate = currentTimestamp;
        } else {
            startDate = _start;

            if (startDate < currentTimestamp) {
                revert DateOutOfBounds({limit: currentTimestamp, actual: startDate});
            }
        }

        uint64 earliestEndDate = startDate + governanceSettings.minDuration; // Since `minDuration` is limited to 1 year, `startDate + minDuration` can only overflow if the `startDate` is after `type(uint64).max - minDuration`. In this case, the proposal creation will revert and another date can be picked.

        if (_end == 0) {
            endDate = earliestEndDate;
        } else {
            endDate = _end;

            if (endDate < earliestEndDate) {
                revert DateOutOfBounds({limit: earliestEndDate, actual: endDate});
            }
        }
    }

    /// @notice This empty reserved space is put in place to allow future versions to add new variables without shifting down storage in the inheritance chain (see [OpenZeppelin's guide about storage gaps](https://docs.openzeppelin.com/contracts/4.x/upgradeable#storage_gaps)).
    uint256[50] private __gap;
}
