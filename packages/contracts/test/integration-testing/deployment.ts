import { osxContracts } from "../../utils/helpers";
import { getPluginRepoInfo } from "../../utils/plugin-repo-info";
import { OptimisticTokenVotingPluginSetupParams } from "../../plugin-setup-params";
import {
  PluginRepo,
  PluginRepo__factory,
  PluginRepoRegistry,
  PluginRepoRegistry__factory,
} from "@aragon/osx-ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { deployments, ethers } from "hardhat";

async function deployAll() {
  await deployments.fixture();
}

describe("PluginRepo Deployment", function () {
  let alice: SignerWithAddress;
  let repoRegistry: PluginRepoRegistry;
  let pluginRepo: PluginRepo;

  before(async () => {
    [alice] = await ethers.getSigners();

    // Deployment should be empty
    expect(await deployments.all()).to.be.empty;

    // Deploy all contracts
    await deployAll();
  });

  const setups = [
    OptimisticTokenVotingPluginSetupParams,
  ];

  setups.forEach((pluginSetupParams) => {
    context(pluginSetupParams.PLUGIN_CONTRACT_NAME, () => {
      before(() => {
        const hardhatForkNetwork = process.env.NETWORK_NAME ?? "mainnet";

        // plugin repo registry
        repoRegistry = PluginRepoRegistry__factory.connect(
          osxContracts[hardhatForkNetwork]["PluginRepoRegistry"],
          alice,
        );

        const pluginRepoInfo = getPluginRepoInfo(
          pluginSetupParams.PLUGIN_REPO_ENS_NAME,
          "hardhat",
        );
        if (!pluginRepoInfo) {
          throw new Error(
            `${pluginSetupParams.PLUGIN_CONTRACT_NAME}: Cannot find the deployment entry`,
          );
        }
        pluginRepo = PluginRepo__factory.connect(
          pluginRepoInfo.address,
          alice,
        );
      });

      it("creates the repo", async () => {
        expect(await repoRegistry.entries(pluginRepo.address)).to.be.true;
      });

      it("makes the deployer the repo maintainer", async () => {
        expect(
          await pluginRepo.isGranted(
            pluginRepo.address,
            alice.address,
            ethers.utils.id("ROOT_PERMISSION"),
            ethers.constants.AddressZero,
          ),
        ).to.be.true;

        expect(
          await pluginRepo.isGranted(
            pluginRepo.address,
            alice.address,
            ethers.utils.id("UPGRADE_REPO_PERMISSION"),
            ethers.constants.AddressZero,
          ),
        ).to.be.true;
      });

      context("Publication", () => {
        it("registerd the setup", async () => {
          const results = await pluginRepo["getVersion((uint8,uint16))"](
            pluginSetupParams.VERSION,
          );

          expect(results.pluginSetup).to.equal(
            (await deployments.get(
              pluginSetupParams.PLUGIN_SETUP_CONTRACT_NAME,
            )).address,
          );

          const receivedStriMetadata = Buffer.from(
            results.buildMetadata.slice(2),
            "hex",
          ).toString();

          switch (pluginSetupParams.PLUGIN_SETUP_CONTRACT_NAME) {
            case OptimisticTokenVotingPluginSetupParams
              .PLUGIN_SETUP_CONTRACT_NAME:
              expect(receivedStriMetadata).to.equal(
                "ipfs://QmdEAfaFb6iYW4UKE7cnkY3DD3uXdSe2ZnRExjJRbJSfNN",
              );
              break;

            // case XyzPluginSetupParams.PLUGIN_SETUP_CONTRACT_NAME:
            //   expect(receivedStriMetadata).to.equal(
            //     "ipfs://QmYKrFvNmsEzZmtGGBfUJXzevR6YLk7a16VEAeuPDhwzCJ",
            //   );
            //   break;

            default:
              throw new Error(
                "Unexpected contract name: " +
                  pluginSetupParams.PLUGIN_CONTRACT_NAME,
              );
          }
        });
      });
    });
  });
});
