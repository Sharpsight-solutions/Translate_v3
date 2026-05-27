// Simple toast notification hook using Cloudscape Flashbar
import React, { createContext, useContext, useState, useCallback } from "react";
import { Flashbar, FlashbarProps } from "@cloudscape-design/components";

type ToastType = "success" | "error" | "info" | "warning";

interface ToastContextType {
	showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({
	showToast: () => {},
});

export function useToast() {
	return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
	const [items, setItems] = useState<FlashbarProps.MessageDefinition[]>([]);

	const showToast = useCallback((message: string, type: ToastType = "success") => {
		const id = Date.now().toString();
		setItems((prev) => [
			...prev,
			{
				id,
				type,
				content: message,
				dismissible: true,
				onDismiss: () =>
					setItems((current) => current.filter((item) => item.id !== id)),
			},
		]);
		// Auto-dismiss after 5 seconds
		setTimeout(() => {
			setItems((current) => current.filter((item) => item.id !== id));
		}, 5000);
	}, []);

	return (
		<ToastContext.Provider value={{ showToast }}>
			<div style={{ position: "fixed", top: "56px", right: "20px", zIndex: 9999, maxWidth: "400px" }}>
				<Flashbar items={items} />
			</div>
			{children}
		</ToastContext.Provider>
	);
}
