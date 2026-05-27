// Stub file for Windows compatibility (original filename contains asterisks)
// This replaces: text.anthropic.claude-3-*-*-v1.ts

import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";

import {
	aws_stepfunctions as sfn,
	aws_lambda as lambda,
} from "aws-cdk-lib";

import { dt_stepfunction } from "../../../components/stepfunction";
import { dt_lambda } from "../../../components/lambda";

export interface props {
	invokeBedrockLambda: lambda.Function;
	removalPolicy: cdk.RemovalPolicy;
}

export class dt_readableWorkflow extends Construct {
	public readonly sfnMain: sfn.StateMachine;
	public readonly invokeModel: sfn.IChainable;
	public readonly modelChoiceCondition: sfn.Condition;

	constructor(scope: Construct, id: string, props: props) {
		super(scope, id);

		this.modelChoiceCondition = sfn.Condition.or(
			sfn.Condition.stringMatches("$.modelId", "anthropic.claude-3-*"),
		);

		const invokeBedrockTask = new sfn.Pass(this, "invokeBedrockClaude3", {
			comment: "Stub - invoke Bedrock Claude 3",
		});

		this.invokeModel = invokeBedrockTask;

		this.sfnMain = new dt_stepfunction(
			this,
			`${cdk.Stack.of(this).stackName}_ReadableClaude3`,
			{
				nameSuffix: "ReadableClaude3",
				removalPolicy: props.removalPolicy,
				definition: invokeBedrockTask,
			},
		).StateMachine;
	}
}
