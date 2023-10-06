import {
  OptimisticTokenVotingPluginSetupParams,
} from "../../plugin-setup-params";
import {
  OptimisticTokenVotingPlugin__factory,
  OptimisticTokenVotingPluginSetup__factory,
} from "../../typechain";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { setTimeout } from "timers/promises";

const func: DeployFunction = function (hre: HardhatRuntimeEnvironment) {
  return concludeOptimisticTokenVotingPluginSetup(hre);
};

async function concludeOptimisticTokenVotingPluginSetup(
  hre: HardhatRuntimeEnvironment,
) {
  const { deployments, network } = hre;
  const [deployer] = await hre.ethers.getSigners();

  console.log(
    `Concluding ${OptimisticTokenVotingPluginSetupParams.PLUGIN_SETUP_CONTRACT_NAME} deployment.\n`,
  );

  const setupDeployment = await deployments.get(
    OptimisticTokenVotingPluginSetupParams.PLUGIN_SETUP_CONTRACT_NAME,
  );
  const setup = OptimisticTokenVotingPluginSetup__factory.connect(
    setupDeployment.address,
    deployer,
  );
  const implementation = OptimisticTokenVotingPlugin__factory.connect(
    await setup.implementation(),
    deployer,
  );

  // Add a timeout for polygon because the call to `implementation()` can fail for newly deployed contracts in the first few seconds
  if (network.name === "polygon") {
    console.log(`Waiting 30 secs for ${network.name} to finish up...`);
    await setTimeout(30000);
  }

  hre.aragonToVerifyContracts.push({
    address: setupDeployment.address,
    args: setupDeployment.args,
  });
  hre.aragonToVerifyContracts.push({
    address: implementation.address,
    args: [],
  });
}

export default func;
func.tags = [
  OptimisticTokenVotingPluginSetupParams.PLUGIN_SETUP_CONTRACT_NAME,
  "Verification",
];
