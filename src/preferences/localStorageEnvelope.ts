import { z } from "zod";

export const LOCAL_STORAGE_SCHEMA_VERSION = 1;

export const StorageEnvelopeSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    schemaVersion: z.literal(LOCAL_STORAGE_SCHEMA_VERSION),
    updatedAt: z.iso.datetime(),
    data: dataSchema,
  });

export type StorageEnvelope<T> = {
  schemaVersion: number;
  updatedAt: string;
  data: T;
};

export function createStorageEnvelope<T>(data: T, now = new Date()): StorageEnvelope<T> {
  return {
    schemaVersion: LOCAL_STORAGE_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    data,
  };
}

export function readStorageEnvelope<T>(
  value: unknown,
  dataSchema: z.ZodType<T>,
): { enveloped: true; data: T; updatedAt: string } | { enveloped: false; data: unknown } | null {
  const parsed = StorageEnvelopeSchema(dataSchema).safeParse(value);
  if (parsed.success) {
    return {
      enveloped: true,
      data: parsed.data.data,
      updatedAt: parsed.data.updatedAt,
    };
  }
  if (typeof value === "object" && value !== null && "schemaVersion" in value && "data" in value) {
    return null;
  }
  return { enveloped: false, data: value };
}
