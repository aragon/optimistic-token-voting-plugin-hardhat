import {
  OptimisticTokenVotingPluginSetupParams,
} from "../../plugin-setup-params";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Optimistic token voting
  console.log(
    `\nDeploying ${OptimisticTokenVotingPluginSetupParams.PLUGIN_SETUP_CONTRACT_NAME}`,
  );

  await deploy(
    OptimisticTokenVotingPluginSetupParams.PLUGIN_SETUP_CONTRACT_NAME,
    {
      from: deployer,
      args: [],
      log: true,
    },
  );
};

export default func;
func.tags = [
  OptimisticTokenVotingPluginSetupParams.PLUGIN_SETUP_CONTRACT_NAME,
  "Deployment",
];
