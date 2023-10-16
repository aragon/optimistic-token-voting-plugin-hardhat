import buildMetadata from "../../src/optimistic-token-voting-build-metadata.json";
import {
  DAO,
  GovernanceERC20__factory,
  GovernanceWrappedERC20__factory,
  OptimisticTokenVotingPlugin__factory,
  OptimisticTokenVotingPluginSetup,
  OptimisticTokenVotingPluginSetup__factory,
} from "../../typechain";
import { deployTestDao } from "../helpers/test-dao";
import { getNamedTypesFromMetadata, Operation } from "../helpers/types";
import {
  abiCoder,
  ADDRESS_ONE,
  ADDRESS_ZERO,
  EXECUTE_PERMISSION_ID,
  NO_CONDITION,
  pctToRatio,
  PROPOSER_PERMISSION_ID,
  UPDATE_OPTIMISTIC_GOVERNANCE_SETTINGS_PERMISSION_ID,
  UPGRADE_PLUGIN_PERMISSION_ID,
} from "./common";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("Main Voting Plugin Setup", function () {
  let alice: SignerWithAddress;
  let bob: SignerWithAddress;
  let mainVotingPluginSetup: OptimisticTokenVotingPluginSetup;
  let dao: DAO;

  before(async () => {
    [alice, bob] = await ethers.getSigners();
    dao = await deployTestDao(alice);

    const governanceErc20Base = await new GovernanceERC20__factory(alice)
      .deploy(dao.address, "OPT", "OPT", {
        amounts: [],
        receivers: [],
      });
    const governanceWrappedErc20Base =
      await new GovernanceWrappedERC20__factory(alice).deploy(
        governanceErc20Base.address,
        "wOPT",
        "wOPT",
      );

    mainVotingPluginSetup = await new OptimisticTokenVotingPluginSetup__factory(
      alice,
    ).deploy(
      governanceErc20Base.address,
      governanceWrappedErc20Base.address,
    );
  });

  describe("prepareInstallation", async () => {
    it("returns the plugin, helpers, and permissions", async () => {
      // Params: (MajorityVotingBase.VotingSettings, address, address)
      const initData = abiCoder.encode(
        getNamedTypesFromMetadata(
          buildMetadata.pluginSetup.prepareInstallation.inputs,
        ),
        [
          {
            minVetoRatio: pctToRatio(5),
            minDuration: 60 * 60 * 24 * 5,
            minProposerVotingPower: 0,
          },
          [alice.address],
        ],
      );
      const nonce = await ethers.provider.getTransactionCount(
        mainVotingPluginSetup.address,
      );
      const anticipatedPluginAddress = ethers.utils.getContractAddress({
        from: mainVotingPluginSetup.address,
        nonce,
      });

      const {
        plugin,
        preparedSetupData: { helpers, permissions },
      } = await mainVotingPluginSetup.callStatic.prepareInstallation(
        dao.address,
        initData,
      );

      expect(plugin).to.be.equal(anticipatedPluginAddress);
      expect(helpers.length).to.be.equal(0);
      expect(permissions.length).to.be.equal(3);
      expect(permissions).to.deep.equal([
        [
          Operation.Grant,
          dao.address,
          plugin,
          NO_CONDITION,
          EXECUTE_PERMISSION_ID,
        ],
        [
          Operation.Grant,
          plugin,
          dao.address,
          NO_CONDITION,
          UPDATE_OPTIMISTIC_GOVERNANCE_SETTINGS_PERMISSION_ID,
        ],
        [
          Operation.Grant,
          plugin,
          dao.address,
          NO_CONDITION,
          UPGRADE_PLUGIN_PERMISSION_ID,
        ],
      ]);

      await mainVotingPluginSetup.prepareInstallation(dao.address, initData);
      const myPlugin = new OptimisticTokenVotingPlugin__factory(alice).attach(
        plugin,
      );

      // initialization is correct
      expect(await myPlugin.dao()).to.eq(dao.address);
    });
  });

  describe("prepareUninstallation", async () => {
    it("returns the permissions", async () => {
      const plugin = await new OptimisticTokenVotingPlugin__factory(alice)
        .deploy();

      const uninstallData = abiCoder.encode(
        getNamedTypesFromMetadata(
          buildMetadata.pluginSetup.prepareUninstallation.inputs,
        ),
        [],
      );
      const permissions = await mainVotingPluginSetup.callStatic
        .prepareUninstallation(
          dao.address,
          {
            plugin: plugin.address,
            currentHelpers: [],
            data: uninstallData,
          },
        );

      expect(permissions.length).to.be.equal(4);
      expect(permissions).to.deep.equal([
        [
          Operation.Revoke,
          dao.address,
          plugin.address,
          NO_CONDITION,
          EXECUTE_PERMISSION_ID,
        ],
        [
          Operation.Revoke,
          plugin.address,
          dao.address,
          NO_CONDITION,
          UPDATE_OPTIMISTIC_GOVERNANCE_SETTINGS_PERMISSION_ID,
        ],
        [
          Operation.Revoke,
          plugin.address,
          dao.address,
          NO_CONDITION,
          UPGRADE_PLUGIN_PERMISSION_ID,
        ],
      ]);
    });
  });
});
