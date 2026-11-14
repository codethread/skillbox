import { CommanderError } from "commander";
import { z } from "zod";

export interface ResponseErrorItem {
	code: string;
	message: string;
	source?: string;
	skill?: string;
	input?: string;
	target?: string;
	patch?: string;
	reason?: string;
}

export interface SuccessResponse<Data> {
	success: true;
	data: Data;
	errors: [];
}

export interface FailureResponse<Data = null> {
	success: false;
	data: Data;
	errors: ResponseErrorItem[];
}

export class ResponseError extends Error {
	readonly errors: ResponseErrorItem[];
	readonly data: unknown;

	constructor(errors: ResponseErrorItem[], options?: { cause?: unknown; data?: unknown }) {
		super(errors.map((error) => error.message).join("; "), { cause: options?.cause });
		this.name = "ResponseError";
		this.errors = errors;
		this.data = options?.data ?? null;
	}
}

export function successResponse<Data>(data: Data): SuccessResponse<Data> {
	return { success: true, data, errors: [] };
}

export function failureResponse(error: unknown): FailureResponse<unknown> {
	if (error instanceof ResponseError) {
		return { success: false, data: error.data, errors: error.errors };
	}
	if (error instanceof z.ZodError) {
		return {
			success: false,
			data: null,
			errors: error.issues.map((issue) => ({
				code: "INVALID_INPUT",
				message: issue.message,
				...(issue.path.length > 0 && { input: issue.path.join(".") }),
			})),
		};
	}
	if (error instanceof CommanderError) {
		return {
			success: false,
			data: null,
			errors: [
				{
					code: "CLI_PARSE_ERROR",
					message: error.message.replace(/^error: /, ""),
				},
			],
		};
	}
	if (isSdkDiagnostic(error)) {
		return {
			success: false,
			data: null,
			errors: [{ code: error.code, message: error.message }],
		};
	}
	return {
		success: false,
		data: null,
		errors: [
			{
				code: "SKILLBOX_ERROR",
				message: error instanceof Error ? error.message : String(error),
			},
		],
	};
}

export function responseError(
	code: string,
	message: string,
	context: Omit<ResponseErrorItem, "code" | "message"> = {},
	cause?: unknown,
): ResponseError {
	return new ResponseError([{ code, message, ...context }], { cause });
}

interface SdkDiagnostic {
	code: string;
	message: string;
}

function isSdkDiagnostic(error: unknown): error is SdkDiagnostic {
	return (
		error instanceof Error &&
		"code" in error &&
		typeof error.code === "string" &&
		error.code.startsWith("SKILLS_")
	);
}
