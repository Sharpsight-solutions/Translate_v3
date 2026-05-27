// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "achievingforchildren.org.uk";

export const handler = async (event: any) => {
	const email = event.request.userAttributes.email;

	if (!email) {
		throw new Error("Email address is required for registration.");
	}

	const domain = email.split("@")[1]?.toLowerCase();

	if (domain !== ALLOWED_DOMAIN) {
		throw new Error(
			`Registration is restricted to ${ALLOWED_DOMAIN} email addresses.`
		);
	}

	return event;
};
