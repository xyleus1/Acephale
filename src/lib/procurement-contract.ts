import { z } from "zod";

const jsonObject = z.record(z.unknown()).refine(
  (value) => value !== null && !Array.isArray(value),
  "Value must be a JSON object.",
);

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export const procurementRequestSchema = z.object({
  bomId: z.string().uuid().nullable().optional().default(null),
  material: z.string().trim().max(500).optional(),
  specification: z.string().trim().max(4_000).nullable().optional().default(null),
  lineItemPreferences: jsonObject.optional().default({}),
  quantity: z.number().finite().positive().max(1_000_000_000),
  unit: z.string().trim().min(1).max(80),
  neededBy: z.string().trim().refine(validDate, "neededBy must be a valid YYYY-MM-DD date.").nullable().optional().default(null),
  notes: z.string().trim().max(4_000).nullable().optional().default(null),
  requestContext: jsonObject.optional().default({}),
  idempotencyKey: z.string().trim().min(1).max(200),
}).strict().superRefine((value, context) => {
  if (!value.bomId && !value.material?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["material"],
      message: "Material is required when creating a BOM.",
    });
  }
});

export type ProcurementRequestInput = z.infer<typeof procurementRequestSchema>;
