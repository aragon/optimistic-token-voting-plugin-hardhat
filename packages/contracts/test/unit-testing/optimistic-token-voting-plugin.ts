import { expect } from "chai";
import { ethers } from "hardhat";
import { BigNumber, ContractFactory } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import {
  DAO,
  DAO__factory,
  IERC165Upgradeable__factory,
  IMembership__factory,
  IOptimisticTokenVoting__factory,
  IPlugin__factory,
  IProposal__factory,
  OptimisticTokenVotingPlugin,
  OptimisticTokenVotingPlugin__factory,
} from "../../typechain";
import {
  GovernanceERC20Mock,
  GovernanceERC20Mock__factory,
} from "@aragon/osx-ethers";

import {
  ProposalCreatedEvent,
  ProposalExecutedEvent,
} from "../../typechain/src/OptimisticTokenVotingPlugin";

import {
  ADDRESS_ONE,
  advanceAfterVoteEnd,
  advanceIntoVoteTime,
  getTime,
  MAX_UINT64,
  ONE_WEEK,
  OptimisticGovernanceSettings,
  pctToRatio,
  PROPOSER_PERMISSION_ID,
  RATIO_BASE,
} from "./common";
import { deployWithProxy, findEvent, toBytes32 } from "../../utils/helpers";
import { deployTestDao } from "../helpers/test-dao";
import { ExecutedEvent } from "../../typechain/@aragon/osx/core/dao/DAO";
import { getInterfaceID } from "../../utils/interfaces";
import { start } from "repl";

export const optimisticTokenVotingInterface = new ethers.utils.Interface([
  "function initialize(address,tuple(uint32,uint64,uint256),address)",
  "function getProposal(uint256)",
  "function updateOptimisticGovernanceSettings(tuple(uint32,uint64,uint256))",
]);

describe("OptimisticTokenVotingPlugin", function () {
  let signers: SignerWithAddress[];
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let charlie: SignerWithAddress;
  let debbie: SignerWithAddress;
  let plugin: OptimisticTokenVotingPlugin;
  let dao: DAO;
  let governanceErc20Mock: GovernanceERC20Mock;
  let GovernanceERC20Mock: GovernanceERC20Mock__factory;
  let dummyActions: any;
  let dummyMetadata: string;
  let startDate: number;
  let endDate: number;
  let governanceSettings: OptimisticGovernanceSettings;

  const startOffset = 20;
  const id = 0;

  before(async () => {
    signers = await ethers.getSigners();
    [alice, bob, charlie, debbie] = signers;

    dummyActions = [
      {
        to: alice.address,
        data: "0x00000000",
        value: 0,
      },
    ];

    dummyMetadata = ethers.utils.hexlify(
      ethers.utils.toUtf8Bytes("0x123456789"),
    );

    dao = await deployTestDao(alice);
  });

  beforeEach(async () => {
    governanceSettings = {
      minVetoRatio: pctToRatio(5),
      minDuration: ONE_WEEK,
      minProposerVotingPower: 0,
    };

    GovernanceERC20Mock = new GovernanceERC20Mock__factory(alice);
    governanceErc20Mock = await GovernanceERC20Mock.deploy(
      dao.address,
      "OPT",
      "OPT",
      {
        receivers: [],
        amounts: [],
      },
    );

    const OptimisticTokenVotingPluginFactory =
      new OptimisticTokenVotingPlugin__factory(
        alice,
      );

    plugin = await deployWithProxy(OptimisticTokenVotingPluginFactory);

    startDate = (await getTime()) + startOffset;
    endDate = startDate + governanceSettings.minDuration;

    // The plugin can execute on the DAO
    dao.grant(
      dao.address,
      plugin.address,
      ethers.utils.id("EXECUTE_PERMISSION"),
    );
    // Alice can create proposals
    dao.grant(
      plugin.address,
      alice.address,
      PROPOSER_PERMISSION_ID,
    );
  });

  // Helpers

  function setBalances(
    balances: { receiver: string; amount: number | BigNumber }[],
  ) {
    return Promise.all(
      balances.map((balance) =>
        governanceErc20Mock.setBalance(balance.receiver, balance.amount)
      ),
    );
  }

  async function setTotalSupply(newTotalSupply: number) {
    await ethers.provider.send("evm_mine", []);
    const block = await ethers.provider.getBlock("latest");

    const currentTotalSupply = await governanceErc20Mock
      .getPastTotalSupply(block.number - 1);

    const bnNewTotalSupply = BigNumber.from(newTotalSupply);
    if (bnNewTotalSupply.lt(currentTotalSupply)) {
      throw new Error("Cannot decrease the supply");
    }

    await governanceErc20Mock.setBalance(
      ADDRESS_ONE, // address(1)
      bnNewTotalSupply.sub(currentTotalSupply),
    );
  }

  // Tests

  describe("initialize: ", async () => {
    it("reverts if trying to re-initialize", async () => {
      await plugin.initialize(
        dao.address,
        governanceSettings,
        governanceErc20Mock.address,
      );

      await expect(
        plugin.initialize(
          dao.address,
          governanceSettings,
          governanceErc20Mock.address,
        ),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("emits the `MembershipContractAnnounced` event", async () => {
      await expect(
        await plugin.initialize(
          dao.address,
          governanceSettings,
          governanceErc20Mock.address,
        ),
      )
        .to.emit(plugin, "MembershipContractAnnounced")
        .withArgs(governanceErc20Mock.address);
    });
  });

  describe("ERC-165", async () => {
    it("does not support the empty interface", async () => {
      expect(await plugin.supportsInterface("0xffffffff")).to.be.false;
    });

    it("supports the `IERC165Upgradeable` interface", async () => {
      const iface = IERC165Upgradeable__factory.createInterface();
      expect(await plugin.supportsInterface(getInterfaceID(iface))).to.be.true;
    });

    it("supports the `IPlugin` interface", async () => {
      const iface = IPlugin__factory.createInterface();
      expect(await plugin.supportsInterface(getInterfaceID(iface))).to.be.true;
    });

    it("supports the `IProposal` interface", async () => {
      const iface = IProposal__factory.createInterface();
      expect(await plugin.supportsInterface(getInterfaceID(iface))).to.be.true;
    });

    it("supports the `IMembership` interface", async () => {
      const iface = IMembership__factory.createInterface();
      expect(await plugin.supportsInterface(getInterfaceID(iface))).to.be.true;
    });

    it("supports the `IOptimisticTokenVoting` interface", async () => {
      const iface = IOptimisticTokenVoting__factory.createInterface();
      expect(await plugin.supportsInterface(getInterfaceID(iface))).to.be.true;
    });

    it("supports the `OptimisticTokenVotingPlugin` interface", async () => {
      const iface = getInterfaceID(optimisticTokenVotingInterface);
      expect(iface).to.equal("0x2dc714cc"); // checks that it didn't change

      expect(await plugin.supportsInterface(iface)).to.be.true;
    });
  });

  describe("isMember: ", async () => {
    it("returns true if the account currently owns at least one token", async () => {
      await plugin.initialize(
        dao.address,
        governanceSettings,
        governanceErc20Mock.address,
      );

      await setBalances([{ receiver: alice.address, amount: 1 }]);
      expect(await governanceErc20Mock.balanceOf(alice.address)).to.eq(1);
      expect(await governanceErc20Mock.balanceOf(bob.address)).to.eq(0);

      expect(await governanceErc20Mock.getVotes(alice.address)).to.eq(1);
      expect(await governanceErc20Mock.getVotes(bob.address)).to.eq(0);

      expect(await plugin.isMember(alice.address)).to.be.true;
      expect(await plugin.isMember(bob.address)).to.be.false;
    });

    it("returns true if the account currently has one at least one token delegated to her/him", async () => {
      await plugin.initialize(
        dao.address,
        governanceSettings,
        governanceErc20Mock.address,
      );

      await setBalances([{ receiver: alice.address, amount: 1 }]);
      expect(await governanceErc20Mock.balanceOf(alice.address)).to.eq(1);
      expect(await governanceErc20Mock.balanceOf(bob.address)).to.eq(0);

      await governanceErc20Mock
        .connect(alice)
        .delegate(bob.address);

      expect(await governanceErc20Mock.getVotes(alice.address)).to.eq(0);
      expect(await governanceErc20Mock.getVotes(bob.address)).to.eq(1);

      expect(await plugin.isMember(alice.address)).to.be.true;
      expect(await plugin.isMember(bob.address)).to.be.true;
    });
  });

  describe("Proposal creation", async () => {
    beforeEach(() => {
      return setBalances([{ receiver: alice.address, amount: 1 }])
        .then(() => setTotalSupply(1));
    });

    context("minProposerVotingPower == 0", async () => {
      beforeEach(async () => {
        governanceSettings.minProposerVotingPower = 0;
        await plugin.initialize(
          dao.address,
          governanceSettings,
          governanceErc20Mock.address,
        );
      });

      it("creates a proposal if `_msgSender` owns no tokens and has no tokens delegated to her/him in the current block", async () => {
        await setBalances([
          {
            receiver: bob.address,
            amount: governanceSettings.minProposerVotingPower, // equals 0
          },
        ]);

        dao.grant(plugin.address, bob.address, PROPOSER_PERMISSION_ID);

        const tx = await plugin
          .connect(bob)
          .createProposal(
            dummyMetadata,
            dummyActions,
            0,
            startDate,
            endDate,
          );
        const event = await findEvent<ProposalCreatedEvent>(
          tx,
          "ProposalCreated",
        );
        expect(event!.args.proposalId).to.equal(id);
      });
    });

    context("minProposerVotingPower > 0", async () => {
      beforeEach(() => {
        governanceSettings.minProposerVotingPower = 123;

        return plugin.initialize(
          dao.address,
          governanceSettings,
          governanceErc20Mock.address,
        );
      });

      it("reverts if `_msgSender` owns no tokens and has no tokens delegated to her/him in the current block", async () => {
        await dao.grant(plugin.address, bob.address, PROPOSER_PERMISSION_ID);

        await setBalances([
          {
            receiver: bob.address,
            amount: governanceSettings.minProposerVotingPower,
          },
        ]);

        await expect(
          plugin
            .connect(alice)
            .createProposal(
              dummyMetadata,
              [],
              0,
              startDate,
              endDate,
            ),
        )
          .to.be.revertedWithCustomError(plugin, "ProposalCreationForbidden")
          .withArgs(alice.address);

        await expect(
          plugin
            .connect(bob)
            .createProposal(
              dummyMetadata,
              [],
              0,
              startDate,
              endDate,
            ),
        ).not.to.be.reverted;
      });

      it("reverts if `_msgSender` owns no tokens and has no tokens delegated to her/him in the current block although having them in the last block", async () => {
        await dao.grant(plugin.address, bob.address, PROPOSER_PERMISSION_ID);

        await setBalances([
          {
            receiver: alice.address,
            amount: governanceSettings.minProposerVotingPower,
          },
        ]);

        await ethers.provider.send("evm_setAutomine", [false]);
        const expectedSnapshotBlockNumber = (
          await ethers.provider.getBlock("latest")
        ).number;

        // Transaction 1: Transfer the tokens from alice to bob
        const tx1 = await governanceErc20Mock
          .connect(alice)
          .transfer(
            bob.address,
            governanceSettings.minProposerVotingPower,
          );

        // Transaction 2: Expect the proposal creation to fail for alice because he transferred the tokens in transaction 1
        await expect(
          plugin
            .connect(alice)
            .createProposal(
              dummyMetadata,
              [],
              0,
              startDate,
              endDate,
            ),
        )
          .to.be.revertedWithCustomError(plugin, "ProposalCreationForbidden")
          .withArgs(alice.address);

        // Transaction 3: Create the proposal as bob
        const tx3 = await plugin
          .connect(bob)
          .createProposal(
            dummyMetadata,
            [],
            0,
            startDate,
            endDate,
          );

        // Check the balances before the block is mined
        expect(
          await governanceErc20Mock.balanceOf(alice.address),
        ).to.equal(governanceSettings.minProposerVotingPower);
        expect(
          await governanceErc20Mock.balanceOf(bob.address),
        ).to.equal(0);

        // Mine the block
        await ethers.provider.send("evm_mine", []);
        const minedBlockNumber = (await ethers.provider.getBlock("latest"))
          .number;

        // Expect all transaction receipts to be in the same block after the snapshot block.
        expect((await tx1.wait()).blockNumber).to.equal(minedBlockNumber);
        expect((await tx3.wait()).blockNumber).to.equal(minedBlockNumber);
        expect(minedBlockNumber).to.equal(expectedSnapshotBlockNumber + 1);

        // Expect the balances to have changed
        expect(
          await governanceErc20Mock.balanceOf(alice.address),
        ).to.equal(0);
        expect(
          await governanceErc20Mock.balanceOf(bob.address),
        ).to.equal(governanceSettings.minProposerVotingPower);

        // Check the `ProposalCreatedEvent` for the creator and proposalId
        const event = await findEvent<ProposalCreatedEvent>(
          tx3,
          "ProposalCreated",
        );
        expect(event!.args.proposalId).to.equal(id);
        expect(event!.args.creator).to.equal(bob.address);

        // Check that the snapshot block stored in the proposal struct
        const proposal = await plugin.getProposal(id);
        expect(proposal.parameters.snapshotBlock).to.equal(
          expectedSnapshotBlockNumber,
        );

        await ethers.provider.send("evm_setAutomine", [true]);
      });

      it("creates a proposal if `_msgSender` owns enough tokens  in the current block", async () => {
        await dao.grant(
          plugin.address,
          charlie.address,
          PROPOSER_PERMISSION_ID,
        );

        await setBalances([
          {
            receiver: alice.address,
            amount: governanceSettings.minProposerVotingPower,
          },
        ]);

        // Check that charlie who has no balance and is not a delegatee can NOT create a proposal
        await expect(
          plugin
            .connect(charlie)
            .createProposal(
              dummyMetadata,
              [],
              0,
              startDate,
              endDate,
            ),
        )
          .to.be.revertedWithCustomError(plugin, "ProposalCreationForbidden")
          .withArgs(charlie.address);

        // Check that alice who has enough balance can create a proposal
        await expect(
          plugin
            .connect(alice)
            .createProposal(
              dummyMetadata,
              [],
              0,
              startDate,
              endDate,
            ),
        ).not.to.be.reverted;
      });

      it("creates a proposal if `_msgSender` owns enough tokens and has delegated them to someone else in the current block", async () => {
        await dao.grant(
          plugin.address,
          charlie.address,
          PROPOSER_PERMISSION_ID,
        );

        await setBalances([
          {
            receiver: alice.address,
            amount: governanceSettings.minProposerVotingPower,
          },
        ]);

        // delegate from alice to bob
        await governanceErc20Mock
          .connect(alice)
          .delegate(bob.address);

        // Check that charlie who has a zero balance and is not a delegatee can NOT create a proposal
        await expect(
          plugin
            .connect(charlie)
            .createProposal(
              dummyMetadata,
              [],
              0,
              startDate,
              endDate,
            ),
        )
          .to.be.revertedWithCustomError(plugin, "ProposalCreationForbidden")
          .withArgs(charlie.address);

        const tx = await plugin
          .connect(alice)
          .createProposal(
            dummyMetadata,
            dummyActions,
            0,
            startDate,
            endDate,
          );
        const event = await findEvent<ProposalCreatedEvent>(
          tx,
          "ProposalCreated",
        );
        expect(event!.args.proposalId).to.equal(id);
      });

      it("creates a proposal if `_msgSender` owns no tokens but has enough tokens delegated to her/him in the current block", async () => {
        await dao.grant(plugin.address, bob.address, PROPOSER_PERMISSION_ID);
        await dao.grant(
          plugin.address,
          charlie.address,
          PROPOSER_PERMISSION_ID,
        );
        await setBalances([
          {
            receiver: alice.address,
            amount: governanceSettings.minProposerVotingPower,
          },
        ]);

        // delegate from alice to bob
        await governanceErc20Mock
          .connect(alice)
          .delegate(bob.address);

        // Check that charlie who has a zero balance and is not a delegatee can NOT create a proposal
        await expect(
          plugin
            .connect(charlie)
            .createProposal(
              dummyMetadata,
              [],
              0,
              startDate,
              endDate,
            ),
        )
          .to.be.revertedWithCustomError(plugin, "ProposalCreationForbidden")
          .withArgs(charlie.address);

        await expect(
          plugin
            .connect(bob)
            .createProposal(
              dummyMetadata,
              [],
              0,
              startDate,
              endDate,
            ),
        ).not.to.be.reverted;
      });

      it("reverts if `_msgSender` doesn not own enough tokens herself/himself and has not tokens delegated to her/him in the current block", async () => {
        await dao.grant(
          plugin.address,
          charlie.address,
          PROPOSER_PERMISSION_ID,
        );
        await setBalances([
          {
            receiver: alice.address,
            amount: 1,
          },
          {
            receiver: bob.address,
            amount: governanceSettings.minProposerVotingPower,
          },
        ]);

        // Check that alice who has not enough tokens cannot create a proposal
        await expect(
          plugin
            .connect(charlie)
            .createProposal(
              dummyMetadata,
              [],
              0,
              startDate,
              endDate,
            ),
        )
          .to.be.revertedWithCustomError(plugin, "ProposalCreationForbidden")
          .withArgs(charlie.address);

        // Check that alice delegating to bob does not let him create a proposal
        await governanceErc20Mock
          .connect(alice)
          .delegate(bob.address);

        await expect(
          plugin
            .connect(alice)
            .createProposal(
              dummyMetadata,
              [],
              0,
              startDate,
              endDate,
            ),
        )
          .to.be.revertedWithCustomError(plugin, "ProposalCreationForbidden")
          .withArgs(alice.address);
      });
    });

    it("reverts if the total token supply is 0", async () => {
      governanceErc20Mock = await GovernanceERC20Mock.deploy(
        dao.address,
        "GOV",
        "GOV",
        {
          receivers: [],
          amounts: [],
        },
      );

      await plugin.initialize(
        dao.address,
        governanceSettings,
        governanceErc20Mock.address,
      );

      await expect(
        plugin.createProposal(
          dummyMetadata,
          [],
          0,
          0,
          0,
        ),
      ).to.be.revertedWithCustomError(plugin, "NoVotingPower");
    });

    it("reverts if the start date is set smaller than the current date", async () => {
      await plugin.initialize(
        dao.address,
        governanceSettings,
        governanceErc20Mock.address,
      );

      const currentDate = await getTime();
      const startDateInThePast = currentDate - 1;
      const endDate = 0; // startDate + minDuration

      await expect(
        plugin.createProposal(
          dummyMetadata,
          [],
          0,
          startDateInThePast,
          endDate,
        ),
      )
        .to.be.revertedWithCustomError(plugin, "DateOutOfBounds")
        .withArgs(
          currentDate + 1, // await takes one second
          startDateInThePast,
        );
    });

    it("panics if the start date is after the latest start date", async () => {
      await plugin.initialize(
        dao.address,
        governanceSettings,
        governanceErc20Mock.address,
      );

      const latestStartDate = MAX_UINT64.sub(governanceSettings.minDuration);
      const tooLateStartDate = latestStartDate.add(1);
      const endDate = 0; // startDate + minDuration

      await expect(
        plugin.createProposal(
          dummyMetadata,
          [],
          0,
          tooLateStartDate,
          endDate,
        ),
      ).to.be.revertedWithPanic(0x11);
    });

    it("reverts if the end date is before the earliest end date so that min duration cannot be met", async () => {
      await plugin.initialize(
        dao.address,
        governanceSettings,
        governanceErc20Mock.address,
      );

      const startDate = (await getTime()) + 1;
      const earliestEndDate = startDate + governanceSettings.minDuration;
      const tooEarlyEndDate = earliestEndDate - 1;

      await expect(
        plugin.createProposal(
          dummyMetadata,
          [],
          0,
          startDate,
          tooEarlyEndDate,
        ),
      )
        .to.be.revertedWithCustomError(plugin, "DateOutOfBounds")
        .withArgs(earliestEndDate, tooEarlyEndDate);
    });

    it("sets the startDate to now and endDate to startDate + minDuration, if 0 is provided as an input", async () => {
      await plugin.initialize(
        dao.address,
        governanceSettings,
        governanceErc20Mock.address,
      );

      // Create a proposal with zero as an input for `_startDate` and `_endDate`
      const startDate = 0; // now
      const endDate = 0; // startDate + minDuration

      const creationTx = await plugin.createProposal(
        dummyMetadata,
        [],
        0,
        startDate,
        endDate,
      );

      const currentTime = (
        await ethers.provider.getBlock((await creationTx.wait()).blockNumber)
      ).timestamp;

      const expectedStartDate = currentTime;
      const expectedEndDate = expectedStartDate +
        governanceSettings.minDuration;

      // Check the state
      const proposal = await plugin.getProposal(id);
      expect(proposal.parameters.startDate).to.eq(expectedStartDate);
      expect(proposal.parameters.endDate).to.eq(expectedEndDate);

      // Check the event
      const event = await findEvent<ProposalCreatedEvent>(
        creationTx,
        "ProposalCreated",
      );

      expect(event!.args.proposalId).to.equal(id);
      expect(event!.args.creator).to.equal(alice.address);
      expect(event!.args.startDate).to.equal(expectedStartDate);
      expect(event!.args.endDate).to.equal(expectedEndDate);
      expect(event!.args.metadata).to.equal(dummyMetadata);
      expect(event!.args.actions).to.deep.equal([]);
      expect(event!.args.allowFailureMap).to.equal(0);
    });

    it("ceils the `minVetoVotingPower` value if it has a remainder", async () => {
      governanceSettings.minVetoRatio = pctToRatio(30).add(1); // 30.0001 %

      await setBalances([{ receiver: alice.address, amount: 10 }]);

      await plugin.initialize(
        dao.address,
        governanceSettings,
        governanceErc20Mock.address,
      );

      const tx = await plugin.createProposal(
        dummyMetadata,
        dummyActions,
        0,
        startDate,
        endDate,
      );
      const event = await findEvent<ProposalCreatedEvent>(
        tx,
        "ProposalCreated",
      );
      expect(event!.args.proposalId).to.equal(id);

      expect((await plugin.getProposal(id)).parameters.minVetoVotingPower).to
        .eq(4); // 4 out of 10 votes must be casted for the proposal to fail
    });

    it("does not ceil the `minVetoVotingPower` value if it has no remainder", async () => {
      governanceSettings.minVetoRatio = pctToRatio(30); // 30.0000 %

      await setBalances([{ receiver: alice.address, amount: 10 }]); // 10 votes * 30% = 3 votes

      await plugin.initialize(
        dao.address,
        governanceSettings,
        governanceErc20Mock.address,
      );

      const tx = await plugin.createProposal(
        dummyMetadata,
        dummyActions,
        0,
        startDate,
        endDate,
      );
      const event = await findEvent<ProposalCreatedEvent>(
        tx,
        "ProposalCreated",
      );
      expect(event!.args.proposalId).to.equal(id);

      expect((await plugin.getProposal(id)).parameters.minVetoVotingPower).to
        .eq(3); // 3 out of 10 votes must be casted for the proposal to fail
    });

    it("should create a vote successfully", async () => {
      governanceSettings = {
        minVetoRatio: pctToRatio(15), // 15%
        minDuration: ONE_WEEK,
        minProposerVotingPower: 0,
      };
      await plugin.initialize(
        dao.address,
        governanceSettings,
        governanceErc20Mock.address,
      );

      const allowFailureMap = 1;

      await setBalances([{ receiver: alice.address, amount: 10 }]);

      let tx = await plugin.createProposal(
        dummyMetadata,
        dummyActions,
        allowFailureMap,
        0,
        0,
      );

      await expect(tx)
        .to.emit(plugin, "ProposalCreated");

      const event = await findEvent<ProposalCreatedEvent>(
        tx,
        "ProposalCreated",
      );
      expect(event!.args.proposalId).to.equal(id);
      expect(event!.args.creator).to.equal(alice.address);
      expect(event!.args.metadata).to.equal(dummyMetadata);
      expect(event!.args.actions.length).to.equal(1);
      expect(event!.args.actions[0].to).to.equal(dummyActions[0].to);
      expect(event!.args.actions[0].value).to.equal(dummyActions[0].value);
      expect(event!.args.actions[0].data).to.equal(dummyActions[0].data);
      expect(event!.args.allowFailureMap).to.equal(allowFailureMap);

      const block = await ethers.provider.getBlock("latest");

      const proposal = await plugin.getProposal(id);

      expect(proposal.open).to.be.true;
      expect(proposal.executed).to.be.false;
      expect(proposal.allowFailureMap).to.equal(allowFailureMap);

      expect(proposal.parameters.minVetoVotingPower).to.equal(2); // 15% of 10 tokens ceiled => 2
      expect(proposal.parameters.snapshotBlock).to.equal(block.number - 1);
      expect(
        proposal.parameters.startDate.add(governanceSettings.minDuration),
      ).to.equal(proposal.parameters.endDate);

      expect(
        await plugin.totalVotingPower(proposal.parameters.snapshotBlock),
      ).to.equal(10);
      expect(proposal.vetoTally).to.equal(0);

      expect(
        await plugin.canVeto(id, alice.address),
      ).to.be.true;
      expect(
        await plugin.canVeto(id + 1, alice.address),
      ).to.be.false;

      expect(proposal.actions.length).to.equal(1);
      expect(proposal.actions[0].to).to.equal(dummyActions[0].to);
      expect(proposal.actions[0].value).to.equal(dummyActions[0].value);
      expect(proposal.actions[0].data).to.equal(dummyActions[0].data);
    });
  });

  describe("Different scenarios:", async () => {
    describe("minVetoRatio is 0%", () => {
      it("Should revert", async () => {
        governanceSettings.minVetoRatio = pctToRatio(0);

        await expect(plugin.initialize(
          dao.address,
          governanceSettings,
          governanceErc20Mock.address,
        )).to.revertedWithCustomError(plugin, "RatioOutOfBounds");
      });
    });

    describe("minVetoRatio is 15%", async () => {
      beforeEach(async () => {
        governanceSettings.minVetoRatio = pctToRatio(15);

        await plugin.initialize(
          dao.address,
          governanceSettings,
          governanceErc20Mock.address,
        );

        const receivers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
          (i) => signers[i].address,
        );
        const amounts = Array(10).fill(10);
        const balances = receivers.map((receiver, i) => ({
          receiver: receiver,
          amount: amounts[i],
        }));

        await setBalances(balances);
        await setTotalSupply(100);

        await plugin.createProposal(
          dummyMetadata,
          dummyActions,
          0,
          0,
          0,
        );
      });

      it("executes if nobody vetoes", async () => {
        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.false;

        const proposal = await plugin.getProposal(id);
        await advanceAfterVoteEnd(endDate);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.true;
        await expect(plugin.execute(id)).to.not.be.reverted;
      });

      it("executes if not enough voters veto", async () => {
        await plugin.connect(alice).veto(id);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.false;

        await advanceAfterVoteEnd(endDate);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.true;
        await expect(plugin.execute(id)).to.not.be.reverted;
      });

      it("does not execute if enough voters veto", async () => {
        await plugin.connect(alice).veto(id);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.false;

        await plugin.connect(bob).veto(id);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.true;
        expect(await plugin.canExecute(id)).to.be.false;

        await advanceAfterVoteEnd(endDate);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.true;
        expect(await plugin.canExecute(id)).to.be.false;
      });
    });

    describe("minVetoRatio is 25%", async () => {
      beforeEach(async () => {
        governanceSettings.minVetoRatio = pctToRatio(25);

        await plugin.initialize(
          dao.address,
          governanceSettings,
          governanceErc20Mock.address,
        );

        const receivers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
          (i) => signers[i].address,
        );
        const amounts = Array(10).fill(10);
        const balances = receivers.map((receiver, i) => ({
          receiver: receiver,
          amount: amounts[i],
        }));

        await setBalances(balances);
        await setTotalSupply(100);

        await plugin.createProposal(
          dummyMetadata,
          dummyActions,
          0,
          0,
          0,
        );
      });

      it("executes if nobody vetoes", async () => {
        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.false;

        const proposal = await plugin.getProposal(id);
        await advanceAfterVoteEnd(endDate);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.true;
        await expect(plugin.execute(id)).to.not.be.reverted;
      });

      it("executes if not enough voters veto", async () => {
        await plugin.connect(alice).veto(id);
        await plugin.connect(bob).veto(id);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.false;

        await advanceAfterVoteEnd(endDate);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.true;
        await expect(plugin.execute(id)).to.not.be.reverted;
      });

      it("does not execute if enough voters veto", async () => {
        await plugin.connect(alice).veto(id);
        await plugin.connect(bob).veto(id);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.false;

        await plugin.connect(charlie).veto(id);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.true;
        expect(await plugin.canExecute(id)).to.be.false;

        await advanceAfterVoteEnd(endDate);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.true;
        expect(await plugin.canExecute(id)).to.be.false;
      });
    });

    describe("minVetoRatio is 50%", async () => {
      beforeEach(async () => {
        governanceSettings.minVetoRatio = pctToRatio(50);

        await plugin.initialize(
          dao.address,
          governanceSettings,
          governanceErc20Mock.address,
        );

        const receivers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
          (i) => signers[i].address,
        );
        const amounts = Array(10).fill(10);
        const balances = receivers.map((receiver, i) => ({
          receiver: receiver,
          amount: amounts[i],
        }));

        await setBalances(balances);
        await setTotalSupply(100);

        await plugin.createProposal(
          dummyMetadata,
          dummyActions,
          0,
          0,
          0,
        );
      });

      it("executes if nobody vetoes", async () => {
        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.false;

        const proposal = await plugin.getProposal(id);
        await advanceAfterVoteEnd(endDate);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.true;
        await expect(plugin.execute(id)).to.not.be.reverted;
      });

      it("executes if not enough voters veto", async () => {
        await plugin.connect(alice).veto(id);
        await plugin.connect(bob).veto(id);
        await plugin.connect(charlie).veto(id);
        await plugin.connect(debbie).veto(id);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.false;

        await advanceAfterVoteEnd(endDate);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.true;
        await expect(plugin.execute(id)).to.not.be.reverted;
      });

      it("does not execute if enough voters veto", async () => {
        await plugin.connect(alice).veto(id);
        await plugin.connect(bob).veto(id);
        await plugin.connect(charlie).veto(id);
        await plugin.connect(debbie).veto(id);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.false;

        await plugin.connect(signers[4]).veto(id);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.true;
        expect(await plugin.canExecute(id)).to.be.false;

        await advanceAfterVoteEnd(endDate);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.true;
        expect(await plugin.canExecute(id)).to.be.false;
      });
    });

    describe("minVetoRatio is 100%", async () => {
      beforeEach(async () => {
        governanceSettings.minVetoRatio = pctToRatio(100);

        await plugin.initialize(
          dao.address,
          governanceSettings,
          governanceErc20Mock.address,
        );
      });

      context("token balances are in the magnitude of 10^18", async () => {
        beforeEach(async () => {
          const totalSupply = ethers.BigNumber.from(10).pow(18);
          const ratioUnit = totalSupply.div(RATIO_BASE);
          await setBalances([
            {
              receiver: alice.address,
              amount: totalSupply.sub(ratioUnit), // 99.9999% of the total supply
            },
            { receiver: bob.address, amount: 1 }, // 1 vote (10^-16 % = 0.0000000000000001%)
            { receiver: charlie.address, amount: ratioUnit.sub(1) }, // 1 vote less than 0.0001% of the total supply (99.9999% - 10^-16% = 0.00009999999999999%)
          ]);

          await plugin.createProposal(
            dummyMetadata,
            dummyActions,
            0,
            0,
            0,
          );
        });

        it("early support criterium is sharp by 1 vote", async () => {
          await advanceIntoVoteTime(startDate, endDate);
          expect(await plugin.isMinVetoRatioReached(id)).to.be.false;

          // 99.9999% of the plugin power voted for yes
          await plugin.connect(alice).veto(id);
          expect(await plugin.isMinVetoRatioReached(id)).to.be.false;

          // 1 vote is still missing to meet >99.9999% worst case support
          const proposal = await plugin.getProposal(id);
          const totalVotingPower = await plugin.totalVotingPower(
            proposal.parameters.snapshotBlock,
          );
          expect(
            totalVotingPower.sub(proposal.vetoTally),
          ).to.eq(totalVotingPower.div(RATIO_BASE));

          // veto with 1 more vote
          await plugin.connect(bob).veto(id);
          expect(await plugin.isMinVetoRatioReached(id)).to.be.false;

          // veto with the rest
          await plugin.connect(charlie).veto(id);
          expect(await plugin.isMinVetoRatioReached(id)).to.be.true;
        });
      });

      context("tokens balances are in the magnitude of 10^6", async () => {
        const totalSupply = ethers.BigNumber.from(10).pow(6);
        const ratioUnit = 1; // 0.0001% of the total supply

        beforeEach(async () => {
          await setBalances([
            { receiver: alice.address, amount: totalSupply.sub(ratioUnit) }, // 99.9999%
            { receiver: bob.address, amount: ratioUnit }, //             0.0001%
          ]);

          await plugin.createProposal(
            dummyMetadata,
            dummyActions,
            0,
            0,
            0,
          );
        });

        it("early support criterium is sharp by 1 vote", async () => {
          await advanceIntoVoteTime(startDate, endDate);

          expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
          await plugin.connect(alice).veto(id);
          expect(await plugin.isMinVetoRatioReached(id)).to.be.false;

          // 1 vote is still missing to meet >99.9999%
          const proposal = await plugin.getProposal(id);
          const totalVotingPower = await plugin.totalVotingPower(
            proposal.parameters.snapshotBlock,
          );
          expect(
            totalVotingPower.sub(proposal.vetoTally),
          ).to.eq(totalVotingPower.div(RATIO_BASE));

          // cast the last vote so that veto = 100%
          await plugin.connect(bob).veto(id);
          expect(await plugin.isMinVetoRatioReached(id)).to.be.true;
        });
      });
    });

    describe("minVetoRatio > 100%", () => {
      it("Should revert", async () => {
        governanceSettings.minVetoRatio = pctToRatio(101);

        await expect(plugin.initialize(
          dao.address,
          governanceSettings,
          governanceErc20Mock.address,
        )).to.revertedWithCustomError(plugin, "RatioOutOfBounds");
      });
    });
  });

  describe("Execution criteria handle token balances for multiple orders of magnitude", function () {
    beforeEach(() => {
      governanceSettings.minVetoRatio = pctToRatio(15);
    });

    const powers = [0, 1, 2, 3, 6, 12, 18, 24, 36, 48];

    powers.forEach((power) => {
      it(`magnitudes of 10^${power}`, async function () {
        await plugin.initialize(
          dao.address,
          governanceSettings,
          governanceErc20Mock.address,
        );

        let magnitude = BigNumber.from(10).pow(power);

        const oneToken = magnitude;
        const balances = [
          {
            receiver: alice.address,
            amount: oneToken.mul(5).add(1),
          },
          {
            receiver: bob.address,
            amount: oneToken.mul(5),
          },
        ];

        // alice has more plugin power than bob
        const balanceDifference = balances[0].amount.sub(balances[1].amount);
        expect(balanceDifference).to.eq(1);

        await setBalances(balances);

        await plugin.createProposal(
          dummyMetadata,
          dummyActions,
          0,
          0,
          0,
        );

        const snapshotBlock = (await plugin.getProposal(id)).parameters
          .snapshotBlock;
        const totalVotingPower = await plugin.totalVotingPower(snapshotBlock);
        expect(totalVotingPower).to.eq(
          balances[0].amount.add(balances[1].amount),
        );

        expect(await plugin.isMinVetoRatioReached(id)).to.be.false;
        expect(await plugin.canExecute(id)).to.be.false;

        // vote with both signers
        await plugin.connect(alice).veto(id);
        await plugin.connect(bob).veto(id);

        expect(await plugin.isMinVetoRatioReached(id)).to.be.true;
        expect(await plugin.canExecute(id)).to.be.false;
      });
    });
  });
});
