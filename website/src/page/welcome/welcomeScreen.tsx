// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import React, { useState } from "react";
import { signIn, signUp, confirmSignUp, resetPassword, confirmResetPassword, confirmSignIn } from "aws-amplify/auth";

import "./welcomeScreen.css";

type ViewState = "signIn" | "signUp" | "confirmSignUp" | "forgotPassword" | "confirmReset" | "newPasswordRequired";

interface WelcomeScreenProps {
	onSignedIn: () => void;
}

export default function WelcomeScreen({ onSignedIn }: WelcomeScreenProps) {
	const [view, setView] = useState<ViewState>("signIn");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [confirmationCode, setConfirmationCode] = useState("");
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [message, setMessage] = useState("");

	const handleSignIn = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);
		try {
			const result = await signIn({ username: email, password });
			if (result.isSignedIn) {
				onSignedIn();
			} else if (result.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
				setView("newPasswordRequired");
				setPassword("");
				setMessage("You need to set a new password to continue.");
			} else if (result.nextStep) {
				setError(`Additional step required: ${result.nextStep.signInStep}. Please contact your administrator.`);
			}
		} catch (err: any) {
			setError(err.message || "Sign in failed. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	const handleSignUp = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");

		if (password !== confirmPassword) {
			setError("Passwords do not match.");
			return;
		}

		if (!email.endsWith("@achievingforchildren.org.uk")) {
			setError("Registration is restricted to @achievingforchildren.org.uk email addresses.");
			return;
		}

		setLoading(true);
		try {
			await signUp({
				username: email,
				password,
				options: { userAttributes: { email } },
			});
			setView("confirmSignUp");
			setMessage("A verification code has been sent to your email address.");
		} catch (err: any) {
			setError(err.message || "Registration failed. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	const handleConfirmSignUp = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);
		try {
			await confirmSignUp({ username: email, confirmationCode });
			setView("signIn");
			setMessage("Account confirmed. Please sign in.");
		} catch (err: any) {
			setError(err.message || "Confirmation failed. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	const handleForgotPassword = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);
		try {
			await resetPassword({ username: email });
			setView("confirmReset");
			setMessage("A reset code has been sent to your email address.");
		} catch (err: any) {
			setError(err.message || "Could not send reset code. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	const handleConfirmReset = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		setLoading(true);
		try {
			await confirmResetPassword({
				username: email,
				confirmationCode,
				newPassword: password,
			});
			setView("signIn");
			setMessage("Password reset successfully. Please sign in.");
		} catch (err: any) {
			setError(err.message || "Password reset failed. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	const handleNewPassword = async (e: React.FormEvent) => {
		e.preventDefault();
		setError("");
		if (password !== confirmPassword) {
			setError("Passwords do not match.");
			return;
		}
		setLoading(true);
		try {
			const result = await confirmSignIn({ challengeResponse: password });
			if (result.isSignedIn) {
				onSignedIn();
			} else {
				setError("Could not complete sign in. Please try again.");
			}
		} catch (err: any) {
			setError(err.message || "Failed to set new password. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	const features = [
		{
			icon: "✓",
			text: "Upload documents in Word, HTML and spreadsheet formats",
		},
		{
			icon: "✓",
			text: "Translate into multiple languages in a single submission",
		},
		{
			icon: "✓",
			text: "AI-powered redaction to remove personal information",
		},
		{
			icon: "✓",
			text: "Results available within minutes from your job history",
		},
	];

	return (
		<div className="welcome-container">
			{/* Left Panel - Brand */}
			<div className="welcome-brand-panel">
				<div className="welcome-brand-content">
					<img
						src="https://www.achievingforchildren.org.uk/images/afccorporate/corporate_logo.svg"
						alt="Achieving for Children"
						className="welcome-logo"
					/>
					<div className="welcome-badge">Staff portal</div>
					<h1 className="welcome-title">Document Translation Service</h1>
					<p className="welcome-description">
						Translate documents quickly to support residents and families across
						our communities.
					</p>
					<ul className="welcome-features" aria-label="Service features">
						{features.map((feature, index) => (
							<li key={index} className="welcome-feature-item">
								<span className="welcome-feature-icon" aria-hidden="true">
									{feature.icon}
								</span>
								<span>{feature.text}</span>
							</li>
						))}
					</ul>
				</div>
			</div>

			{/* Right Panel - Auth Form */}
			<div className="welcome-form-panel">
				<div className="welcome-form-content">
					{/* Sign In */}
					{view === "signIn" && (
						<>
							<h2 className="welcome-form-heading">Sign in to continue</h2>
							<p className="welcome-form-subheading">
								Use your Achieving for Children work email address to access the
								service.
							</p>
							{message && <div className="welcome-message">{message}</div>}
							{error && <div className="welcome-error" role="alert">{error}</div>}
							<form onSubmit={handleSignIn} className="welcome-form">
								<div className="welcome-field">
									<label htmlFor="email">Email address</label>
									<input
										id="email"
										type="email"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										placeholder="name@achievingforchildren.org.uk"
										required
										autoComplete="email"
									/>
								</div>
								<div className="welcome-field">
									<label htmlFor="password">Password</label>
									<input
										id="password"
										type="password"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										required
										autoComplete="current-password"
									/>
								</div>
								<button
									type="submit"
									className="welcome-button"
									disabled={loading}
								>
									{loading ? "Signing in..." : "Sign in"}
								</button>
							</form>
							<div className="welcome-links">
								<button
									type="button"
									className="welcome-link-button"
									onClick={() => {
										setError("");
										setMessage("");
										setView("forgotPassword");
									}}
								>
									Forgot your password?
								</button>
							</div>
							<div className="welcome-create-account">
								<p>Don't have an account yet?</p>
								<button
									type="button"
									className="welcome-create-account-button"
									onClick={() => {
										setError("");
										setMessage("");
										setView("signUp");
									}}
								>
									Create an account
								</button>
							</div>
						</>
					)}

					{/* Sign Up */}
					{view === "signUp" && (
						<>
							<h2 className="welcome-form-heading">Create an account</h2>
							<p className="welcome-form-subheading">
								Use your Achieving for Children work email address.
							</p>
							{error && <div className="welcome-error" role="alert">{error}</div>}
							<form onSubmit={handleSignUp} className="welcome-form">
								<div className="welcome-field">
									<label htmlFor="signup-email">Email address</label>
									<input
										id="signup-email"
										type="email"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										placeholder="name@achievingforchildren.org.uk"
										required
										autoComplete="email"
									/>
								</div>
								<div className="welcome-field">
									<label htmlFor="signup-password">Password</label>
									<input
										id="signup-password"
										type="password"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										required
										autoComplete="new-password"
									/>
								</div>
								<div className="welcome-field">
									<label htmlFor="signup-confirm-password">
										Confirm password
									</label>
									<input
										id="signup-confirm-password"
										type="password"
										value={confirmPassword}
										onChange={(e) => setConfirmPassword(e.target.value)}
										required
										autoComplete="new-password"
									/>
								</div>
								<button
									type="submit"
									className="welcome-button"
									disabled={loading}
								>
									{loading ? "Creating account..." : "Create account"}
								</button>
							</form>
							<button
								type="button"
								className="welcome-link-button"
								onClick={() => {
									setError("");
									setView("signIn");
								}}
							>
								Already have an account? Sign in
							</button>
						</>
					)}

					{/* Confirm Sign Up */}
					{view === "confirmSignUp" && (
						<>
							<h2 className="welcome-form-heading">Verify your email</h2>
							{message && <div className="welcome-message">{message}</div>}
							{error && <div className="welcome-error" role="alert">{error}</div>}
							<form onSubmit={handleConfirmSignUp} className="welcome-form">
								<div className="welcome-field">
									<label htmlFor="confirm-code">Verification code</label>
									<input
										id="confirm-code"
										type="text"
										value={confirmationCode}
										onChange={(e) => setConfirmationCode(e.target.value)}
										placeholder="Enter the code from your email"
										required
										autoComplete="one-time-code"
									/>
								</div>
								<button
									type="submit"
									className="welcome-button"
									disabled={loading}
								>
									{loading ? "Verifying..." : "Verify"}
								</button>
							</form>
							<button
								type="button"
								className="welcome-link-button"
								onClick={() => {
									setError("");
									setMessage("");
									setView("signIn");
								}}
							>
								Back to sign in
							</button>
						</>
					)}

					{/* Forgot Password */}
					{view === "forgotPassword" && (
						<>
							<h2 className="welcome-form-heading">Reset your password</h2>
							<p className="welcome-form-subheading">
								Enter your email address and we'll send you a reset code.
							</p>
							{error && <div className="welcome-error" role="alert">{error}</div>}
							<form onSubmit={handleForgotPassword} className="welcome-form">
								<div className="welcome-field">
									<label htmlFor="reset-email">Email address</label>
									<input
										id="reset-email"
										type="email"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										required
										autoComplete="email"
									/>
								</div>
								<button
									type="submit"
									className="welcome-button"
									disabled={loading}
								>
									{loading ? "Sending..." : "Send reset code"}
								</button>
							</form>
							<button
								type="button"
								className="welcome-link-button"
								onClick={() => {
									setError("");
									setView("signIn");
								}}
							>
								Back to sign in
							</button>
						</>
					)}

					{/* Confirm Reset */}
					{view === "confirmReset" && (
						<>
							<h2 className="welcome-form-heading">Enter new password</h2>
							{message && <div className="welcome-message">{message}</div>}
							{error && <div className="welcome-error" role="alert">{error}</div>}
							<form onSubmit={handleConfirmReset} className="welcome-form">
								<div className="welcome-field">
									<label htmlFor="reset-code">Reset code</label>
									<input
										id="reset-code"
										type="text"
										value={confirmationCode}
										onChange={(e) => setConfirmationCode(e.target.value)}
										required
										autoComplete="one-time-code"
									/>
								</div>
								<div className="welcome-field">
									<label htmlFor="new-password">New password</label>
									<input
										id="new-password"
										type="password"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										required
										autoComplete="new-password"
									/>
								</div>
								<button
									type="submit"
									className="welcome-button"
									disabled={loading}
								>
									{loading ? "Resetting..." : "Reset password"}
								</button>
							</form>
							<button
								type="button"
								className="welcome-link-button"
								onClick={() => {
									setError("");
									setMessage("");
									setView("signIn");
								}}
							>
								Back to sign in
							</button>
						</>
					)}

					{/* New Password Required */}
					{view === "newPasswordRequired" && (
						<>
							<h2 className="welcome-form-heading">Set a new password</h2>
							<p className="welcome-form-subheading">
								Your administrator created your account. Please set a permanent password to continue.
							</p>
							{message && <div className="welcome-message">{message}</div>}
							{error && <div className="welcome-error" role="alert">{error}</div>}
							<form onSubmit={handleNewPassword} className="welcome-form">
								<div className="welcome-field">
									<label htmlFor="set-new-password">New password</label>
									<input
										id="set-new-password"
										type="password"
										value={password}
										onChange={(e) => setPassword(e.target.value)}
										required
										autoComplete="new-password"
									/>
								</div>
								<div className="welcome-field">
									<label htmlFor="set-confirm-password">Confirm new password</label>
									<input
										id="set-confirm-password"
										type="password"
										value={confirmPassword}
										onChange={(e) => setConfirmPassword(e.target.value)}
										required
										autoComplete="new-password"
									/>
								</div>
								<button
									type="submit"
									className="welcome-button"
									disabled={loading}
								>
									{loading ? "Setting password..." : "Set password and sign in"}
								</button>
							</form>
						</>
					)}

					{/* Restriction Note */}
					<div className="welcome-restriction-note">
						<p>
							Available to all staff with an @achievingforchildren.org.uk email
							address. Create your account to get started.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
