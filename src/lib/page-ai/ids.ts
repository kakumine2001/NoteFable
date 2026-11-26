// AI の 1 回きりの生成の要求で使う ID の形。画面（スライド生成のウィザード）とサーバーの両方が読むので、prisma を読み込まない。

const CLIENT_REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;
const RECORD_ID = /^[\w-]{1,64}$/;

export const isClientRequestId = (value: unknown): value is string => typeof value === "string" && CLIENT_REQUEST_ID.test(value);
export const isRecordId = (value: unknown): value is string => typeof value === "string" && RECORD_ID.test(value);
