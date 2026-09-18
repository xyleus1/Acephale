import Ajv2020 from "ajv/dist/2020";
import schema from "./v1.schema.json";
import { canonical } from "../canonical";

const ajv = new Ajv2020({ strict: true, allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
export function validateContract(name: keyof typeof schema.$defs, value: unknown): void {
  canonical(value);
  const validate = ajv.getSchema(`${schema.$id}#/$defs/${name}`);
  if (!validate || !validate(value)) throw new Error(`Invalid ${name}: ${ajv.errorsText(validate?.errors)}`);
}
