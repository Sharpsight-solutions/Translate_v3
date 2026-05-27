// Stub file for Windows compatibility (original filename contains asterisks)
// This replaces: image.stability.sd3-*.ts

import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";

import {
	aws_stepfunctions as sfn,
	aws_s3 as s3,
} from "aws-cdk-lib";

import { dt_stepfunction } from "../../../components/stepfunction";

export interface props {
	bedrockRegion: string;
	contentBucket: s3.Bucket;
	removalPolicy: cdk.RemovalPolicy;
}

export class dt_readableWorkflow extends Construct {
	public readonly sfnMain: sfn.StateMachine;
	public readonly invokeModel: sfn.IChainable;
	public readonly modelChoiceCondition: sfn.Condition;

	constructor(scope: Construct, id: string, props: props) {
		super(scope, id);

		this.modelChoiceCondition = sfn.Condition.or(
			sfn.Condition.stringMatches("$.modelId", "stability.sd3-*"),
		);

		const invokeBedrockTask = new sfn.Pass(this, "invokeBedrockSD3", {
			comment: "Stub - invoke Bedrock Stable Diffusion 3",
		});

		this.invokeModel = invokeBedrockTask;

		this.sfnMain = new dt_stepfunction(
			this,
			`${cdk.Stack.of(this).stackName}_ReadableSD3`,
			{
				nameSuffix: "ReadableSD3",
				removalPolicy: props.removalPolicy,
				definition: invokeBedrockTask,
			},
		).StateMachine;
	}
}
