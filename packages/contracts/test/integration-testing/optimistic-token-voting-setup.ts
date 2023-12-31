import { OptimisticTokenVotingPluginSetupParams } from "../../plugin-setup-params";
import {
  OptimisticTokenVotingPlugin,
  OptimisticTokenVotingPlugin__factory,
  OptimisticTokenVotingPluginSetup,
  OptimisticTokenVotingPluginSetup__factory,
  PluginRepo,
} from "../../typechain";
import { PluginSetupRefStruct } from "../../typechain/@aragon/osx/framework/dao/DAOFactory";
import { osxContracts } from "../../utils/helpers";
import { getPluginRepoInfo } from "../../utils/plugin-repo-info";
import { installPlugin, uninstallPlugin } from "../helpers/setup";
import { deployTestDao } from "../helpers/test-dao";
import { getNamedTypesFromMetadata } from "../helpers/types";
import {
  DAO,
  PluginRepo__factory,
  PluginSetupProcessor,
  PluginSetupProcessor__factory,
} from "@aragon/osx-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { ADDRESS_ZERO } from "../unit-testing/common";
import { toHex } from "../../utils/ipfs";

describe("OptimisticTokenVotingPluginSetup processing", function () {
  let alice: SignerWithAddress;

  let psp: PluginSetupProcessor;
  let dao: DAO;
  let pluginRepo: PluginRepo;

  before(async () => {
    [alice] = await ethers.getSigners();

    const hardhatForkNetwork = process.env.NETWORK_NAME ?? "mainnet";

    const pluginRepoInfo = getPluginRepoInfo(
      OptimisticTokenVotingPluginSetupParams.PLUGIN_REPO_ENS_NAME,
      "hardhat",
    );
    if (!pluginRepoInfo) {
      throw new Error("The plugin setup details are not available");
    }

    // PSP
    psp = PluginSetupProcessor__factory.connect(
      osxContracts[hardhatForkNetwork]["PluginSetupProcessor"],
      alice,
    );

    // Deploy DAO.
    dao = await deployTestDao(alice);

    await dao.grant(
      dao.address,
      psp.address,
      ethers.utils.id("ROOT_PERMISSION"),
    );
    await dao.grant(
      psp.address,
      alice.address,
      ethers.utils.id("APPLY_INSTALLATION_PERMISSION"),
    );
    await dao.grant(
      psp.address,
      alice.address,
      ethers.utils.id("APPLY_UNINSTALLATION_PERMISSION"),
    );
    await dao.grant(
      psp.address,
      alice.address,
      ethers.utils.id("APPLY_UPDATE_PERMISSION"),
    );

    pluginRepo = PluginRepo__factory.connect(
      pluginRepoInfo.address,
      alice,
    );
  });

  context("Build 1", async () => {
    let setup: OptimisticTokenVotingPluginSetup;
    let pluginSetupRef: PluginSetupRefStruct;
    let plugin: OptimisticTokenVotingPlugin;
    const pluginUpgrader = ADDRESS_ZERO;

    before(async () => {
      const release = 1;

      // Deploy setups.
      setup = OptimisticTokenVotingPluginSetup__factory.connect(
        (await pluginRepo["getLatestVersion(uint8)"](release)).pluginSetup,
        alice,
      );

      pluginSetupRef = {
        versionTag: {
          release: BigNumber.from(release),
          build: BigNumber.from(1),
        },
        pluginSetupRepo: pluginRepo.address,
      };
    });

    beforeEach(async () => {
      // Install build 1.
      const data = ethers.utils.defaultAbiCoder.encode(
        getNamedTypesFromMetadata(
          OptimisticTokenVotingPluginSetupParams.METADATA.build.pluginSetup
            .prepareInstallation
            .inputs,
        ),
        [toHex("ipfs://1234"), pluginUpgrader],
      );
      const results = await installPlugin(psp, dao, pluginSetupRef, data);

      plugin = OptimisticTokenVotingPlugin__factory.connect(
        results.preparedEvent.args.plugin,
        alice,
      );
    });

    it("installs & uninstalls", async () => {
      expect(await plugin.implementation()).to.be.eq(
        await setup.implementation(),
      );
      expect(await plugin.dao()).to.be.eq(dao.address);

      // Uninstall build 1.
      const data = ethers.utils.defaultAbiCoder.encode(
        getNamedTypesFromMetadata(
          OptimisticTokenVotingPluginSetupParams.METADATA.build.pluginSetup
            .prepareUninstallation
            .inputs,
        ),
        [pluginUpgrader],
      );
      await uninstallPlugin(psp, dao, plugin, pluginSetupRef, data, []);
    });
  });
});
