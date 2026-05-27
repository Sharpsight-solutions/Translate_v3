// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import { NagSuppressions } from "cdk-nag";

import {
	aws_dynamodb as dynamodb,
	aws_s3 as s3,
	aws_iam as iam,
	aws_stepfunctions as sfn,
	aws_appsync as appsync,
} from "aws-cdk-lib";
import * as identitypool from "@aws-cdk/aws-cognito-identitypool-alpha";
import { dt_translationPii } from "./pii";
import { dt_translationTag } from "./tag";
import { dt_translationTranslate } from "./translate";
import { dt_translationErrors } from "./errors";
import { dt_translationLifecycle } from "./lifecycle";
import { dt_translationMain } from "./main";
import { dt_translationPdfAndWordCount } from "./pdfAndWordCount";
import {
	CodeFirstSchema,
	GraphqlType,
	ObjectType as OutputType,
	InputType,
	ResolvableField,
	Directive,
} from "awscdk-appsync-utils";

const namedStrings: { [key: string]: string } = {
	attributeForJobStatus: "jobStatus",
	attributeForPiiCallback: "piiCallback",
	attributeForPiiStatus: "piiStatus",
	attributeSafePrefix: "lang",
	keySuffix: "Key",
	mapForTranslateCallback: "translateCallback",
	mapForTranslateKey: "translateKey",
	mapForTranslateStatus: "translateStatus",
	s3StageOutput: "output",
	s3StageUpload: "upload",
	s3StageExpired: "expired",
	tagPii: "PII",
	tagPiiValueFalse: "False",
	tagPiiValueTrue: "True",
};

export interface props {
	serverAccessLoggingBucket: s3.Bucket;
	contentLifecycleDefault: number;
	contentLifecyclePii: number;
	s3PrefixPrivate: string;
	identityPool: identitypool.IdentityPool;
	api: appsync.GraphqlApi;
	apiSchema: CodeFirstSchema;
	translationPii: boolean;
	removalPolicy: cdk.RemovalPolicy;
}

export class dt_translate extends Construct {
	public readonly contentBucket: s3.Bucket;
	public readonly jobTable: dynamodb.Table;

	constructor(scope: Construct, id: string, props: props) {
		super(scope, id);

		//
		// INFRA
		//
		// INFRA | S3 | CONTENT
		this.contentBucket = new s3.Bucket(this, "contentBucket", {
			objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
			blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL, // ASM-S2
			encryption: s3.BucketEncryption.S3_MANAGED, // ASM-S3
			enforceSSL: true, // ASM-S10
			versioned: true,
			serverAccessLogsBucket: props.serverAccessLoggingBucket, // ASM-S1
			serverAccessLogsPrefix: "content-bucket/", // ASM-S1
			removalPolicy: props.removalPolicy, // ASM-CFN1
			cors: [
				{
					allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.POST],
					allowedOrigins: ["*"],
					allowedHeaders: ["*"],
					exposedHeaders: ["ETag"],
				},
			],
		});
		// INFRA | S3 | CONTENT | LIFECYCLE RULES
		// INFRA | S3 | CONTENT | LIFECYCLE RULES | DEFAULT
		this.contentBucket.addLifecycleRule({
			id: "default",
			enabled: true,
			expiration: cdk.Duration.days(props.contentLifecycleDefault),
			noncurrentVersionExpiration: cdk.Duration.days(
				props.contentLifecycleDefault,
			),
			abortIncompleteMultipartUploadAfter: cdk.Duration.days(
				props.contentLifecycleDefault,
			),
		});
		// INFRA | S3 | API ROLE PERMISSION
		const policyAuthenticatedPermitScopedS3 = new iam.Policy(
			this,
			"policyAuthenticatedPermitScopedS3",
			{
				policyName: "Get-and-Put-Objects-in-Cognito-scoped-Content-Bucket-keys",
				statements: [
					new iam.PolicyStatement({
						// ASM-IAM // ASM-COG7
						actions: ["s3:PutObject", "s3:GetObject"],
						resources: [
							`${this.contentBucket.bucketArn}/${props.s3PrefixPrivate}/\${cognito-identity.amazonaws.com:sub}/*`,
						],
					}),
				],
			},
		);
		props.identityPool.authenticatedRole.attachInlinePolicy(
			policyAuthenticatedPermitScopedS3,
		);
		NagSuppressions.addResourceSuppressions(
			policyAuthenticatedPermitScopedS3,
			[
				{
					id: "AwsSolutions-IAM5",
					reason: "Scoped to Cognito identity. Unknown file names uploaded",
					appliesTo: [
						"Action::s3:PutObject",
						"Action::s3:GetObject",
						`Resource::<${cdk.Stack.of(this).getLogicalId(
							this.contentBucket.node.defaultChild as cdk.CfnElement,
						)}.Arn>/private/<cognito-identity.amazonaws.com:sub>/*`,
					],
				},
			],
			true,
		);

		// INFRA | QUICK TEXT TRANSLATION ROLE
		const policyAuthenticatedPermitQuickTextTranslation = new iam.Policy(
			this,
			"policyAuthenticatedPermitQuickTextTranslation",
			{
				policyName: "Translate-Text-Comprehend-Detect-Dominate",
				statements: [
					new iam.PolicyStatement({
						// ASM-IAM // ASM-COG7
						actions: [
							"translate:TranslateText",
							"comprehend:DetectDominantLanguage",
							"comprehend:DetectPiiEntities",
							"bedrock:InvokeModel",
							"aws-marketplace:ViewSubscriptions",
							"aws-marketplace:Subscribe",
							"cognito-idp:ListUsers",
						],
						resources: ["*"],
					}),
				],
			},
		);
		props.identityPool.authenticatedRole.attachInlinePolicy(
			policyAuthenticatedPermitQuickTextTranslation,
		);
		NagSuppressions.addResourceSuppressions(
			policyAuthenticatedPermitQuickTextTranslation,
			[
				{
					id: "AwsSolutions-IAM5",
					reason: "Action does not apply to a resource. Restricted by action.",
					appliesTo: [
						"Action::translate:TranslateText",
						"Action::comprehend:DetectDominantLanguage",
						"Action::comprehend:DetectPiiEntities",
						"Action::bedrock:InvokeModel",
						"Action::aws-marketplace:ViewSubscriptions",
						"Action::aws-marketplace:Subscribe",
						"Action::cognito-idp:ListUsers",
						"Resource::*",
					],
				},
			],
			true,
		);

		// INFRA | QUICK DOCUMENT TRANSLATION ROLE
		const policyAuthenticatedPermitQuickDocumentTranslation = new iam.Policy(
			this,
			"policyAuthenticatedPermitQuickDocumentTranslation",
			{
				policyName: "Translate-Document",
				statements: [
					new iam.PolicyStatement({
						// ASM-IAM // ASM-COG7
						actions: [
							"translate:TranslateDocument",
							"translate:ListTerminologies",
						],
						resources: ["*"],
					}),
				],
			},
		);
		props.identityPool.authenticatedRole.attachInlinePolicy(
			policyAuthenticatedPermitQuickDocumentTranslation,
		);
		NagSuppressions.addResourceSuppressions(
			policyAuthenticatedPermitQuickDocumentTranslation,
			[
				{
					id: "AwsSolutions-IAM5",
					reason: "Action does not apply to a resource. Restricted by action.",
					appliesTo: [
						"Action::translate:TranslateDocument",
						"Action::translate:ListTerminologies",
						"Resource::*",
					],
				},
			],
			true,
		);

		// INFRA | DYNAMODB
		// INFRA | DYNAMODB | JOBS
		this.jobTable = new dynamodb.Table(this, "jobTable", {
			partitionKey: {
				name: "id",
				type: dynamodb.AttributeType.STRING,
			},
			stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
			billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
			tableClass: dynamodb.TableClass.STANDARD_INFREQUENT_ACCESS,
			pointInTimeRecovery: true, // ASM-DDB3
			removalPolicy: props.removalPolicy, // ASM-CFN1
		});

		// DYNAMODB | INDEX
		const GSI_OWNER = "byOwnerAndCreatedAt";
		const GSI_OWNER_PK = "jobOwner";
		const GSI_OWNER_SK = "createdAt";
		this.jobTable.addGlobalSecondaryIndex({
			indexName: GSI_OWNER,
			partitionKey: {
				name: GSI_OWNER_PK,
				type: dynamodb.AttributeType.STRING,
			},
			sortKey: {
				name: GSI_OWNER_SK, // TODO variableise me
				type: dynamodb.AttributeType.NUMBER,
			},
			projectionType: dynamodb.ProjectionType.INCLUDE,
			nonKeyAttributes: [
				"id", // TODO variableise me
				"jobName", // TODO variableise me
				"jobStatus", // TODO variableise me
				"languageSource", // TODO variableise me
				"languageTargets", // TODO variableise me
				"translateKey", // TODO variableise me
				"wordCount",
				"jobError",
			],
		});

		// API | DATA SOURCE
		const FEATURE_PREFIX = "translation";
		const apiDsJobTable = props.api.addDynamoDbDataSource(
			`${FEATURE_PREFIX}JobTable`,
			this.jobTable,
		);
		NagSuppressions.addResourceSuppressions(
			props.api,
			[
				{
					id: "AwsSolutions-IAM5",
					reason: "Permission is scoped to dedicated DDB table",
					appliesTo: [
						`Resource::<${cdk.Stack.of(this).getLogicalId(
							this.jobTable.node.defaultChild as cdk.CfnElement,
						)}.Arn>/index/*`,
					],
				},
			],
			true,
		);

		// API | QUERY
		// API | QUERY listJobs
		// INPUT
		// NA
		// OUTPUT
		const listJobs_output_item = new OutputType(
			`${FEATURE_PREFIX}_listJobs_output_item`,
			{
				definition: {
					jobOwner: GraphqlType.string({ isRequired: true }),
					createdAt: GraphqlType.awsTimestamp({ isRequired: true }),
					id: GraphqlType.id(),
					jobName: GraphqlType.string(),
					jobStatus: GraphqlType.string(),
					languageSource: GraphqlType.string(),
					languageTargets: GraphqlType.awsJson(),
					translateKey: GraphqlType.awsJson(),
					wordCount: GraphqlType.int(),
					jobError: GraphqlType.string(),
					completedAt: GraphqlType.string(),
					costCategory: GraphqlType.string(),
					teamName: GraphqlType.string(),
					operationalArea: GraphqlType.string(),
				},
				directives: [Directive.custom("@aws_cognito_user_pools")],
			},
		);
		const listJobs_output = new OutputType(
			`${FEATURE_PREFIX}_listJobs_output`,
			{
				definition: {
					items: listJobs_output_item.attribute({ isList: true }),
					nextToken: GraphqlType.string(),
				},
				directives: [Directive.custom("@aws_cognito_user_pools")],
			},
		);
		props.apiSchema.addType(listJobs_output_item);
		props.apiSchema.addType(listJobs_output);

		// QUERY
		const listJobsQuery = new ResolvableField({
			returnType: listJobs_output.attribute(),
			dataSource: apiDsJobTable,
			args: {
				limit: GraphqlType.int(),
				nextToken: GraphqlType.string(),
			},
			requestMappingTemplate: appsync.MappingTemplate.fromString(`
				{
					"version" : "2017-02-28",
					"operation" : "Query",
					"index": "${GSI_OWNER}",
					"query": {
						"expression": "#owner = :sub",
						"expressionNames": {
							"#owner": "${GSI_OWNER_PK}"
						},
						"expressionValues": {
							":sub": $util.dynamodb.toDynamoDBJson($ctx.identity.sub)
						}
					},
					"scanIndexForward": false
				}
			`),
			responseMappingTemplate: appsync.MappingTemplate.fromString(`
				{
					"items": $util.toJson($ctx.result.items),
					"nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
				}
			`),
			directives: [Directive.custom("@aws_cognito_user_pools")],
		});
		props.apiSchema.addQuery(`${FEATURE_PREFIX}ListJobs`, listJobsQuery);

		// API | QUERY listAllJobs (admin only)
		// OUTPUT - reuses listJobs_output_item
		const listAllJobs_output = new OutputType(
			`${FEATURE_PREFIX}_listAllJobs_output`,
			{
				definition: {
					items: listJobs_output_item.attribute({ isList: true }),
					nextToken: GraphqlType.string(),
				},
				directives: [Directive.custom("@aws_cognito_user_pools")],
			},
		);
		props.apiSchema.addType(listAllJobs_output);

		// QUERY
		const listAllJobsQuery = new ResolvableField({
			returnType: listAllJobs_output.attribute(),
			dataSource: apiDsJobTable,
			args: {
				limit: GraphqlType.int(),
				nextToken: GraphqlType.string(),
			},
			requestMappingTemplate: appsync.MappingTemplate.fromString(`
				## Only allow admin group members
				#set($groups = $ctx.identity.claims.get("cognito:groups"))
				#if(!$groups.contains("admin"))
					$util.unauthorized()
				#end
				{
					"version": "2017-02-28",
					"operation": "Scan",
					#if($ctx.args.limit)
						"limit": $ctx.args.limit,
					#end
					#if($ctx.args.nextToken)
						"nextToken": "$ctx.args.nextToken",
					#end
				}
			`),
			responseMappingTemplate: appsync.MappingTemplate.fromString(`
				{
					"items": $util.toJson($ctx.result.items),
					"nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
				}
			`),
			directives: [Directive.custom("@aws_cognito_user_pools")],
		});
		props.apiSchema.addQuery(`${FEATURE_PREFIX}ListAllJobs`, listAllJobsQuery);

		// API | MUTATION
		// API | MUTATION createJob
		// INPUT
		const createJob_input = new InputType(`${FEATURE_PREFIX}_createJob_input`, {
			definition: {
				contentType: GraphqlType.string({ isRequired: true }),
				createdAt: GraphqlType.awsTimestamp(),
				id: GraphqlType.id({ isRequired: true }),
				jobIdentity: GraphqlType.string({ isRequired: true }),
				jobName: GraphqlType.string({ isRequired: true }),
				jobOwner: GraphqlType.string(),
				jobStatus: GraphqlType.string(),
				languageSource: GraphqlType.string({ isRequired: true }),
				languageTargets: GraphqlType.awsJson(),
				sourceKey: GraphqlType.string(),
				sourceStatus: GraphqlType.string(),
				translateCallback: GraphqlType.awsJson(),
				translateKey: GraphqlType.awsJson(),
				translateStatus: GraphqlType.awsJson(),
				wordCount: GraphqlType.int(),
				costCategory: GraphqlType.string(),
				teamName: GraphqlType.string(),
				operationalArea: GraphqlType.string(),
			},
			directives: [Directive.custom("@aws_cognito_user_pools")],
		});
		props.apiSchema.addType(createJob_input);

		// OUTPUT
		const createJob_output = new OutputType(
			`${FEATURE_PREFIX}_createJob_output`,
			{
				definition: {
					contentType: GraphqlType.string({ isRequired: true }),
					createdAt: GraphqlType.awsTimestamp(),
					id: GraphqlType.id({ isRequired: true }),
					jobIdentity: GraphqlType.string({ isRequired: true }),
					jobName: GraphqlType.string({ isRequired: true }),
					jobOwner: GraphqlType.string(),
					jobStatus: GraphqlType.string(),
					languageSource: GraphqlType.string({ isRequired: true }),
					languageTargets: GraphqlType.awsJson(),
					sourceKey: GraphqlType.string(),
					sourceStatus: GraphqlType.string(),
					translateCallback: GraphqlType.awsJson(),
					translateKey: GraphqlType.awsJson(),
					translateStatus: GraphqlType.awsJson(),
					wordCount: GraphqlType.int(),
					jobError: GraphqlType.string(),
				},
				directives: [Directive.custom("@aws_cognito_user_pools")],
			},
		);
		props.apiSchema.addType(createJob_output);

		// MUTATION
		const createJobMutation = new ResolvableField({
			returnType: createJob_output.attribute(),
			args: {
				limit: GraphqlType.int(),
				nextToken: GraphqlType.string(),
				input: createJob_input.attribute(),
			},
			dataSource: apiDsJobTable,
			requestMappingTemplate: appsync.MappingTemplate.fromString(`
				#set($input = $ctx.args.input)
				#set($input.jobOwner = $ctx.identity.sub)

				#set($input.createdAt = $util.time.nowEpochSeconds())

				{
					"version": "2017-02-28",
					"operation": "PutItem",
					"key" : {
						"id" : $util.dynamodb.toDynamoDBJson($ctx.args.input.id)
					},
					"attributeValues": $util.dynamodb.toMapValuesJson($input)
				}
			`),
			responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
			directives: [Directive.custom("@aws_cognito_user_pools")],
		});

		props.apiSchema.addMutation(
			`${FEATURE_PREFIX}CreateJob`,
			createJobMutation,
		);

		//
		// REDACTION LOG
		//
		// REDACTION LOG | DYNAMODB
		const redactionLogTable = new dynamodb.Table(this, "redactionLogTable", {
			partitionKey: {
				name: "id",
				type: dynamodb.AttributeType.STRING,
			},
			billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
			tableClass: dynamodb.TableClass.STANDARD_INFREQUENT_ACCESS,
			pointInTimeRecovery: true,
			removalPolicy: props.removalPolicy,
		});

		// REDACTION LOG | GSI
		const REDACTION_GSI = "byCreatedAt";
		redactionLogTable.addGlobalSecondaryIndex({
			indexName: REDACTION_GSI,
			partitionKey: {
				name: "logType",
				type: dynamodb.AttributeType.STRING,
			},
			sortKey: {
				name: "createdAt",
				type: dynamodb.AttributeType.NUMBER,
			},
			projectionType: dynamodb.ProjectionType.ALL,
		});

		// REDACTION LOG | API DATA SOURCE
		const REDACTION_PREFIX = "redaction";
		const apiDsRedactionLogTable = props.api.addDynamoDbDataSource(
			`${REDACTION_PREFIX}LogTable`,
			redactionLogTable,
		);
		NagSuppressions.addResourceSuppressions(
			props.api,
			[
				{
					id: "AwsSolutions-IAM5",
					reason: "Permission is scoped to dedicated DDB table",
					appliesTo: [
						`Resource::<${cdk.Stack.of(this).getLogicalId(
							redactionLogTable.node.defaultChild as cdk.CfnElement,
						)}.Arn>/index/*`,
					],
				},
			],
			true,
		);

		// REDACTION LOG | MUTATION createRedactionLog
		const createRedactionLog_input = new InputType(
			`${REDACTION_PREFIX}_createLog_input`,
			{
				definition: {
					id: GraphqlType.id({ isRequired: true }),
					mode: GraphqlType.string({ isRequired: true }),
					wordCount: GraphqlType.int(),
					entitiesDetected: GraphqlType.int(),
					entitiesRedacted: GraphqlType.int(),
					categories: GraphqlType.awsJson(),
				},
				directives: [Directive.custom("@aws_cognito_user_pools")],
			},
		);
		props.apiSchema.addType(createRedactionLog_input);

		const createRedactionLog_output = new OutputType(
			`${REDACTION_PREFIX}_createLog_output`,
			{
				definition: {
					id: GraphqlType.id({ isRequired: true }),
					userSub: GraphqlType.string(),
					mode: GraphqlType.string(),
					wordCount: GraphqlType.int(),
					entitiesDetected: GraphqlType.int(),
					entitiesRedacted: GraphqlType.int(),
					categories: GraphqlType.awsJson(),
					createdAt: GraphqlType.awsTimestamp(),
				},
				directives: [Directive.custom("@aws_cognito_user_pools")],
			},
		);
		props.apiSchema.addType(createRedactionLog_output);

		const createRedactionLogMutation = new ResolvableField({
			returnType: createRedactionLog_output.attribute(),
			args: {
				input: createRedactionLog_input.attribute(),
			},
			dataSource: apiDsRedactionLogTable,
			requestMappingTemplate: appsync.MappingTemplate.fromString(`
				#set($input = $ctx.args.input)
				#set($input.userSub = $ctx.identity.sub)
				#set($input.createdAt = $util.time.nowEpochSeconds())
				#set($input.logType = "redaction")
				{
					"version": "2017-02-28",
					"operation": "PutItem",
					"key": {
						"id": $util.dynamodb.toDynamoDBJson($ctx.args.input.id)
					},
					"attributeValues": $util.dynamodb.toMapValuesJson($input)
				}
			`),
			responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
			directives: [Directive.custom("@aws_cognito_user_pools")],
		});
		props.apiSchema.addMutation(
			`${REDACTION_PREFIX}CreateLog`,
			createRedactionLogMutation,
		);

		// REDACTION LOG | QUERY listRedactionLogs (admin only)
		const listRedactionLogs_output = new OutputType(
			`${REDACTION_PREFIX}_listLogs_output`,
			{
				definition: {
					items: createRedactionLog_output.attribute({ isList: true }),
					nextToken: GraphqlType.string(),
				},
				directives: [Directive.custom("@aws_cognito_user_pools")],
			},
		);
		props.apiSchema.addType(listRedactionLogs_output);

		const listRedactionLogsQuery = new ResolvableField({
			returnType: listRedactionLogs_output.attribute(),
			dataSource: apiDsRedactionLogTable,
			args: {
				limit: GraphqlType.int(),
				nextToken: GraphqlType.string(),
			},
			requestMappingTemplate: appsync.MappingTemplate.fromString(`
				## Only allow admin group members
				#set($groups = $ctx.identity.claims.get("cognito:groups"))
				#if(!$groups.contains("admin"))
					$util.unauthorized()
				#end
				{
					"version": "2017-02-28",
					"operation": "Query",
					"index": "${REDACTION_GSI}",
					"query": {
						"expression": "#lt = :lt",
						"expressionNames": {
							"#lt": "logType"
						},
						"expressionValues": {
							":lt": $util.dynamodb.toDynamoDBJson("redaction")
						}
					},
					"scanIndexForward": false
				}
			`),
			responseMappingTemplate: appsync.MappingTemplate.fromString(`
				{
					"items": $util.toJson($ctx.result.items),
					"nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
				}
			`),
			directives: [Directive.custom("@aws_cognito_user_pools")],
		});
		props.apiSchema.addQuery(
			`${REDACTION_PREFIX}ListLogs`,
			listRedactionLogsQuery,
		);

		//
		// FEEDBACK
		//
		// FEEDBACK | DYNAMODB
		const feedbackTable = new dynamodb.Table(this, "feedbackTable", {
			partitionKey: {
				name: "id",
				type: dynamodb.AttributeType.STRING,
			},
			billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
			tableClass: dynamodb.TableClass.STANDARD_INFREQUENT_ACCESS,
			pointInTimeRecovery: true,
			removalPolicy: props.removalPolicy,
		});

		const FEEDBACK_GSI = "byCreatedAt";
		feedbackTable.addGlobalSecondaryIndex({
			indexName: FEEDBACK_GSI,
			partitionKey: {
				name: "logType",
				type: dynamodb.AttributeType.STRING,
			},
			sortKey: {
				name: "createdAt",
				type: dynamodb.AttributeType.NUMBER,
			},
			projectionType: dynamodb.ProjectionType.ALL,
		});

		// FEEDBACK | API DATA SOURCE
		const FEEDBACK_PREFIX = "feedback";
		const apiDsFeedbackTable = props.api.addDynamoDbDataSource(
			`${FEEDBACK_PREFIX}Table`,
			feedbackTable,
		);
		NagSuppressions.addResourceSuppressions(
			props.api,
			[
				{
					id: "AwsSolutions-IAM5",
					reason: "Permission is scoped to dedicated DDB table",
					appliesTo: [
						`Resource::<${cdk.Stack.of(this).getLogicalId(
							feedbackTable.node.defaultChild as cdk.CfnElement,
						)}.Arn>/index/*`,
					],
				},
			],
			true,
		);

		// FEEDBACK | MUTATION
		const feedbackCreate_input = new InputType(
			`${FEEDBACK_PREFIX}_create_input`,
			{
				definition: {
					id: GraphqlType.id({ isRequired: true }),
					feature: GraphqlType.string({ isRequired: true }),
					rating: GraphqlType.string({ isRequired: true }),
					jobId: GraphqlType.string(),
				},
				directives: [Directive.custom("@aws_cognito_user_pools")],
			},
		);
		props.apiSchema.addType(feedbackCreate_input);

		const feedbackCreate_output = new OutputType(
			`${FEEDBACK_PREFIX}_create_output`,
			{
				definition: {
					id: GraphqlType.id({ isRequired: true }),
					userSub: GraphqlType.string(),
					feature: GraphqlType.string(),
					rating: GraphqlType.string(),
					jobId: GraphqlType.string(),
					createdAt: GraphqlType.awsTimestamp(),
				},
				directives: [Directive.custom("@aws_cognito_user_pools")],
			},
		);
		props.apiSchema.addType(feedbackCreate_output);

		const feedbackCreateMutation = new ResolvableField({
			returnType: feedbackCreate_output.attribute(),
			args: { input: feedbackCreate_input.attribute() },
			dataSource: apiDsFeedbackTable,
			requestMappingTemplate: appsync.MappingTemplate.fromString(`
				#set($input = $ctx.args.input)
				#set($input.userSub = $ctx.identity.sub)
				#set($input.createdAt = $util.time.nowEpochSeconds())
				#set($input.logType = "feedback")
				{
					"version": "2017-02-28",
					"operation": "PutItem",
					"key": { "id": $util.dynamodb.toDynamoDBJson($ctx.args.input.id) },
					"attributeValues": $util.dynamodb.toMapValuesJson($input)
				}
			`),
			responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem(),
			directives: [Directive.custom("@aws_cognito_user_pools")],
		});
		props.apiSchema.addMutation(`${FEEDBACK_PREFIX}Create`, feedbackCreateMutation);

		// FEEDBACK | QUERY (admin only)
		const feedbackList_output = new OutputType(
			`${FEEDBACK_PREFIX}_list_output`,
			{
				definition: {
					items: feedbackCreate_output.attribute({ isList: true }),
					nextToken: GraphqlType.string(),
				},
				directives: [Directive.custom("@aws_cognito_user_pools")],
			},
		);
		props.apiSchema.addType(feedbackList_output);

		const feedbackListQuery = new ResolvableField({
			returnType: feedbackList_output.attribute(),
			dataSource: apiDsFeedbackTable,
			requestMappingTemplate: appsync.MappingTemplate.fromString(`
				#set($groups = $ctx.identity.claims.get("cognito:groups"))
				#if(!$groups.contains("admin"))
					$util.unauthorized()
				#end
				{
					"version": "2017-02-28",
					"operation": "Query",
					"index": "${FEEDBACK_GSI}",
					"query": {
						"expression": "#lt = :lt",
						"expressionNames": { "#lt": "logType" },
						"expressionValues": { ":lt": $util.dynamodb.toDynamoDBJson("feedback") }
					},
					"scanIndexForward": false
				}
			`),
			responseMappingTemplate: appsync.MappingTemplate.fromString(`
				{
					"items": $util.toJson($ctx.result.items),
					"nextToken": $util.toJson($util.defaultIfNullOrBlank($context.result.nextToken, null))
				}
			`),
			directives: [Directive.custom("@aws_cognito_user_pools")],
		});
		props.apiSchema.addQuery(`${FEEDBACK_PREFIX}List`, feedbackListQuery);

		//
		// STATE MACHINE
		//
		// stepFunctionArns
		const handleErrorsFromSfnArns: string[] = [];
		// STATE MACHINE | TRANSLATE
		const featTranslationTranslate = new dt_translationTranslate(
			this,
			"featTranslationTranslate",
			{
				namedStrings,
				contentBucket: this.contentBucket,
				jobTable: this.jobTable,
				removalPolicy: props.removalPolicy,
				s3PrefixPrivate: props.s3PrefixPrivate,
			},
		);

		let sfnPii: undefined | sfn.StateMachine = undefined;
		let sfnTag: undefined | sfn.StateMachine = undefined;
		if (props.translationPii) {
			// INFRA | S3 | CONTENT | LIFECYCLE RULES | PII
			this.contentBucket.addLifecycleRule({
				id: "pii",
				enabled: true,
				expiration: cdk.Duration.days(props.contentLifecyclePii),
				noncurrentVersionExpiration: cdk.Duration.days(
					props.contentLifecyclePii,
				),
				abortIncompleteMultipartUploadAfter: cdk.Duration.days(
					props.contentLifecyclePii,
				),
			});
			// STATE MACHINE | PII
			const featTranslationPii = new dt_translationPii(
				this,
				"featTranslationPii",
				{
					namedStrings,
					contentBucket: this.contentBucket,
					jobTable: this.jobTable,
					removalPolicy: props.removalPolicy, // ASM-CFN1
					s3PrefixPrivate: props.s3PrefixPrivate,
				},
			);
			sfnPii = featTranslationPii.sfnMain;

			// STATE MACHINE | PII
			const featTranslationTag = new dt_translationTag(
				this,
				"featTranslationTag",
				{
					namedStrings,
					contentBucket: this.contentBucket,
					removalPolicy: props.removalPolicy, // ASM-CFN1
				},
			);
			sfnTag = featTranslationTag.sfnMain;
		}

		// STATE MACHINE | MAIN
		const featTranslationMain = new dt_translationMain(
			this,
			"featTranslationMain",
			{
				namedStrings,
				jobTable: this.jobTable,
				contentBucket: this.contentBucket,
				s3PrefixPrivate: props.s3PrefixPrivate,
				removalPolicy: props.removalPolicy, // ASM-CFN1
				sfnTranslate: featTranslationTranslate.sfnMain,
				sfnPii,
				sfnTag,
			},
		);
		handleErrorsFromSfnArns.push(featTranslationMain.sfnMain.stateMachineArn);

		// STATE MACHINE | ERRORS
		new dt_translationErrors(this, "featTranslationErrors", {
			namedStrings,
			s3PrefixPrivate: props.s3PrefixPrivate,
			removalPolicy: props.removalPolicy, // ASM-CFN1
			stepFunctionArns: handleErrorsFromSfnArns,
			contentBucket: this.contentBucket,
			jobTable: this.jobTable,
		});

		// STATE MACHINE | LIFECYCLE
		new dt_translationLifecycle(this, "featTranslationLifecycle", {
			namedStrings,
			removalPolicy: props.removalPolicy, // ASM-CFN1
			contentBucket: this.contentBucket,
			jobTable: this.jobTable,
		});

		// PDF CONVERSION & WORD COUNT
		new dt_translationPdfAndWordCount(this, "featPdfAndWordCount", {
			contentBucket: this.contentBucket,
			jobTable: this.jobTable,
			removalPolicy: props.removalPolicy,
			s3PrefixPrivate: props.s3PrefixPrivate,
		});

		NagSuppressions.addResourceSuppressionsByPath(
			cdk.Stack.of(this),
			`/${
				cdk.Stack.of(this).node.findChild(
					"LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a",
				).node.path
			}/ServiceRole/Resource`,
			[
				{
					id: "AwsSolutions-IAM4",
					reason:
						"CDK generates role with default policy. Default policy uses wildcard.",
				},
			],
			true,
		);
		NagSuppressions.addResourceSuppressionsByPath(
			cdk.Stack.of(this),
			`/${
				cdk.Stack.of(this).node.findChild(
					"LogRetentionaae0aa3c5b4d4f87b02d85b201efdd8a",
				).node.path
			}/ServiceRole/DefaultPolicy/Resource`,
			[
				{
					id: "AwsSolutions-IAM5",
					reason:
						"CDK generates role with default policy. Default policy uses wildcard.",
				},
			],
			true,
		);

		// END
	}
}
