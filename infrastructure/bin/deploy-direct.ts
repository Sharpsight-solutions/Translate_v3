// Direct deployment entry point (bypasses CodePipeline)
// Usage: npx cdk deploy --app "npx ts-node bin/deploy-direct.ts" --all

import * as cdk from "aws-cdk-lib";
import { AwsSolutionsChecks } from "cdk-nag";
import { DocTranStack } from "../lib/doctran-stack";
import { Config } from "../lib/types";
import { loadConfig } from "../util/loadConfig";

const config: Config = loadConfig();

const app = new cdk.App();
const stackName = `DocTran-${config.common.instance.name}-app`;
new DocTranStack(app, stackName, {
	stackName,
	description: `(uksb-1tthgi813) (tag:app)${
		config.app.translation.enable ? " (tag:translation)" : ""
	}${config.app.readable.enable ? " (tag:readable)" : ""}${
		config.app.webUi.enable ? " (tag:webui)" : ""
	}`,
	env: {
		account: process.env.CDK_DEFAULT_ACCOUNT,
		region: process.env.CDK_DEFAULT_REGION,
	},
});

// Skip NAG for faster development
const skipNag: boolean =
	process.env.skipNag !== undefined
		? process.env.skipNag.toLowerCase() === "true"
		: true;

if (!skipNag) {
	cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
} else {
	console.warn("\nSkipping cdk-nag for direct deployment\n");
}

app.synth();
