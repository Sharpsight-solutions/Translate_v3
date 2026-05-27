// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import "./static/index.css";

import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { Amplify } from "aws-amplify";

import App from "./App";

const cfnOutputs = require("./cfnOutputs.json");

// Configure Amplify at the very start before any component renders
Amplify.configure({
	Auth: {
		Cognito: {
			userPoolId: cfnOutputs.awsUserPoolsId,
			userPoolClientId: cfnOutputs.awsUserPoolsWebClientId,
			identityPoolId: cfnOutputs.awsCognitoIdentityPoolId,
			allowGuestAccess: false,
			loginWith: {
				oauth: {
					domain:
						cfnOutputs.awsCognitoOauthDomain +
						".auth." +
						cfnOutputs.awsRegion +
						".amazoncognito.com",
					scopes: ["openid"],
					redirectSignIn: [cfnOutputs.awsCognitoOauthRedirectSignIn],
					redirectSignOut: [cfnOutputs.awsCognitoOauthRedirectSignOut],
					responseType: "code",
				},
			},
		},
	},
	API: {
		GraphQL: {
			endpoint: cfnOutputs.awsAppsyncGraphqlEndpoint,
			defaultAuthMode: "userPool",
		},
	},
});

const container = document.getElementById("root");
if (!container) throw new Error("Failed to find the root element");
const root = createRoot(container);
root.render(
	<React.StrictMode>
		<BrowserRouter>
			<App />
		</BrowserRouter>
	</React.StrictMode>
);
