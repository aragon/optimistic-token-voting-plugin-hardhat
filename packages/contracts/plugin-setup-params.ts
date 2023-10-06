import pluginBuildMetadata from "./src/optimistic-token-voting-build-metadata.json";
import pluginReleaseMetadata from "./src/optimistic-token-voting-release-metadata.json";

export const OptimisticTokenVotingPluginSetupParams: PluginSetupParams = {
  PLUGIN_REPO_ENS_NAME: "optimistic-token-voting",
  PLUGIN_CONTRACT_NAME: "OptimisticTokenVoting",
  PLUGIN_SETUP_CONTRACT_NAME: "OptimisticTokenVotingSetup",
  VERSION: {
    release: 1, // Increment this number ONLY if breaking/incompatible changes were made. Updates between releases are NOT possible.
    build: 1, // Increment this number if non-breaking/compatible changes were made. Updates to newer builds are possible.
  },
  METADATA: {
    build: pluginBuildMetadata,
    release: pluginReleaseMetadata,
  },
};

// Types

export type PluginSetupParams = {
  PLUGIN_REPO_ENS_NAME: string;
  PLUGIN_CONTRACT_NAME: string;
  PLUGIN_SETUP_CONTRACT_NAME: string;
  VERSION: {
    release: number;
    build: number;
  };
  METADATA: {
    build: { [k: string]: any };
    release: { [k: string]: any };
  };
};
