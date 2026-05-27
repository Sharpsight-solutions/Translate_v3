// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";

import {
	aws_dynamodb as dynamodb,
	aws_s3 as s3,
	aws_s3_notifications as s3n,
	aws_iam as iam,
} from "aws-cdk-lib";
import { dt_lambda } from "../../components/lambda";

export interface props {
	contentBucket: s3.Bucket;
	jobTable: dynamodb.Table;
	removalPolicy: cdk.RemovalPolicy;
	s3PrefixPrivate: string;
}

export class dt_translationPdfAndWordCount extends Construct {
	constructor(scope: Construct, id: string, props: props) {
		super(scope, id);

		// PDF CONVERSION LAMBDA
		const pdfConversionLambda = new dt_lambda(this, "pdfConversionLambda", {
			path: "lambda/pdfConversion",
			description: "PDF to text conversion via AWS Textract",
			environment: {
				JOB_TABLE_NAME: props.jobTable.tableName,
				PDF_MAX_SIZE_BYTES: "4194304",
			},
			bundlingNodeModules: ["pdf-parse"],
			timeout: cdk.Duration.minutes(5),
		});

		// PDF CONVERSION LAMBDA | PERMISSIONS
		props.contentBucket.grantReadWrite(pdfConversionLambda.lambdaFunction);
		props.jobTable.grantWriteData(pdfConversionLambda.lambdaFunction);
		pdfConversionLambda.lambdaFunction.addToRolePolicy(
			new iam.PolicyStatement({
				actions: ["textract:DetectDocumentText"],
				resources: ["*"],
			})
		);
		NagSuppressions.addResourceSuppressions(
			pdfConversionLambda.lambdaRole,
			[
				{
					id: "AwsSolutions-IAM5",
					reason:
						"Textract DetectDocumentText does not support resource-level permissions. S3 scoped to content bucket.",
				},
			],
			true
		);

		// PDF CONVERSION LAMBDA | S3 TRIGGER
		props.contentBucket.addEventNotification(
			s3.EventType.OBJECT_CREATED,
			new s3n.LambdaDestination(pdfConversionLambda.lambdaFunction),
			{
				prefix: `${props.s3PrefixPrivate}/`,
				suffix: ".pdf",
			}
		);

		// WORD COUNT LAMBDA
		const wordCountLambda = new dt_lambda(this, "wordCountLambda", {
			path: "lambda/wordCount",
			description: "Source document word count capture",
			environment: {
				JOB_TABLE_NAME: props.jobTable.tableName,
			},
			bundlingNodeModules: ["mammoth", "xlsx"],
			timeout: cdk.Duration.minutes(2),
		});

		// WORD COUNT LAMBDA | PERMISSIONS
		props.contentBucket.grantRead(wordCountLambda.lambdaFunction);
		props.jobTable.grantWriteData(wordCountLambda.lambdaFunction);
		NagSuppressions.addResourceSuppressions(
			wordCountLambda.lambdaRole,
			[
				{
					id: "AwsSolutions-IAM5",
					reason: "S3 read scoped to content bucket. DDB write scoped to job table.",
				},
			],
			true
		);

		// WORD COUNT LAMBDA | S3 TRIGGERS
		// Trigger on .txt files (includes PDF-converted output)
		props.contentBucket.addEventNotification(
			s3.EventType.OBJECT_CREATED,
			new s3n.LambdaDestination(wordCountLambda.lambdaFunction),
			{
				prefix: `${props.s3PrefixPrivate}/`,
				suffix: ".txt",
			}
		);
		// Trigger on .docx files
		props.contentBucket.addEventNotification(
			s3.EventType.OBJECT_CREATED,
			new s3n.LambdaDestination(wordCountLambda.lambdaFunction),
			{
				prefix: `${props.s3PrefixPrivate}/`,
				suffix: ".docx",
			}
		);
		// Trigger on .html files
		props.contentBucket.addEventNotification(
			s3.EventType.OBJECT_CREATED,
			new s3n.LambdaDestination(wordCountLambda.lambdaFunction),
			{
				prefix: `${props.s3PrefixPrivate}/`,
				suffix: ".html",
			}
		);
		// Trigger on .xlsx files
		props.contentBucket.addEventNotification(
			s3.EventType.OBJECT_CREATED,
			new s3n.LambdaDestination(wordCountLambda.lambdaFunction),
			{
				prefix: `${props.s3PrefixPrivate}/`,
				suffix: ".xlsx",
			}
		);

		// END
	}
}
